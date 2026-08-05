/**
 * Drive per bidang.
 *
 * Aturan akses:
 * - Isi Drive milik satu bidang; secara bawaan hanya pegawai bidang itu.
 * - Pemilik bisa membagikan folder/berkas ke bidang lain atau pengguna tertentu.
 * - Pimpinan (superadmin/kepala_dinas/sekretaris_dinas) melihat semuanya —
 *   penyaringan itu sudah dikerjakan `checkBidangAccess` di lapis rute.
 *
 * Berbagi FOLDER otomatis berlaku untuk seluruh isinya. Itu diselesaikan lewat
 * kolom `drive_folder.jalur` (lintasan id leluhur, mis. "/3/17/") sehingga
 * subpohon bisa dicek dengan satu LIKE, bukan rekursi bolak-balik ke database.
 */

const path = require('path');
const fs = require('fs');
const fsp = require('fs/promises');
const crypto = require('crypto');
const prisma = require('../config/prisma');
const { DRIVE_ROOT } = require('../middlewares/driveUpload');

const PIMPINAN = ['superadmin', 'kepala_dinas', 'sekretaris_dinas'];

// Sampah dibersihkan setelah 30 hari.
const HARI_SAMPAH = 30;

/** BigInt tidak bisa di-JSON.stringify; semua id dinormalkan ke Number. */
const rapikan = (obj) => {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj === 'bigint') return Number(obj);
  if (Array.isArray(obj)) return obj.map(rapikan);
  if (obj instanceof Date) return obj;
  if (typeof obj === 'object') {
    return Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, rapikan(v)]));
  }
  return obj;
};

/** Nama folder/berkas yang aman: tanpa pemisah lintasan dan tanpa ".." */
const namaAman = (nama) => {
  const bersih = String(nama || '').replace(/[/\\]/g, '').replace(/\.{2,}/g, '.').trim();
  return bersih.slice(0, 255);
};

/**
 * Daftar id folder yang dibagikan ke pengguna ini dari bidang lain.
 * Dipakai untuk menentukan apakah sebuah objek boleh dilihat.
 */
const shareUntukUser = async (user) => {
  const penerima = [{ penerima_tipe: 'user', penerima_id: BigInt(user.id) }];
  if (user.bidang_id) {
    penerima.push({ penerima_tipe: 'bidang', penerima_id: BigInt(user.bidang_id) });
  }
  return prisma.drive_share.findMany({ where: { OR: penerima } });
};

/**
 * Apakah `user` boleh menyentuh objek milik `bidangPemilik`?
 * Mengembalikan 'pemilik' | 'ubah' | 'lihat' | null.
 */
const izinAtas = async (user, bidangPemilik, objek) => {
  if (PIMPINAN.includes(user.role)) return 'pemilik';
  if (Number(user.bidang_id) === Number(bidangPemilik)) return 'pemilik';

  const shares = await shareUntukUser(user);
  if (!shares.length) return null;

  // Cocokkan langsung ke objeknya.
  const langsung = shares.find(
    (s) => s.objek_tipe === objek.tipe && Number(s.objek_id) === Number(objek.id)
  );
  if (langsung) return langsung.izin;

  // Kalau bukan, cek apakah salah satu leluhurnya yang dibagikan.
  const idFolderDibagi = shares.filter((s) => s.objek_tipe === 'folder').map((s) => Number(s.objek_id));
  if (!idFolderDibagi.length) return null;

  const jalur = objek.jalur || '';
  const cocok = shares.find(
    (s) => s.objek_tipe === 'folder' && jalur.includes(`/${Number(s.objek_id)}/`)
  );
  return cocok ? cocok.izin : null;
};

const butuhUbah = (izin) => izin === 'pemilik' || izin === 'ubah';

/**
 * Lintasan leluhur sebuah objek, dipakai `izinAtas` untuk menelusuri berbagi
 * folder.
 *
 * Folder sudah menyimpannya di kolom `jalur`. Berkas tidak — lintasannya harus
 * disusun dari folder induknya, kalau tidak berkas di dalam folder yang
 * dibagikan akan dianggap tidak punya leluhur dan izinnya ditolak.
 */
