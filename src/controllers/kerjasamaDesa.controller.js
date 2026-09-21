/**
 * Kerja Sama Desa — sisi DESA.
 *
 * Alurnya dua lapis, dan pemisahannya mengikuti umur datanya:
 *
 *   1. LEGALITAS (sekali di awal). Perdes payung tentang kerja sama desa. Satu
 *      per desa, dijaga UNIQUE di basis data. Berkasnya tidak disimpan di modul
 *      ini melainkan didaftarkan ke Produk Hukum Desa, lalu ditautkan lewat
 *      `produk_hukum_id`.
 *   2. KEGIATAN (berulang tanpa batas). Tiap kerja sama punya jenis, bidang,
 *      mitra, dan dokumennya sendiri.
 *
 * KENAPA PERDES-NYA LEWAT PRODUK HUKUM. Dokumen yang sama akan dicari orang dari
 * dua pintu: petugas kerja sama mencarinya di sini, sekretaris desa mencarinya
 * di menu Produk Hukum. Menyimpan dua salinan berarti suatu saat yang satu
 * diperbarui dan yang lain tidak. Jadi satu baris produk_hukums, dua pintu
 * menuju baris yang sama — pola yang sama dengan dokumen badan hukum BUM Desa.
 *
 * Penjaga hak aksesnya `kerjasama-desa`, BUKAN `produk-hukum`: operator yang
 * ditugasi mengurus kerja sama sering tidak diberi akses modul Produk Hukum,
 * dan justru itu yang membuat datanya macet sebelum ada endpoint ini.
 */

const fs = require('fs').promises;
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const prisma = require('../config/prisma');
const logger = require('../utils/logger');
const ActivityLogger = require('../utils/activityLogger');
const {
  BIDANG_KEYS,
  JENIS_KEYS,
  PADANAN_PERDES_KERJASAMA,
  dokumenUntukJenis,
  dokumenLengkap,
  katalog,
} = require('../config/kerjasamaDesa');

const FOLDER_DOKUMEN = path.join(__dirname, '../../storage/uploads/kerjasama_desa');
const FOLDER_PRODUK_HUKUM = path.join(__dirname, '../../storage/produk_hukum');

const LOG_MODULE = 'kerjasama_desa';

const badRequest = (res, message) => res.status(422).json({ success: false, message });
const notFound = (res, message) => res.status(404).json({ success: false, message });

const PILIH_ENTRI = {
  id: true,
  desa_id: true,
  tahun: true,
  jenis: true,
  bidang: true,
  sub_bidang: true,
  mitra: true,
  ruang_lingkup: true,
  tanggal_mulai: true,
  tanggal_selesai: true,
  file_permakades: true,
  file_sk_bkd: true,
  file_pks_mou: true,
  pelaksanaan: true,
  created_at: true,
  updated_at: true,
};

/**
 * Bentuk satu entri untuk frontend.
 *
 * `dokumen` dihitung di server, bukan di layar: aturan "mana yang wajib untuk
 * jenis ini" hidup di config/kerjasamaDesa.js, dan frontend tidak boleh punya
 * salinan keduanya yang bisa menyimpang.
 */
const bentukEntri = (baris) => ({
  id: String(baris.id),
  desa_id: baris.desa_id === null || baris.desa_id === undefined ? null : String(baris.desa_id),
  tahun: baris.tahun,
  jenis: baris.jenis,
  bidang: baris.bidang,
  sub_bidang: baris.sub_bidang,
  mitra: baris.mitra,
  ruang_lingkup: baris.ruang_lingkup,
  tanggal_mulai: baris.tanggal_mulai,
  tanggal_selesai: baris.tanggal_selesai,
  pelaksanaan: baris.pelaksanaan,
  created_at: baris.created_at,
  updated_at: baris.updated_at,
  dokumen: dokumenUntukJenis(baris.jenis).map((d) => ({
    field: d.field,
    label: d.label,
    singkat: d.singkat,
    wajib: d.wajib,
    file: baris[d.field] || null,
  })),
  dokumen_lengkap: dokumenLengkap(baris),
});