const jalurEfektif = async (tipe, objek) => {
  if (tipe === 'folder') return objek.jalur || '';
  if (!objek.folder_id) return '';
  const folder = await prisma.drive_folder.findUnique({ where: { id: objek.folder_id } });
  return folder ? `${folder.jalur}${folder.id}/` : '';
};

/** Ambil objek + izin pengguna atasnya sekaligus; null kalau objeknya tak ada. */
const ambilObjek = async (user, tipe, id, { termasukSampah = false } = {}) => {
  const tabel = tipe === 'folder' ? prisma.drive_folder : prisma.drive_file;
  const objek = await tabel.findFirst({
    where: {
      id: BigInt(id),
      ...(termasukSampah ? { deleted_at: { not: null } } : { deleted_at: null }),
    },
  });
  if (!objek) return null;

  const izin = await izinAtas(user, objek.bidang_id, {
    tipe,
    id: objek.id,
    jalur: await jalurEfektif(tipe, objek),
  });

  return { tabel, objek, izin };
};

class DriveController {
  // ============================================================
  // Isi folder
  // ============================================================
  async list(req, res) {
    try {
      const bidangId = BigInt(req.params.bidangId);
      const folderId = req.query.folder_id ? BigInt(req.query.folder_id) : null;

      const [folders, files, kuota] = await Promise.all([
        prisma.drive_folder.findMany({
          where: { bidang_id: bidangId, parent_id: folderId, deleted_at: null },
          orderBy: { nama: 'asc' },
        }),
        prisma.drive_file.findMany({
          where: { bidang_id: bidangId, folder_id: folderId, deleted_at: null },
          orderBy: { nama: 'asc' },
        }),
        prisma.drive_kuota.findUnique({ where: { bidang_id: bidangId } }),
      ]);

      // Remah jejak: dibaca dari `jalur` folder aktif, satu query untuk semua
      // leluhurnya sekaligus.
      let breadcrumb = [];
      if (folderId) {
        const aktif = await prisma.drive_folder.findUnique({ where: { id: folderId } });
        if (aktif) {
          const idLeluhur = aktif.jalur.split('/').filter(Boolean).map((n) => BigInt(n));
          if (idLeluhur.length) {
            const leluhur = await prisma.drive_folder.findMany({
              where: { id: { in: idLeluhur } },
              select: { id: true, nama: true },
            });
            const urutan = new Map(leluhur.map((f) => [Number(f.id), f]));
            breadcrumb = idLeluhur.map((id) => urutan.get(Number(id))).filter(Boolean);
          }
          breadcrumb.push({ id: aktif.id, nama: aktif.nama });
        }
      }

      res.json({
        success: true,
        data: {
          folders: rapikan(folders),
          files: rapikan(files.map((f) => ({ ...f, ukuran: Number(f.ukuran) }))),
          breadcrumb: rapikan(breadcrumb),
          kuota: kuota
            ? {
                batas_bytes: Number(kuota.batas_bytes),
                terpakai_bytes: Number(kuota.terpakai_bytes),
                persen: Number(kuota.batas_bytes)
                  ? Math.round((Number(kuota.terpakai_bytes) / Number(kuota.batas_bytes)) * 100)
                  : 0,
              }
            : null,
        },
      });
    } catch (error) {
      console.error('Error list drive:', error);
      res.status(500).json({ success: false, message: 'Gagal memuat isi Drive.' });
    }
  }