const bentukLegalitas = (baris) =>
  baris
    ? {
        id: String(baris.id),
        nomor_perdes: baris.nomor_perdes,
        tahun_perdes: baris.tahun_perdes,
        keterangan: baris.keterangan,
        produk_hukum: baris.produk_hukums
          ? {
              id: baris.produk_hukums.id,
              judul: baris.produk_hukums.judul,
              nomor: baris.produk_hukums.nomor,
              tahun: baris.produk_hukums.tahun,
              file: baris.produk_hukums.file,
              tanggal_penetapan: baris.produk_hukums.tanggal_penetapan,
            }
          : null,
        // "Lengkap" berarti berkasnya benar-benar ada, bukan sekadar nomornya
        // terisi. Dashboard SPKED menghitung cakupan dengan ukuran yang sama.
        lengkap: Boolean(baris.produk_hukum_id),
        updated_at: baris.updated_at,
      }
    : null;

const RELASI_PRODUK_HUKUM = {
  select: { id: true, judul: true, nomor: true, tahun: true, file: true, tanggal_penetapan: true },
};

const desaIdDari = (req) => {
  const nilai = req.user?.desa_id;
  if (nilai === null || nilai === undefined || nilai === '') return null;
  try {
    return BigInt(String(nilai));
  } catch {
    return null;
  }
};

const parseId = (nilai) => {
  try {
    const id = BigInt(String(nilai));
    return id > 0n ? id : null;
  } catch {
    return null;
  }
};

const teks = (nilai) => String(nilai ?? '').trim();

const parseTanggal = (nilai) => {
  const bersih = teks(nilai);
  if (!bersih) return null;
  const tanggal = new Date(bersih);
  return Number.isNaN(tanggal.getTime()) ? undefined : tanggal; // undefined = tidak valid
};

const catat = (req, { action, entri, description, oldValue = null, newValue = null }) => {
  ActivityLogger.log({
    userId: BigInt(String(req.user.id)),
    userName: req.user.name || req.user.email,
    userRole: req.user.role,
    module: LOG_MODULE,
    action,
    entityType: 'kerjasama_desa',
    entityId: entri?.id ? BigInt(String(entri.id)) : null,
    entityName: entri?.mitra || null,
    description,
    oldValue,
    newValue,
    ipAddress: ActivityLogger.getIpFromRequest(req),
    userAgent: ActivityLogger.getUserAgentFromRequest(req),
  }).catch(() => {});
};

class KerjasamaDesaController {
  /** Katalog bidang & jenis + kondisi legalitas desa ini. Dipanggil saat halaman dibuka. */
  async getMeta(req, res, next) {
    try {
      const desaId = desaIdDari(req);
      if (!desaId) return res.status(403).json({ success: false, message: 'Akun tidak terhubung dengan desa' });

      const [legalitas, desa, jumlah] = await Promise.all([
        prisma.kerjasama_desa_legalitas.findUnique({
          where: { desa_id: desaId },
          include: { produk_hukums: RELASI_PRODUK_HUKUM },
        }),
        prisma.desas.findUnique({
          where: { id: desaId },
          select: { id: true, nama: true, status_pemerintahan: true, kecamatans: { select: { nama: true } } },
        }),
        prisma.kerjasama_desa.count({ where: { desa_id: desaId } }),
      ]);

      res.json({
        success: true,
        data: {
          ...katalog(),
          desa: desa
            ? {
                id: String(desa.id),
                nama: desa.nama,
                status_pemerintahan: desa.status_pemerintahan,
                kecamatan: desa.kecamatans?.nama || null,
              }
            : null,
          legalitas: bentukLegalitas(legalitas),
          total_kerjasama: jumlah,
        },
      });
    } catch (error) {
      logger.error('Gagal memuat meta kerja sama desa:', error);
      next(error);
    }
  }

  /**
   * Perdes yang bisa dipilih sebagai payung kerja sama.
   *
   * Sengaja hanya PERDES berstatus berlaku: Perkades dan SK Kades bukan dasar
   * hukum kerja sama desa, dan menampilkannya hanya mengundang salah pilih.
   */
  async getPerdesTersedia(req, res, next) {
    try {
      const desaId = desaIdDari(req);
      if (!desaId) return res.status(403).json({ success: false, message: 'Akun tidak terhubung dengan desa' });

      const perdes = await prisma.produk_hukums.findMany({
        where: { desa_id: desaId, singkatan_jenis: 'PERDES', status_peraturan: 'berlaku' },
        select: { id: true, judul: true, nomor: true, tahun: true, file: true, tanggal_penetapan: true },
        orderBy: [{ tahun: 'desc' }, { nomor: 'desc' }],
      });

      res.json({ success: true, data: perdes });
    } catch (error) {
      logger.error('Gagal memuat daftar Perdes:', error);
      next(error);
    }
  }