  // ============================================================
  // Folder
  // ============================================================
  async buatFolder(req, res) {
    try {
      const bidangId = BigInt(req.params.bidangId);
      const nama = namaAman(req.body.nama);
      if (!nama) {
        return res.status(400).json({ success: false, message: 'Nama folder wajib diisi.' });
      }

      const parentId = req.body.parent_id ? BigInt(req.body.parent_id) : null;
      let jalur = '/';

      if (parentId) {
        const induk = await prisma.drive_folder.findFirst({
          where: { id: parentId, bidang_id: bidangId, deleted_at: null },
        });
        if (!induk) {
          return res.status(404).json({ success: false, message: 'Folder induk tidak ditemukan.' });
        }
        jalur = `${induk.jalur}${induk.id}/`;
      }

      const kembar = await prisma.drive_folder.findFirst({
        where: { bidang_id: bidangId, parent_id: parentId, nama, deleted_at: null },
      });
      if (kembar) {
        return res.status(409).json({ success: false, message: 'Folder dengan nama itu sudah ada.' });
      }

      const folder = await prisma.drive_folder.create({
        data: {
          bidang_id: bidangId,
          parent_id: parentId,
          nama,
          jalur,
          created_by: BigInt(req.user.id),
        },
      });

      res.status(201).json({ success: true, data: rapikan(folder) });
    } catch (error) {
      console.error('Error buat folder:', error);
      res.status(500).json({ success: false, message: 'Gagal membuat folder.' });
    }
  }

  async ubahNama(req, res) {
    try {
      const { tipe, id } = req.params;
      const nama = namaAman(req.body.nama);
      if (!nama) {
        return res.status(400).json({ success: false, message: 'Nama wajib diisi.' });
      }

      const sasaran = await ambilObjek(req.user, tipe, id);
      if (!sasaran) {
        return res.status(404).json({ success: false, message: 'Objek tidak ditemukan.' });
      }
      if (!butuhUbah(sasaran.izin)) {
        return res.status(403).json({ success: false, message: 'Tidak punya izin mengubah objek ini.' });
      }
      const { tabel } = sasaran;

      const hasil = await tabel.update({
        where: { id: BigInt(id) },
        data: { nama, updated_by: BigInt(req.user.id) },
      });

      res.json({ success: true, data: rapikan(hasil) });
    } catch (error) {
      console.error('Error ubah nama:', error);
      res.status(500).json({ success: false, message: 'Gagal mengubah nama.' });
    }
  }

  // ============================================================
  // Unggah
  // ============================================================
  async unggah(req, res) {
    const berkasTerunggah = req.files || [];

    try {
      const bidangId = BigInt(req.params.bidangId);
      if (!berkasTerunggah.length) {
        return res.status(400).json({ success: false, message: 'Tidak ada berkas yang diunggah.' });
      }

      const folderId = req.body.folder_id ? BigInt(req.body.folder_id) : null;
      if (folderId) {
        const folder = await prisma.drive_folder.findFirst({
          where: { id: folderId, bidang_id: bidangId, deleted_at: null },
        });
        if (!folder) {
          await Promise.all(berkasTerunggah.map((f) => fsp.unlink(f.path).catch(() => {})));
          return res.status(404).json({ success: false, message: 'Folder tujuan tidak ditemukan.' });
        }
      }

      // Pemeriksaan kuota yang sebenarnya: sekarang ukuran aslinya sudah pasti.
      const totalUkuran = berkasTerunggah.reduce((sum, f) => sum + BigInt(f.size), 0n);
      const kuota = await prisma.drive_kuota.findUnique({ where: { bidang_id: bidangId } });
      const sisa = kuota.batas_bytes - kuota.terpakai_bytes;

      if (totalUkuran > sisa) {
        await Promise.all(berkasTerunggah.map((f) => fsp.unlink(f.path).catch(() => {})));
        return res.status(413).json({
          success: false,
          message: 'Kuota Drive bidang tidak mencukupi.',
          data: { sisa_bytes: Number(sisa), dibutuhkan_bytes: Number(totalUkuran) },
        });
      }

      const dicatat = [];
      for (const berkas of berkasTerunggah) {
        const isi = await fsp.readFile(berkas.path);
        const checksum = crypto.createHash('sha256').update(isi).digest('hex');

        dicatat.push(
          await prisma.drive_file.create({
            data: {
              bidang_id: bidangId,
              folder_id: folderId,
              nama: namaAman(berkas.originalname),
              nama_asli: String(berkas.originalname).slice(0, 255),
              mime: berkas.mimetype?.slice(0, 150) || null,
              ekstensi: path.extname(berkas.originalname).replace('.', '').slice(0, 20) || null,
              ukuran: BigInt(berkas.size),
              nama_disk: berkas.filename,
              jalur_disk: path.join(req.driveSegmen, berkas.filename).replace(/\\/g, '/'),
              checksum,
              created_by: BigInt(req.user.id),
            },
          })
        );
      }

      await prisma.drive_kuota.update({
        where: { bidang_id: bidangId },
        data: { terpakai_bytes: { increment: totalUkuran } },
      });

      res.status(201).json({
        success: true,
        message: `${dicatat.length} berkas diunggah.`,
        data: rapikan(dicatat.map((f) => ({ ...f, ukuran: Number(f.ukuran) }))),
      });
    } catch (error) {
      // Jangan tinggalkan berkas yatim di disk kalau pencatatan gagal.
      await Promise.all(berkasTerunggah.map((f) => fsp.unlink(f.path).catch(() => {})));
      console.error('Error unggah drive:', error);
      res.status(500).json({ success: false, message: 'Gagal mengunggah berkas.' });
    }
  }

  // ============================================================
  // Unduh / pratinjau
  // ============================================================
  // Sengaja lewat controller, BUKAN express.static: izinnya harus dicek dulu.
  async unduh(req, res) {
    try {
      const berkas = await prisma.drive_file.findFirst({
        where: { id: BigInt(req.params.id), deleted_at: null },
      });
      if (!berkas) {
        return res.status(404).json({ success: false, message: 'Berkas tidak ditemukan.' });
      }

      const izin = await izinAtas(req.user, berkas.bidang_id, {
        tipe: 'file',
        id: berkas.id,
        jalur: await jalurEfektif('file', berkas),
      });
      if (!izin) {
        return res.status(403).json({ success: false, message: 'Tidak punya akses ke berkas ini.' });
      }

      const absolut = path.join(DRIVE_ROOT, berkas.jalur_disk);
      // Pagar terakhir: pastikan lintasan hasil gabungan tidak keluar dari
      // DRIVE_ROOT, seandainya ada baris rusak di database.
      if (!absolut.startsWith(DRIVE_ROOT) || !fs.existsSync(absolut)) {
        return res.status(404).json({ success: false, message: 'Berkas fisik tidak ditemukan.' });
      }

      const inline = req.query.inline === '1';
      res.setHeader('Content-Type', berkas.mime || 'application/octet-stream');
      res.setHeader(
        'Content-Disposition',
        `${inline ? 'inline' : 'attachment'}; filename="${encodeURIComponent(berkas.nama)}"`
      );
      res.setHeader('Content-Length', Number(berkas.ukuran));
      // Berkas privat: jangan sampai tersimpan di cache bersama.
      res.setHeader('Cache-Control', 'private, no-store');

      fs.createReadStream(absolut).pipe(res);
    } catch (error) {
      console.error('Error unduh drive:', error);
      res.status(500).json({ success: false, message: 'Gagal mengunduh berkas.' });
    }
  }

  // ============================================================
  // Sampah
  // ============================================================
  async keSampah(req, res) {
    try {
      const { tipe, id } = req.params;
      const sasaran = await ambilObjek(req.user, tipe, id);
      if (!sasaran) {
        return res.status(404).json({ success: false, message: 'Objek tidak ditemukan.' });
      }
      if (!butuhUbah(sasaran.izin)) {
        return res.status(403).json({ success: false, message: 'Tidak punya izin menghapus objek ini.' });
      }
      const { tabel, objek } = sasaran;

      const sekarang = new Date();
      const olehSiapa = BigInt(req.user.id);

      if (tipe === 'folder') {
        // Seluruh isi subpohon ikut masuk sampah, supaya tidak ada berkas yang
        // menggantung tanpa induk yang terlihat.
        const cakupan = `${objek.jalur}${objek.id}/`;
        await prisma.$transaction([
          prisma.drive_folder.updateMany({
            where: { bidang_id: objek.bidang_id, jalur: { startsWith: cakupan }, deleted_at: null },
            data: { deleted_at: sekarang, deleted_by: olehSiapa },
          }),
          prisma.drive_folder.update({
            where: { id: objek.id },
            data: { deleted_at: sekarang, deleted_by: olehSiapa },
          }),
        ]);
      } else {
        await tabel.update({
          where: { id: objek.id },
          data: { deleted_at: sekarang, deleted_by: olehSiapa },
        });
      }

      res.json({ success: true, message: 'Dipindahkan ke sampah.' });
    } catch (error) {
      console.error('Error hapus drive:', error);
      res.status(500).json({ success: false, message: 'Gagal menghapus.' });
    }
  }