  /** Simpan/perbarui legalitas: nomor Perdes dan tautan ke produk hukum yang sudah ada. */
  async simpanLegalitas(req, res, next) {
    try {
      const desaId = desaIdDari(req);
      if (!desaId) return res.status(403).json({ success: false, message: 'Akun tidak terhubung dengan desa' });

      const nomor = teks(req.body.nomor_perdes);
      if (!nomor) return badRequest(res, 'Nomor Perdes wajib diisi');

      const tahunMentah = teks(req.body.tahun_perdes);
      let tahun = null;
      if (tahunMentah) {
        tahun = parseInt(tahunMentah, 10);
        const batas = new Date().getFullYear() + 1;
        if (!Number.isInteger(tahun) || tahun < 1945 || tahun > batas) {
          return badRequest(res, `Tahun Perdes tidak masuk akal. Isi antara 1945 dan ${batas}.`);
        }
      }

      // Tautan opsional ke Perdes yang sudah ada di modul Produk Hukum. Wajib
      // milik desa ini — tanpa pemeriksaan ini satu desa bisa menautkan Perdes
      // desa lain hanya dengan menebak id-nya.
      let produkHukumId = null;
      const produkHukumMentah = teks(req.body.produk_hukum_id);
      if (produkHukumMentah) {
        const milik = await prisma.produk_hukums.findFirst({
          where: { id: produkHukumMentah, desa_id: desaId },
          select: { id: true },
        });
        if (!milik) return badRequest(res, 'Produk hukum tidak ditemukan pada desa ini');
        produkHukumId = milik.id;
      }

      const sekarang = new Date();
      const data = {
        nomor_perdes: nomor.slice(0, 100),
        tahun_perdes: tahun,
        keterangan: teks(req.body.keterangan).slice(0, 255) || null,
        updated_at: sekarang,
      };
      // Tautan hanya ditimpa bila memang dikirim: menyimpan nomor saja tidak
      // boleh diam-diam melepas berkas yang sudah tertaut.
      if (produkHukumMentah) data.produk_hukum_id = produkHukumId;

      const legalitas = await prisma.kerjasama_desa_legalitas.upsert({
        where: { desa_id: desaId },
        update: data,
        create: {
          desa_id: desaId,
          ...data,
          produk_hukum_id: produkHukumId,
          created_by: BigInt(String(req.user.id)),
          created_at: sekarang,
        },
        include: { produk_hukums: RELASI_PRODUK_HUKUM },
      });

      catat(req, {
        action: 'update',
        description: `${req.user.name || req.user.email} memperbarui legalitas kerja sama desa (Perdes ${nomor})`,
        newValue: { nomor_perdes: nomor, tahun_perdes: tahun, produk_hukum_id: legalitas.produk_hukum_id },
      });

      res.json({ success: true, message: 'Legalitas kerja sama tersimpan', data: bentukLegalitas(legalitas) });
    } catch (error) {
      logger.error('Gagal menyimpan legalitas kerja sama:', error);
      next(error);
    }
  }

  /**
   * Unggah Perdes payung langsung dari modul ini.
   *
   * Barisnya masuk ke tabel produk_hukums yang sama dengan modul Produk Hukum —
   * jenis, singkatan, dan folder berkasnya memakai PADANAN bersama. Jadi dokumen
   * ini juga muncul di menu Produk Hukum bagi petugas yang memegang aksesnya,
   * tanpa operator kerja sama perlu diberi akses ke sana.
   */
  async unggahPerdes(req, res, next) {
    const bersihkan = async () => {
      if (req.file?.path) await fs.unlink(req.file.path).catch(() => {});
    };

    try {
      const desaId = desaIdDari(req);
      if (!desaId) {
        await bersihkan();
        return res.status(403).json({ success: false, message: 'Akun tidak terhubung dengan desa' });
      }
      if (!req.file) return badRequest(res, 'Berkas PDF wajib diunggah');

      const nomor = teks(req.body.nomor_perdes);
      const tahun = parseInt(req.body.tahun_perdes, 10);
      const tanggal = parseTanggal(req.body.tanggal_penetapan);

      const batas = new Date().getFullYear() + 1;
      if (!nomor) {
        await bersihkan();
        return badRequest(res, 'Nomor Perdes wajib diisi');
      }
      if (!Number.isInteger(tahun) || tahun < 1945 || tahun > batas) {
        await bersihkan();
        return badRequest(res, `Tahun Perdes tidak masuk akal. Isi antara 1945 dan ${batas}.`);
      }
      if (!tanggal) {
        await bersihkan();
        return badRequest(res, 'Tanggal penetapan wajib diisi dan harus tanggal yang sah');
      }

      const desa = await prisma.desas.findUnique({ where: { id: desaId }, select: { nama: true } });

      const id = uuidv4();
      const sekarang = new Date();

      const produkHukum = await prisma.produk_hukums.create({
        data: {
          id,
          uuid: id,
          desa_id: desaId,
          judul: (teks(req.body.judul) || PADANAN_PERDES_KERJASAMA.judul()).slice(0, 255),
          nomor: nomor.slice(0, 255),
          tahun,
          jenis: PADANAN_PERDES_KERJASAMA.jenis,
          singkatan_jenis: PADANAN_PERDES_KERJASAMA.singkatan_jenis,
          // Tempat penetapan diambil dari basis data, bukan kiriman klien: kolom
          // ini muncul di dokumen resmi dan akun desa tidak berkepentingan
          // menuliskannya sebagai desa lain.
          tempat_penetapan: (desa?.nama || 'Kabupaten Bogor').slice(0, 255),
          tanggal_penetapan: tanggal,
          status_peraturan: 'berlaku',
          sumber: 'Diunggah desa lewat modul Kerja Sama Desa',
          subjek: PADANAN_PERDES_KERJASAMA.subjek,
          file: req.file.filename,
          created_at: sekarang,
          updated_at: sekarang,
        },
      });

      const legalitas = await prisma.kerjasama_desa_legalitas.upsert({
        where: { desa_id: desaId },
        update: { nomor_perdes: nomor.slice(0, 100), tahun_perdes: tahun, produk_hukum_id: id, updated_at: sekarang },
        create: {
          desa_id: desaId,
          nomor_perdes: nomor.slice(0, 100),
          tahun_perdes: tahun,
          produk_hukum_id: id,
          created_by: BigInt(String(req.user.id)),
          created_at: sekarang,
          updated_at: sekarang,
        },
        include: { produk_hukums: RELASI_PRODUK_HUKUM },
      });

      logger.info(`✅ Perdes kerja sama desa ${desaId} diunggah: ${produkHukum.id}`);
      catat(req, {
        action: 'create',
        description: `${req.user.name || req.user.email} mengunggah Perdes kerja sama desa (${nomor} Tahun ${tahun})`,
        newValue: { produk_hukum_id: id, nomor, tahun },
      });

      res.status(201).json({
        success: true,
        message: 'Perdes tersimpan dan tercatat di Produk Hukum Desa',
        data: bentukLegalitas(legalitas),
      });
    } catch (error) {
      await bersihkan();
      logger.error('Gagal mengunggah Perdes kerja sama:', error);
      next(error);
    }
  }

  /** Daftar kerja sama milik desa ini. */
  async daftar(req, res, next) {
    try {
      const desaId = desaIdDari(req);
      if (!desaId) return res.status(403).json({ success: false, message: 'Akun tidak terhubung dengan desa' });

      const where = { desa_id: desaId };
      if (req.query.tahun) {
        const tahun = parseInt(req.query.tahun, 10);
        if (Number.isInteger(tahun)) where.tahun = tahun;
      }
      if (JENIS_KEYS.includes(req.query.jenis)) where.jenis = req.query.jenis;
      if (BIDANG_KEYS.includes(req.query.bidang)) where.bidang = req.query.bidang;

      const q = teks(req.query.q);
      if (q) where.OR = [{ mitra: { contains: q } }, { sub_bidang: { contains: q } }];

      const baris = await prisma.kerjasama_desa.findMany({
        where,
        select: PILIH_ENTRI,
        orderBy: [{ tahun: 'desc' }, { id: 'desc' }],
      });

      res.json({ success: true, data: baris.map(bentukEntri) });
    } catch (error) {
      logger.error('Gagal memuat daftar kerja sama desa:', error);
      next(error);
    }
  }