  async listSampah(req, res) {
    try {
      const bidangId = BigInt(req.params.bidangId);
      const batas = new Date(Date.now() - HARI_SAMPAH * 24 * 60 * 60 * 1000);

      const [folders, files] = await Promise.all([
        prisma.drive_folder.findMany({
          where: { bidang_id: bidangId, deleted_at: { not: null, gte: batas } },
          orderBy: { deleted_at: 'desc' },
        }),
        prisma.drive_file.findMany({
          where: { bidang_id: bidangId, deleted_at: { not: null, gte: batas } },
          orderBy: { deleted_at: 'desc' },
        }),
      ]);

      res.json({
        success: true,
        data: {
          folders: rapikan(folders),
          files: rapikan(files.map((f) => ({ ...f, ukuran: Number(f.ukuran) }))),
          hari_tersisa: HARI_SAMPAH,
        },
      });
    } catch (error) {
      console.error('Error list sampah:', error);
      res.status(500).json({ success: false, message: 'Gagal memuat sampah.' });
    }
  }

  async pulihkan(req, res) {
    try {
      const { tipe, id } = req.params;
      const sasaran = await ambilObjek(req.user, tipe, id, { termasukSampah: true });
      if (!sasaran) {
        return res.status(404).json({ success: false, message: 'Objek tidak ada di sampah.' });
      }
      if (!butuhUbah(sasaran.izin)) {
        return res.status(403).json({ success: false, message: 'Tidak punya izin memulihkan objek ini.' });
      }
      const { tabel, objek } = sasaran;

      if (tipe === 'folder') {
        const cakupan = `${objek.jalur}${objek.id}/`;
        await prisma.$transaction([
          prisma.drive_folder.updateMany({
            where: { bidang_id: objek.bidang_id, jalur: { startsWith: cakupan } },
            data: { deleted_at: null, deleted_by: null },
          }),
          prisma.drive_folder.update({
            where: { id: objek.id },
            data: { deleted_at: null, deleted_by: null },
          }),
        ]);
      } else {
        await tabel.update({ where: { id: objek.id }, data: { deleted_at: null, deleted_by: null } });
      }

      res.json({ success: true, message: 'Dipulihkan dari sampah.' });
    } catch (error) {
      console.error('Error pulihkan:', error);
      res.status(500).json({ success: false, message: 'Gagal memulihkan.' });
    }
  }

  // ============================================================
  // Berbagi
  // ============================================================
  async bagikan(req, res) {
    try {
      const { tipe, id } = req.params;
      const { penerima_tipe: penerimaTipe, penerima_id: penerimaId, izin = 'lihat' } = req.body;

      if (!['bidang', 'user'].includes(penerimaTipe) || !penerimaId) {
        return res.status(400).json({ success: false, message: 'Penerima berbagi tidak sah.' });
      }
      if (!['lihat', 'ubah'].includes(izin)) {
        return res.status(400).json({ success: false, message: 'Izin harus "lihat" atau "ubah".' });
      }

      const sasaran = await ambilObjek(req.user, tipe, id);
      if (!sasaran) {
        return res.status(404).json({ success: false, message: 'Objek tidak ditemukan.' });
      }

      // Hanya pemilik yang boleh membagikan; penerima berbagi tidak bisa
      // meneruskannya ke pihak ketiga.
      if (sasaran.izin !== 'pemilik') {
        return res.status(403).json({ success: false, message: 'Hanya pemilik yang bisa membagikan.' });
      }
      const { objek } = sasaran;

      // Membagikan ke bidang sendiri tidak menambah apa pun — seluruh isi Drive
      // memang sudah terlihat oleh bidang pemiliknya.
      if (penerimaTipe === 'bidang' && Number(penerimaId) === Number(objek.bidang_id)) {
        return res.status(400).json({
          success: false,
          message: 'Objek ini sudah menjadi milik bidang tersebut.',
        });
      }

      const share = await prisma.drive_share.upsert({
        where: {
          objek_tipe_objek_id_penerima_tipe_penerima_id: {
            objek_tipe: tipe,
            objek_id: BigInt(id),
            penerima_tipe: penerimaTipe,
            penerima_id: BigInt(penerimaId),
          },
        },
        create: {
          objek_tipe: tipe,
          objek_id: BigInt(id),
          bidang_pemilik: objek.bidang_id,
          penerima_tipe: penerimaTipe,
          penerima_id: BigInt(penerimaId),
          izin,
          created_by: BigInt(req.user.id),
        },
        update: { izin },
      });

      res.json({ success: true, data: rapikan(share) });
    } catch (error) {
      console.error('Error bagikan:', error);
      res.status(500).json({ success: false, message: 'Gagal membagikan.' });
    }
  }

  /**
   * Siapa saja yang sudah diberi akses ke sebuah objek.
   * Hanya pemilik yang boleh melihat daftarnya — penerima tidak perlu tahu
   * objek yang sama juga dibagikan ke bidang lain.
   */
  async daftarBerbagi(req, res) {
    try {
      const { tipe, id } = req.params;
      const sasaran = await ambilObjek(req.user, tipe, id);
      if (!sasaran) {
        return res.status(404).json({ success: false, message: 'Objek tidak ditemukan.' });
      }
      if (sasaran.izin !== 'pemilik') {
        return res.status(403).json({ success: false, message: 'Hanya pemilik yang bisa melihat daftar akses.' });
      }

      const shares = await prisma.drive_share.findMany({
        where: { objek_tipe: tipe, objek_id: BigInt(id) },
        orderBy: { created_at: 'asc' },
      });

      const daftar = await Promise.all(
        shares.map(async (s) => {
          let nama = `#${Number(s.penerima_id)}`;
          if (s.penerima_tipe === 'bidang') {
            const bidang = await prisma.bidangs.findUnique({
              where: { id: s.penerima_id },
              select: { nama: true },
            });
            if (bidang) nama = bidang.nama;
          } else {
            const user = await prisma.users.findUnique({
              where: { id: s.penerima_id },
              select: { name: true },
            });
            if (user) nama = user.name;
          }
          return { ...rapikan(s), penerima_nama: nama };
        })
      );

      res.json({ success: true, data: daftar });
    } catch (error) {
      console.error('Error daftar berbagi:', error);
      res.status(500).json({ success: false, message: 'Gagal memuat daftar akses.' });
    }
  }

  async cabutBerbagi(req, res) {
    try {
      const share = await prisma.drive_share.findUnique({
        where: { id: BigInt(req.params.shareId) },
      });
      if (!share) {
        return res.status(404).json({ success: false, message: 'Data berbagi tidak ditemukan.' });
      }

      // Tanpa pemeriksaan ini siapa pun yang sudah login bisa mencabut akses
      // milik bidang lain hanya dengan menebak id-nya.
      const sasaran = await ambilObjek(req.user, share.objek_tipe, share.objek_id);
      if (!sasaran || sasaran.izin !== 'pemilik') {
        return res.status(403).json({ success: false, message: 'Hanya pemilik yang bisa mencabut akses.' });
      }

      await prisma.drive_share.delete({ where: { id: share.id } });
      res.json({ success: true, message: 'Akses dicabut.' });
    } catch (error) {
      console.error('Error cabut berbagi:', error);
      res.status(500).json({ success: false, message: 'Gagal mencabut akses.' });
    }
  }