  /**
   * Validasi isian entri. Dipakai bersama oleh tambah dan ubah supaya aturannya
   * tidak ditulis dua kali lalu menyimpang.
   */
  static validasiEntri(body) {
    const tahun = parseInt(body.tahun, 10);
    const batas = new Date().getFullYear() + 5;
    if (!Number.isInteger(tahun) || tahun < 2000 || tahun > batas) {
      return { galat: `Tahun kerja sama tidak masuk akal. Isi antara 2000 dan ${batas}.` };
    }
    if (!JENIS_KEYS.includes(body.jenis)) return { galat: 'Jenis kerja sama wajib dipilih' };
    if (!BIDANG_KEYS.includes(body.bidang)) return { galat: 'Bidang kerja sama wajib dipilih' };

    const mitra = teks(body.mitra);
    if (!mitra) return { galat: 'Mitra kerja sama wajib diisi' };

    const mulai = parseTanggal(body.tanggal_mulai);
    const selesai = parseTanggal(body.tanggal_selesai);
    if (mulai === undefined) return { galat: 'Tanggal mulai tidak sah' };
    if (selesai === undefined) return { galat: 'Tanggal selesai tidak sah' };
    if (mulai && selesai && selesai < mulai) {
      return { galat: 'Tanggal selesai mendahului tanggal mulai' };
    }

    return {
      nilai: {
        tahun,
        jenis: body.jenis,
        bidang: body.bidang,
        sub_bidang: teks(body.sub_bidang).slice(0, 255) || null,
        mitra: mitra.slice(0, 255),
        ruang_lingkup: teks(body.ruang_lingkup) || null,
        tanggal_mulai: mulai,
        tanggal_selesai: selesai,
        pelaksanaan: teks(body.pelaksanaan) || null,
      },
    };
  }

  async buat(req, res, next) {
    try {
      const desaId = desaIdDari(req);
      if (!desaId) return res.status(403).json({ success: false, message: 'Akun tidak terhubung dengan desa' });

      const { galat, nilai } = KerjasamaDesaController.validasiEntri(req.body);
      if (galat) return badRequest(res, galat);

      const sekarang = new Date();
      const dibuat = await prisma.kerjasama_desa.create({
        data: {
          desa_id: desaId,
          ...nilai,
          created_by: BigInt(String(req.user.id)),
          created_at: sekarang,
          updated_at: sekarang,
        },
        select: PILIH_ENTRI,
      });

      catat(req, {
        action: 'create',
        entri: dibuat,
        description: `${req.user.name || req.user.email} menambah kerja sama desa dengan ${nilai.mitra} (${nilai.tahun})`,
        newValue: nilai,
      });

      res.status(201).json({ success: true, message: 'Kerja sama tersimpan', data: bentukEntri(dibuat) });
    } catch (error) {
      logger.error('Gagal membuat kerja sama desa:', error);
      next(error);
    }
  }

  /** Ambil entri sekaligus pastikan ia milik desa pemanggil. */
  static async entriMilikDesa(req) {
    const desaId = desaIdDari(req);
    const id = parseId(req.params.id);
    if (!desaId || !id) return null;
    return prisma.kerjasama_desa.findFirst({ where: { id, desa_id: desaId }, select: PILIH_ENTRI });
  }

  async ubah(req, res, next) {
    try {
      const lama = await KerjasamaDesaController.entriMilikDesa(req);
      if (!lama) return notFound(res, 'Kerja sama tidak ditemukan');

      const { galat, nilai } = KerjasamaDesaController.validasiEntri(req.body);
      if (galat) return badRequest(res, galat);

      // Jenis berubah berarti dokumen jenis lama tidak berlaku lagi. Berkasnya
      // dilepas dari baris supaya entri KDPK tidak menyimpan SK BKD yang tidak
      // pernah relevan — dan kelengkapannya tidak terhitung dari berkas yang salah.
      const data = { ...nilai, updated_at: new Date() };
      if (lama.jenis !== nilai.jenis) {
        const dipakai = dokumenUntukJenis(nilai.jenis).map((d) => d.field);
        ['file_permakades', 'file_sk_bkd', 'file_pks_mou'].forEach((field) => {
          if (!dipakai.includes(field)) data[field] = null;
        });
      }

      const diubah = await prisma.kerjasama_desa.update({
        where: { id: lama.id },
        data,
        select: PILIH_ENTRI,
      });

      catat(req, {
        action: 'update',
        entri: diubah,
        description: `${req.user.name || req.user.email} mengubah kerja sama desa dengan ${nilai.mitra}`,
        oldValue: { jenis: lama.jenis, bidang: lama.bidang, mitra: lama.mitra, tahun: lama.tahun },
        newValue: nilai,
      });

      res.json({ success: true, message: 'Kerja sama diperbarui', data: bentukEntri(diubah) });
    } catch (error) {
      logger.error('Gagal mengubah kerja sama desa:', error);
      next(error);
    }
  }