  /** Folder & berkas dari bidang lain yang dibagikan ke pengguna ini. */
  async dibagikanKeSaya(req, res) {
    try {
      const shares = await shareUntukUser(req.user);
      const idFolder = shares.filter((s) => s.objek_tipe === 'folder').map((s) => s.objek_id);
      const idFile = shares.filter((s) => s.objek_tipe === 'file').map((s) => s.objek_id);

      const [folders, files, bidangs] = await Promise.all([
        idFolder.length
          ? prisma.drive_folder.findMany({ where: { id: { in: idFolder }, deleted_at: null } })
          : [],
        idFile.length
          ? prisma.drive_file.findMany({ where: { id: { in: idFile }, deleted_at: null } })
          : [],
        prisma.bidangs.findMany({ select: { id: true, nama: true } }),
      ]);

      const namaBidang = new Map(bidangs.map((b) => [Number(b.id), b.nama]));
      // Izin ikut dikirim supaya UI tidak menawarkan tombol yang pasti ditolak
      // server, mis. "Ubah nama" untuk berbagi yang cuma "lihat".
      const izinObjek = (tipe, id) => {
        const s = shares.find((x) => x.objek_tipe === tipe && Number(x.objek_id) === Number(id));
        return s ? s.izin : 'lihat';
      };
      const lengkapi = (tipe) => (o) => ({
        ...rapikan(o),
        ...(tipe === 'file' ? { ukuran: Number(o.ukuran) } : {}),
        izin: izinObjek(tipe, o.id),
        pemilik_nama: namaBidang.get(Number(o.bidang_id)) || `Bidang ${Number(o.bidang_id)}`,
      });

      res.json({
        success: true,
        data: {
          folders: folders.map(lengkapi('folder')),
          files: files.map(lengkapi('file')),
        },
      });
    } catch (error) {
      console.error('Error dibagikan ke saya:', error);
      res.status(500).json({ success: false, message: 'Gagal memuat berkas yang dibagikan.' });
    }
  }

  /**
   * Isi sebuah folder yang aksesnya didapat lewat berbagi.
   *
   * `list` tidak bisa dipakai untuk ini: dia dijaga `checkBidangAccess`, jadi
   * folder milik bidang lain selalu ditolak walau sudah dibagikan. Tanpa
   * endpoint ini, folder yang dibagikan hanya terlihat namanya dan isinya tidak
   * pernah bisa dibuka — janji "berbagi folder berlaku untuk seluruh isinya"
   * jadi tidak berarti apa-apa.
   */
  async isiFolder(req, res) {
    try {
      const sasaran = await ambilObjek(req.user, 'folder', req.params.id);
      if (!sasaran) {
        return res.status(404).json({ success: false, message: 'Folder tidak ditemukan.' });
      }
      if (!sasaran.izin) {
        return res.status(403).json({ success: false, message: 'Tidak punya akses ke folder ini.' });
      }

      const { objek: folder, izin } = sasaran;

      const [folders, files] = await Promise.all([
        prisma.drive_folder.findMany({
          where: { bidang_id: folder.bidang_id, parent_id: folder.id, deleted_at: null },
          orderBy: { nama: 'asc' },
        }),
        prisma.drive_file.findMany({
          where: { bidang_id: folder.bidang_id, folder_id: folder.id, deleted_at: null },
          orderBy: { nama: 'asc' },
        }),
      ]);

      res.json({
        success: true,
        data: {
          folder: rapikan({ id: folder.id, nama: folder.nama, bidang_id: folder.bidang_id }),
          izin,
          folders: rapikan(folders).map((f) => ({ ...f, izin })),
          files: rapikan(files.map((f) => ({ ...f, ukuran: Number(f.ukuran) }))).map((f) => ({ ...f, izin })),
        },
      });
    } catch (error) {
      console.error('Error isi folder:', error);
      res.status(500).json({ success: false, message: 'Gagal memuat isi folder.' });
    }
  }
}

module.exports = new DriveController();