  async hapus(req, res, next) {
    try {
      const entri = await KerjasamaDesaController.entriMilikDesa(req);
      if (!entri) return notFound(res, 'Kerja sama tidak ditemukan');

      await prisma.kerjasama_desa.delete({ where: { id: entri.id } });

      // Berkasnya ikut dibersihkan — baris hilang tapi PDF-nya tinggal berarti
      // folder unggahan tumbuh terus tanpa ada yang bisa membukanya lagi.
      await Promise.all(
        ['file_permakades', 'file_sk_bkd', 'file_pks_mou']
          .map((field) => entri[field])
          .filter(Boolean)
          .map((berkas) => fs.unlink(path.join(FOLDER_DOKUMEN, berkas)).catch(() => {})),
      );

      catat(req, {
        action: 'delete',
        entri,
        description: `${req.user.name || req.user.email} menghapus kerja sama desa dengan ${entri.mitra}`,
        oldValue: { mitra: entri.mitra, tahun: entri.tahun, jenis: entri.jenis },
      });

      res.json({ success: true, message: 'Kerja sama dihapus' });
    } catch (error) {
      logger.error('Gagal menghapus kerja sama desa:', error);
      next(error);
    }
  }

  /** Unggah satu dokumen kegiatan. `field_name` harus cocok dengan jenis entrinya. */
  async unggahDokumen(req, res, next) {
    const bersihkan = async () => {
      if (req.file?.path) await fs.unlink(req.file.path).catch(() => {});
    };

    try {
      const entri = await KerjasamaDesaController.entriMilikDesa(req);
      if (!entri) {
        await bersihkan();
        return notFound(res, 'Kerja sama tidak ditemukan');
      }
      if (!req.file) return badRequest(res, 'Berkas PDF wajib diunggah');

      const fieldName = teks(req.body.field_name);
      const diizinkan = dokumenUntukJenis(entri.jenis).map((d) => d.field);
      if (!diizinkan.includes(fieldName)) {
        await bersihkan();
        return badRequest(
          res,
          `Dokumen "${fieldName}" tidak berlaku untuk jenis kerja sama ini. Yang berlaku: ${diizinkan.join(', ')}.`,
        );
      }

      const berkasLama = entri[fieldName];

      const diubah = await prisma.kerjasama_desa.update({
        where: { id: entri.id },
        data: { [fieldName]: req.file.filename, updated_at: new Date() },
        select: PILIH_ENTRI,
      });

      // Unggah ulang adalah PENGGANTIAN. Berkas lama dibuang setelah barisnya
      // menunjuk yang baru, bukan sebelumnya — kalau update gagal, yang lama
      // masih utuh.
      if (berkasLama) await fs.unlink(path.join(FOLDER_DOKUMEN, berkasLama)).catch(() => {});

      catat(req, {
        action: 'update',
        entri: diubah,
        description: `${req.user.name || req.user.email} mengunggah dokumen ${fieldName} kerja sama dengan ${entri.mitra}`,
        newValue: { field: fieldName, file: req.file.filename },
      });

      res.json({ success: true, message: 'Dokumen tersimpan', data: bentukEntri(diubah) });
    } catch (error) {
      await bersihkan();
      logger.error('Gagal mengunggah dokumen kerja sama:', error);
      next(error);
    }
  }
}

module.exports = new KerjasamaDesaController();
module.exports.FOLDER_DOKUMEN = FOLDER_DOKUMEN;
module.exports.FOLDER_PRODUK_HUKUM = FOLDER_PRODUK_HUKUM;
