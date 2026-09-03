// src/controllers/arsipBarang.controller.js
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const QRCode = require('qrcode');
const { Prisma } = require('@prisma/client');
const prisma = require('../config/prisma');
const logger = require('../utils/logger');
const ActivityLogger = require('../utils/activityLogger');

const BIDANG_SEKRETARIAT = 2;
const UPLOAD_DIR = 'storage/uploads/arsip-barang';
const KODE_PREFIX = 'DPMD-SEK';

const KONDISI_LABEL = {
  baik: 'Baik',
  kurang_baik: 'Kurang Baik',
  rusak_ringan: 'Rusak Ringan',
  rusak_berat: 'Rusak Berat'
};

// Base URL untuk QR. WAJIB absolut & permanen — label yang sudah dicetak
// tidak bisa diperbaiki dari jarak jauh kalau URL-nya salah.
const getBaseUrl = () =>
  (process.env.BASE_URL || 'http://localhost:5173').replace(/\/+$/, '');

// QR discan pakai kamera bawaan HP → membuka URL ini di browser.
// Mengarah ke halaman Sekretariat (wajib login), bukan halaman publik.
const buildScanUrl = (token) => `${getBaseUrl()}/sekretariat/arsip-barang/qr/${token}`;

// Prisma mengembalikan BigInt & Decimal yang tidak bisa di-JSON.stringify.
// Decimal WAJIB dicek pakai instanceof: Prisma Client di-bundle dalam bentuk
// terminifikasi, jadi constructor.name-nya bukan "Decimal" melainkan huruf acak.
// Tanpa ini, nilai_perolehan bocor keluar sebagai objek internal {s,e,d}.
const serialize = (value) => {
  if (value === null || value === undefined) return value;
  if (typeof value === 'bigint') return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (Prisma.Decimal.isDecimal(value)) return Number(value);
  if (Array.isArray(value)) return value.map(serialize);
  if (typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, serialize(v)]));
  }
  return value;
};

const parseIntOrNull = (v) => {
  if (v === undefined || v === null || v === '') return null;
  const n = parseInt(v, 10);
  return Number.isNaN(n) ? null : n;
};

const parseDateOrNull = (v) => {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
};

const emptyToNull = (v) => {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
};

/**
 * Simpan foto barang: selalu di-re-encode ke WebP.
 * .rotate() penting — foto kamera HP menyimpan orientasi di EXIF, tanpa ini
 * foto portrait tampil miring setelah re-encode.
 */
const simpanFoto = async (buffer, kodeBarang) => {
  if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

  const safeKode = kodeBarang.replace(/[^A-Za-z0-9-]/g, '_');
  const filename = `${safeKode}_${Date.now()}.webp`;

  await sharp(buffer)
    .rotate()
    .resize(1280, 1280, { fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 80 })
    .toFile(path.join(UPLOAD_DIR, filename));

  return `${UPLOAD_DIR}/${filename}`;
};

const hapusFoto = (fotoPath) => {
  if (!fotoPath) return;
  try {
    // Jangan pernah keluar dari folder upload, apa pun isi kolomnya.
    const resolved = path.resolve(fotoPath);
    const allowed = path.resolve(UPLOAD_DIR);
    if (!resolved.startsWith(allowed)) return;
    if (fs.existsSync(resolved)) fs.unlinkSync(resolved);
  } catch (error) {
    logger.warn(`[ArsipBarang] Gagal hapus foto ${fotoPath}: ${error.message}`);
  }
};

/**
 * Kode barang berurutan per tahun: DPMD-SEK-2026-0001.
 * Dipanggil di dalam transaksi; tabrakan antar-request tetap mungkin dan
 * ditangkap unique constraint di createBarang (retry).
 */
const generateKodeBarang = async (tx, tahun) => {
  const prefix = `${KODE_PREFIX}-${tahun}-`;
  const terakhir = await tx.arsip_barang.findFirst({
    where: { kode_barang: { startsWith: prefix } },
    orderBy: { kode_barang: 'desc' },
    select: { kode_barang: true }
  });

  const urutTerakhir = terakhir ? parseInt(terakhir.kode_barang.slice(prefix.length), 10) : 0;
  const urutBaru = (Number.isNaN(urutTerakhir) ? 0 : urutTerakhir) + 1;

  return `${prefix}${String(urutBaru).padStart(4, '0')}`;
};

const generateToken = () => crypto.randomBytes(12).toString('hex'); // 24 char

const includeRelasi = {
  arsip_barang_kategori: { select: { id: true, nama: true, kode: true } },
  users_arsip_barang_pemegang_user_idTousers: { select: { id: true, name: true, email: true } },
  users_arsip_barang_created_byTousers: { select: { id: true, name: true } }
};

const bentukBarang = (barang) => {
  if (!barang) return null;
  const {
    arsip_barang_kategori: kategori,
    users_arsip_barang_pemegang_user_idTousers: pemegangUser,
    users_arsip_barang_created_byTousers: pembuat,
    ...rest
  } = barang;

  return serialize({
    ...rest,
    kondisi_label: KONDISI_LABEL[barang.kondisi] || barang.kondisi,
    kategori: kategori || null,
    pemegang: pemegangUser
      ? { id: pemegangUser.id, nama: pemegangUser.name, email: pemegangUser.email }
      : barang.pemegang_nama
        ? { id: null, nama: barang.pemegang_nama, email: null }
        : null,
    dibuat_oleh: pembuat ? { id: pembuat.id, nama: pembuat.name } : null,
    scan_url: buildScanUrl(barang.public_token)
  });
};

const catatMutasi = async (tx, { barangId, jenis, nilaiLama, nilaiBaru, catatan, user }) => {
  await tx.arsip_barang_mutasi.create({
    data: {
      barang_id: BigInt(barangId),
      jenis,
      nilai_lama: nilaiLama ? String(nilaiLama).substring(0, 255) : null,
      nilai_baru: nilaiBaru ? String(nilaiBaru).substring(0, 255) : null,
      catatan: catatan || null,
      user_id: user?.id ? BigInt(user.id) : null,
      user_name: user?.name || null
    }
  });
};

class ArsipBarangController {
  // GET /api/arsip-barang/kategori
  async getKategori(req, res, next) {
    try {
      const kategori = await prisma.arsip_barang_kategori.findMany({
        where: { is_active: true },
        orderBy: { nama: 'asc' },
        select: { id: true, nama: true, kode: true, deskripsi: true }
      });
      return res.json({ success: true, data: serialize(kategori) });
    } catch (error) {
      logger.error('[ArsipBarang] Error fetching kategori:', error);
      next(error);
    }
  }

  // GET /api/arsip-barang/lokasi — daftar lokasi terpakai (untuk filter & autocomplete)
  async getLokasi(req, res, next) {
    try {
      const rows = await prisma.arsip_barang.findMany({
        where: { lokasi: { not: null } },
        distinct: ['lokasi'],
        orderBy: { lokasi: 'asc' },
        select: { lokasi: true }
      });
      return res.json({ success: true, data: rows.map((r) => r.lokasi).filter(Boolean) });
    } catch (error) {
      logger.error('[ArsipBarang] Error fetching lokasi:', error);
      next(error);
    }
  }

  // GET /api/arsip-barang/stats
  async getStats(req, res, next) {
    try {
      const [total, aktif, dihapuskan, baik, kurangBaik, rusakRingan, rusakBerat, totalScan] = await Promise.all([
        prisma.arsip_barang.count(),
        prisma.arsip_barang.count({ where: { status: 'aktif' } }),
        prisma.arsip_barang.count({ where: { status: 'dihapuskan' } }),
        prisma.arsip_barang.count({ where: { status: 'aktif', kondisi: 'baik' } }),
        prisma.arsip_barang.count({ where: { status: 'aktif', kondisi: 'kurang_baik' } }),
        prisma.arsip_barang.count({ where: { status: 'aktif', kondisi: 'rusak_ringan' } }),
        prisma.arsip_barang.count({ where: { status: 'aktif', kondisi: 'rusak_berat' } }),
        prisma.arsip_barang_scan_log.count()
      ]);

      const nilai = await prisma.arsip_barang.aggregate({
        where: { status: 'aktif' },
        _sum: { nilai_perolehan: true }
      });

      return res.json({
        success: true,
        data: {
          total,
          aktif,
          dihapuskan,
          kondisi: { baik, kurang_baik: kurangBaik, rusak_ringan: rusakRingan, rusak_berat: rusakBerat },
          total_scan: totalScan,
          total_nilai_perolehan: nilai._sum.nilai_perolehan ? Number(nilai._sum.nilai_perolehan) : 0
        }
      });
    } catch (error) {
      logger.error('[ArsipBarang] Error fetching stats:', error);
      next(error);
    }
  }

  // GET /api/arsip-barang
  async getAll(req, res, next) {
    try {
      const { q, kategori_id, kondisi, status, lokasi } = req.query;
      const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
      const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 100);

      const where = {};
      if (q && q.trim()) {
        const term = q.trim();
        where.OR = [
          { nama: { contains: term } },
          { kode_barang: { contains: term } },
          { merk_tipe: { contains: term } },
          { nomor_seri: { contains: term } },
          { lokasi: { contains: term } }
        ];
      }
      if (parseIntOrNull(kategori_id)) where.kategori_id = BigInt(kategori_id);
      if (kondisi && KONDISI_LABEL[kondisi]) where.kondisi = kondisi;
      if (status && ['aktif', 'dihapuskan'].includes(status)) where.status = status;
      if (lokasi && lokasi.trim()) where.lokasi = lokasi.trim();

      const [items, total] = await Promise.all([
        prisma.arsip_barang.findMany({
          where,
          include: includeRelasi,
          orderBy: { created_at: 'desc' },
          skip: (page - 1) * limit,
          take: limit
        }),
        prisma.arsip_barang.count({ where })
      ]);

      return res.json({
        success: true,
        data: items.map(bentukBarang),
        pagination: { page, limit, total, total_pages: Math.ceil(total / limit) }
      });
    } catch (error) {
      logger.error('[ArsipBarang] Error fetching list:', error);
      next(error);
    }
  }

  // GET /api/arsip-barang/:id
  async getById(req, res, next) {
    try {
      const id = parseIntOrNull(req.params.id);
      if (!id) return res.status(400).json({ success: false, message: 'ID tidak valid' });

      const barang = await prisma.arsip_barang.findUnique({
        where: { id: BigInt(id) },
        include: includeRelasi
      });

      if (!barang) {
        return res.status(404).json({ success: false, message: 'Barang tidak ditemukan' });
      }

      const [mutasi, scanLog, totalScan] = await Promise.all([
        prisma.arsip_barang_mutasi.findMany({
          where: { barang_id: BigInt(id) },
          orderBy: { created_at: 'desc' },
          take: 50
        }),
        prisma.arsip_barang_scan_log.findMany({
          where: { barang_id: BigInt(id) },
          orderBy: { created_at: 'desc' },
          take: 20
        }),
        prisma.arsip_barang_scan_log.count({ where: { barang_id: BigInt(id) } })
      ]);

      return res.json({
        success: true,
        data: {
          ...bentukBarang(barang),
          riwayat_mutasi: serialize(mutasi),
          riwayat_scan: serialize(scanLog),
          total_scan: totalScan
        }
      });
    } catch (error) {
      logger.error('[ArsipBarang] Error fetching detail:', error);
      next(error);
    }
  }

  // POST /api/arsip-barang
  async create(req, res, next) {
    try {
      const { nama } = req.body;
      if (!nama || !nama.trim()) {
        return res.status(400).json({ success: false, message: 'Nama barang wajib diisi' });
      }

      const kategoriId = parseIntOrNull(req.body.kategori_id);
      if (kategoriId) {
        const kategoriAda = await prisma.arsip_barang_kategori.findUnique({
          where: { id: BigInt(kategoriId) },
          select: { id: true }
        });
        if (!kategoriAda) {
          return res.status(400).json({ success: false, message: 'Kategori tidak ditemukan' });
        }
      }

      const tahun = new Date().getFullYear();
      const user = req.user;
      let fotoPath = null;

      // Retry: kode_barang berurutan bisa bentrok bila dua petugas menyimpan bersamaan.
      let barang = null;
      let percobaan = 0;
      while (!barang) {
        percobaan += 1;
        try {
          barang = await prisma.$transaction(async (tx) => {
            const kodeBarang = await generateKodeBarang(tx, tahun);

            if (req.file && !fotoPath) {
              fotoPath = await simpanFoto(req.file.buffer, kodeBarang);
            }

            const dibuat = await tx.arsip_barang.create({
              data: {
                kode_barang: kodeBarang,
                public_token: generateToken(),
                nama: nama.trim(),
                kategori_id: kategoriId ? BigInt(kategoriId) : null,
                merk_tipe: emptyToNull(req.body.merk_tipe),
                nomor_seri: emptyToNull(req.body.nomor_seri),
                foto: fotoPath,
                jumlah: parseIntOrNull(req.body.jumlah) || 1,
                satuan: emptyToNull(req.body.satuan) || 'Unit',
                kondisi: KONDISI_LABEL[req.body.kondisi] ? req.body.kondisi : 'baik',
                lokasi: emptyToNull(req.body.lokasi),
                pemegang_user_id: parseIntOrNull(req.body.pemegang_user_id)
                  ? BigInt(req.body.pemegang_user_id)
                  : null,
                pemegang_nama: emptyToNull(req.body.pemegang_nama),
                tanggal_perolehan: parseDateOrNull(req.body.tanggal_perolehan),
                sumber_dana: ['apbd', 'apbn', 'hibah', 'lainnya'].includes(req.body.sumber_dana)
                  ? req.body.sumber_dana
                  : null,
                nilai_perolehan: emptyToNull(req.body.nilai_perolehan),
                nomor_kontrak: emptyToNull(req.body.nomor_kontrak),
                nomor_faktur: emptyToNull(req.body.nomor_faktur),
                keterangan: emptyToNull(req.body.keterangan),
                bidang_id: BigInt(BIDANG_SEKRETARIAT),
                created_by: user?.id ? BigInt(user.id) : null,
                updated_by: user?.id ? BigInt(user.id) : null
              },
              include: includeRelasi
            });

            await catatMutasi(tx, {
              barangId: dibuat.id,
              jenis: 'lainnya',
              nilaiBaru: 'Barang didaftarkan',
              catatan: `Barang terdaftar dengan kode ${kodeBarang}`,
              user
            });

            return dibuat;
          });
        } catch (error) {
          const bentrokKode = error.code === 'P2002';
          if (bentrokKode && percobaan < 3) {
            logger.warn(`[ArsipBarang] Kode bentrok, percobaan ulang ke-${percobaan}`);
            continue;
          }
          if (fotoPath) hapusFoto(fotoPath); // jangan tinggalkan foto yatim
          throw error;
        }
      }

      ActivityLogger.log({
        userId: user?.id,
        userName: user?.name,
        userRole: user?.role,
        bidangId: BIDANG_SEKRETARIAT,
        module: 'arsip_barang',
        action: 'create',
        entityType: 'arsip_barang',
        entityId: barang.id,
        entityName: barang.nama,
        description: `${user?.name} mendaftarkan barang "${barang.nama}" (${barang.kode_barang})`,
        ipAddress: ActivityLogger.getIpFromRequest(req),
        userAgent: ActivityLogger.getUserAgentFromRequest(req)
      });

      return res.status(201).json({
        success: true,
        message: `Barang tersimpan dengan kode ${barang.kode_barang}`,
        data: bentukBarang(barang)
      });
    } catch (error) {
      logger.error('[ArsipBarang] Error create:', error);
      next(error);
    }
  }

  // PUT /api/arsip-barang/:id
  async update(req, res, next) {
    try {
      const id = parseIntOrNull(req.params.id);
      if (!id) return res.status(400).json({ success: false, message: 'ID tidak valid' });

      const lama = await prisma.arsip_barang.findUnique({ where: { id: BigInt(id) } });
      if (!lama) return res.status(404).json({ success: false, message: 'Barang tidak ditemukan' });

      const user = req.user;
      // updated_at diisi manual: kolom ini tidak punya ON UPDATE saat tabel dibuat
      // lewat `prisma db push` (Prisma tidak memodelkan ON UPDATE CURRENT_TIMESTAMP).
      const data = { updated_by: user?.id ? BigInt(user.id) : null, updated_at: new Date() };

      if (req.body.nama !== undefined) {
        if (!req.body.nama.trim()) {
          return res.status(400).json({ success: false, message: 'Nama barang tidak boleh kosong' });
        }
        data.nama = req.body.nama.trim();
      }
      if (req.body.kategori_id !== undefined) {
        const kategoriId = parseIntOrNull(req.body.kategori_id);
        data.kategori_id = kategoriId ? BigInt(kategoriId) : null;
      }
      if (req.body.merk_tipe !== undefined) data.merk_tipe = emptyToNull(req.body.merk_tipe);
      if (req.body.nomor_seri !== undefined) data.nomor_seri = emptyToNull(req.body.nomor_seri);
      if (req.body.jumlah !== undefined) data.jumlah = parseIntOrNull(req.body.jumlah) || 1;
      if (req.body.satuan !== undefined) data.satuan = emptyToNull(req.body.satuan) || 'Unit';
      if (req.body.lokasi !== undefined) data.lokasi = emptyToNull(req.body.lokasi);
      if (req.body.kondisi !== undefined && KONDISI_LABEL[req.body.kondisi]) {
        data.kondisi = req.body.kondisi;
      }
      if (req.body.pemegang_user_id !== undefined) {
        const pid = parseIntOrNull(req.body.pemegang_user_id);
        data.pemegang_user_id = pid ? BigInt(pid) : null;
      }
      if (req.body.pemegang_nama !== undefined) data.pemegang_nama = emptyToNull(req.body.pemegang_nama);
      if (req.body.tanggal_perolehan !== undefined) {
        data.tanggal_perolehan = parseDateOrNull(req.body.tanggal_perolehan);
      }
      if (req.body.sumber_dana !== undefined) {
        data.sumber_dana = ['apbd', 'apbn', 'hibah', 'lainnya'].includes(req.body.sumber_dana)
          ? req.body.sumber_dana
          : null;
      }
      if (req.body.nilai_perolehan !== undefined) data.nilai_perolehan = emptyToNull(req.body.nilai_perolehan);
      if (req.body.nomor_kontrak !== undefined) data.nomor_kontrak = emptyToNull(req.body.nomor_kontrak);
      if (req.body.nomor_faktur !== undefined) data.nomor_faktur = emptyToNull(req.body.nomor_faktur);
      if (req.body.keterangan !== undefined) data.keterangan = emptyToNull(req.body.keterangan);

      let fotoBaru = null;
      if (req.file) {
        fotoBaru = await simpanFoto(req.file.buffer, lama.kode_barang);
        data.foto = fotoBaru;
      }

      const barang = await prisma.$transaction(async (tx) => {
        const diperbarui = await tx.arsip_barang.update({
          where: { id: BigInt(id) },
          data,
          include: includeRelasi
        });

        // Perubahan yang bermakna untuk pelacakan dicatat sebagai mutasi.
        if (data.lokasi !== undefined && data.lokasi !== lama.lokasi) {
          await catatMutasi(tx, {
            barangId: id,
            jenis: 'lokasi',
            nilaiLama: lama.lokasi,
            nilaiBaru: data.lokasi,
            catatan: 'Diubah lewat form edit',
            user
          });
        }
        if (data.kondisi !== undefined && data.kondisi !== lama.kondisi) {
          await catatMutasi(tx, {
            barangId: id,
            jenis: 'kondisi',
            nilaiLama: KONDISI_LABEL[lama.kondisi],
            nilaiBaru: KONDISI_LABEL[data.kondisi],
            catatan: 'Diubah lewat form edit',
            user
          });
        }

        return diperbarui;
      });

      if (fotoBaru && lama.foto && lama.foto !== fotoBaru) hapusFoto(lama.foto);

      ActivityLogger.log({
        userId: user?.id,
        userName: user?.name,
        userRole: user?.role,
        bidangId: BIDANG_SEKRETARIAT,
        module: 'arsip_barang',
        action: 'update',
        entityType: 'arsip_barang',
        entityId: barang.id,
        entityName: barang.nama,
        description: `${user?.name} memperbarui barang "${barang.nama}" (${barang.kode_barang})`,
        ipAddress: ActivityLogger.getIpFromRequest(req),
        userAgent: ActivityLogger.getUserAgentFromRequest(req)
      });

      return res.json({ success: true, message: 'Barang diperbarui', data: bentukBarang(barang) });
    } catch (error) {
      logger.error('[ArsipBarang] Error update:', error);
      next(error);
    }
  }

  // POST /api/arsip-barang/:id/mutasi — pindah lokasi / ganti kondisi / ganti pemegang
  async createMutasi(req, res, next) {
    try {
      const id = parseIntOrNull(req.params.id);
      if (!id) return res.status(400).json({ success: false, message: 'ID tidak valid' });

      const lama = await prisma.arsip_barang.findUnique({
        where: { id: BigInt(id) },
        include: { users_arsip_barang_pemegang_user_idTousers: { select: { name: true } } }
      });
      if (!lama) return res.status(404).json({ success: false, message: 'Barang tidak ditemukan' });

      const { lokasi, kondisi, pemegang_user_id, pemegang_nama, catatan } = req.body;
      const user = req.user;

      const adaPerubahan =
        lokasi !== undefined || kondisi !== undefined ||
        pemegang_user_id !== undefined || pemegang_nama !== undefined;

      if (!adaPerubahan) {
        return res.status(400).json({
          success: false,
          message: 'Tidak ada perubahan. Isi minimal salah satu: lokasi, kondisi, atau pemegang.'
        });
      }

      if (kondisi !== undefined && !KONDISI_LABEL[kondisi]) {
        return res.status(400).json({ success: false, message: 'Kondisi tidak valid' });
      }

      const barang = await prisma.$transaction(async (tx) => {
        // updated_at diisi manual: kolom ini tidak punya ON UPDATE saat tabel dibuat
      // lewat `prisma db push` (Prisma tidak memodelkan ON UPDATE CURRENT_TIMESTAMP).
      const data = { updated_by: user?.id ? BigInt(user.id) : null, updated_at: new Date() };

        if (lokasi !== undefined && emptyToNull(lokasi) !== lama.lokasi) {
          data.lokasi = emptyToNull(lokasi);
          await catatMutasi(tx, {
            barangId: id, jenis: 'lokasi',
            nilaiLama: lama.lokasi, nilaiBaru: data.lokasi, catatan, user
          });
        }

        if (kondisi !== undefined && kondisi !== lama.kondisi) {
          data.kondisi = kondisi;
          await catatMutasi(tx, {
            barangId: id, jenis: 'kondisi',
            nilaiLama: KONDISI_LABEL[lama.kondisi], nilaiBaru: KONDISI_LABEL[kondisi], catatan, user
          });
        }

        const pemegangLamaNama =
          lama.users_arsip_barang_pemegang_user_idTousers?.name || lama.pemegang_nama || null;

        if (pemegang_user_id !== undefined || pemegang_nama !== undefined) {
          const pid = parseIntOrNull(pemegang_user_id);
          let pemegangBaruNama = emptyToNull(pemegang_nama);

          if (pid) {
            const u = await tx.users.findUnique({ where: { id: BigInt(pid) }, select: { name: true } });
            if (!u) throw Object.assign(new Error('Pegawai pemegang tidak ditemukan'), { status: 400 });
            data.pemegang_user_id = BigInt(pid);
            data.pemegang_nama = null;
            pemegangBaruNama = u.name;
          } else if (pemegang_user_id !== undefined) {
            data.pemegang_user_id = null;
          }
          if (pemegang_nama !== undefined && !pid) data.pemegang_nama = pemegangBaruNama;

          if (pemegangBaruNama !== pemegangLamaNama) {
            await catatMutasi(tx, {
              barangId: id, jenis: 'pemegang',
              nilaiLama: pemegangLamaNama, nilaiBaru: pemegangBaruNama, catatan, user
            });
          }
        }

        return tx.arsip_barang.update({
          where: { id: BigInt(id) },
          data,
          include: includeRelasi
        });
      });

      ActivityLogger.log({
        userId: user?.id,
        userName: user?.name,
        userRole: user?.role,
        bidangId: BIDANG_SEKRETARIAT,
        module: 'arsip_barang',
        action: 'update',
        entityType: 'arsip_barang',
        entityId: barang.id,
        entityName: barang.nama,
        description: `${user?.name} mencatat mutasi barang "${barang.nama}" (${barang.kode_barang})`,
        ipAddress: ActivityLogger.getIpFromRequest(req),
        userAgent: ActivityLogger.getUserAgentFromRequest(req)
      });

      return res.json({ success: true, message: 'Mutasi tercatat', data: bentukBarang(barang) });
    } catch (error) {
      if (error.status === 400) {
        return res.status(400).json({ success: false, message: error.message });
      }
      logger.error('[ArsipBarang] Error mutasi:', error);
      next(error);
    }
  }

  // POST /api/arsip-barang/:id/penghapusan — penghapusan aset (bukan hapus data)
  async penghapusanAset(req, res, next) {
    try {
      const id = parseIntOrNull(req.params.id);
      if (!id) return res.status(400).json({ success: false, message: 'ID tidak valid' });

      const lama = await prisma.arsip_barang.findUnique({ where: { id: BigInt(id) } });
      if (!lama) return res.status(404).json({ success: false, message: 'Barang tidak ditemukan' });

      const { alasan_penghapusan, nomor_ba_penghapusan, tanggal_penghapusan, batalkan } = req.body;
      const user = req.user;

      // Pemulihan barang yang terlanjur dihapuskan
      if (batalkan === true || batalkan === 'true') {
        const dipulihkan = await prisma.$transaction(async (tx) => {
          await catatMutasi(tx, {
            barangId: id, jenis: 'status',
            nilaiLama: 'Dihapuskan', nilaiBaru: 'Aktif',
            catatan: 'Penghapusan dibatalkan', user
          });
          return tx.arsip_barang.update({
            where: { id: BigInt(id) },
            data: {
              status: 'aktif',
              tanggal_penghapusan: null,
              alasan_penghapusan: null,
              nomor_ba_penghapusan: null,
              updated_by: user?.id ? BigInt(user.id) : null,
              updated_at: new Date()
            },
            include: includeRelasi
          });
        });
        return res.json({ success: true, message: 'Status barang dipulihkan', data: bentukBarang(dipulihkan) });
      }

      if (!alasan_penghapusan || !alasan_penghapusan.trim()) {
        return res.status(400).json({ success: false, message: 'Alasan penghapusan wajib diisi' });
      }
      if (lama.status === 'dihapuskan') {
        return res.status(400).json({ success: false, message: 'Barang sudah berstatus dihapuskan' });
      }

      const barang = await prisma.$transaction(async (tx) => {
        await catatMutasi(tx, {
          barangId: id, jenis: 'status',
          nilaiLama: 'Aktif', nilaiBaru: 'Dihapuskan',
          catatan: alasan_penghapusan.trim(), user
        });
        return tx.arsip_barang.update({
          where: { id: BigInt(id) },
          data: {
            status: 'dihapuskan',
            tanggal_penghapusan: parseDateOrNull(tanggal_penghapusan) || new Date(),
            alasan_penghapusan: alasan_penghapusan.trim(),
            nomor_ba_penghapusan: emptyToNull(nomor_ba_penghapusan),
            updated_by: user?.id ? BigInt(user.id) : null,
            updated_at: new Date()
          },
          include: includeRelasi
        });
      });

      ActivityLogger.log({
        userId: user?.id,
        userName: user?.name,
        userRole: user?.role,
        bidangId: BIDANG_SEKRETARIAT,
        module: 'arsip_barang',
        action: 'update',
        entityType: 'arsip_barang',
        entityId: barang.id,
        entityName: barang.nama,
        description: `${user?.name} menghapuskan aset "${barang.nama}" (${barang.kode_barang})`,
        ipAddress: ActivityLogger.getIpFromRequest(req),
        userAgent: ActivityLogger.getUserAgentFromRequest(req)
      });

      return res.json({ success: true, message: 'Barang ditandai dihapuskan', data: bentukBarang(barang) });
    } catch (error) {
      logger.error('[ArsipBarang] Error penghapusan:', error);
      next(error);
    }
  }

  // GET /api/arsip-barang/:id/label — data label untuk dicetak (QR + identitas)
  async getLabel(req, res, next) {
    try {
      const id = parseIntOrNull(req.params.id);
      if (!id) return res.status(400).json({ success: false, message: 'ID tidak valid' });

      const barang = await prisma.arsip_barang.findUnique({
        where: { id: BigInt(id) },
        include: { arsip_barang_kategori: { select: { nama: true } } }
      });
      if (!barang) return res.status(404).json({ success: false, message: 'Barang tidak ditemukan' });

      const scanUrl = buildScanUrl(barang.public_token);

      // Level H: label ditempel di barang yang kena gesek/kotor — QR tetap terbaca
      // walau sebagian permukaannya rusak.
      const qrDataUrl = await QRCode.toDataURL(scanUrl, {
        errorCorrectionLevel: 'H',
        margin: 1,
        width: 600
      });

      return res.json({
        success: true,
        data: {
          id: barang.id.toString(),
          kode_barang: barang.kode_barang,
          nama: barang.nama,
          kategori: barang.arsip_barang_kategori?.nama || null,
          lokasi: barang.lokasi,
          scan_url: scanUrl,
          qr_data_url: qrDataUrl
        }
      });
    } catch (error) {
      logger.error('[ArsipBarang] Error label:', error);
      next(error);
    }
  }

  // DELETE /api/arsip-barang/:id
  async remove(req, res, next) {
    try {
      const id = parseIntOrNull(req.params.id);
      if (!id) return res.status(400).json({ success: false, message: 'ID tidak valid' });

      const barang = await prisma.arsip_barang.findUnique({ where: { id: BigInt(id) } });
      if (!barang) return res.status(404).json({ success: false, message: 'Barang tidak ditemukan' });

      await prisma.arsip_barang.delete({ where: { id: BigInt(id) } });
      hapusFoto(barang.foto);

      ActivityLogger.log({
        userId: req.user?.id,
        userName: req.user?.name,
        userRole: req.user?.role,
        bidangId: BIDANG_SEKRETARIAT,
        module: 'arsip_barang',
        action: 'delete',
        entityType: 'arsip_barang',
        entityId: barang.id,
        entityName: barang.nama,
        description: `${req.user?.name} menghapus data barang "${barang.nama}" (${barang.kode_barang})`,
        ipAddress: ActivityLogger.getIpFromRequest(req),
        userAgent: ActivityLogger.getUserAgentFromRequest(req)
      });

      return res.json({ success: true, message: 'Data barang dihapus' });
    } catch (error) {
      logger.error('[ArsipBarang] Error delete:', error);
      next(error);
    }
  }

  /**
   * GET /api/arsip-barang/qr/:token — dipanggil saat QR di label discan.
   * QR memuat token, bukan id, agar URL label tidak bisa ditebak berurutan.
   * Mengembalikan id barang supaya frontend mengarahkan ke halaman detail,
   * sekaligus mencatat scan.
   */
  async resolveToken(req, res, next) {
    try {
      const { token } = req.params;

      if (!token || !/^[a-f0-9]{24}$/.test(token)) {
        return res.status(404).json({ success: false, message: 'Kode QR tidak dikenali' });
      }

      const barang = await prisma.arsip_barang.findUnique({
        where: { public_token: token },
        select: { id: true, nama: true, kode_barang: true }
      });

      if (!barang) {
        return res.status(404).json({ success: false, message: 'Barang tidak ditemukan' });
      }

      const user = req.user;

      // Pencatatan scan tidak boleh menggagalkan pembukaan data barang.
      prisma.arsip_barang_scan_log
        .create({
          data: {
            barang_id: barang.id,
            source: 'internal',
            user_id: user?.id ? BigInt(user.id) : null,
            user_name: user?.name || null,
            ip_address: ActivityLogger.getIpFromRequest(req),
            user_agent: String(ActivityLogger.getUserAgentFromRequest(req) || '').substring(0, 500)
          }
        })
        .catch((e) => logger.warn(`[ArsipBarang] Gagal catat scan: ${e.message}`));

      return res.json({
        success: true,
        data: {
          id: barang.id.toString(),
          nama: barang.nama,
          kode_barang: barang.kode_barang
        }
      });
    } catch (error) {
      logger.error('[ArsipBarang] Error resolve token:', error);
      next(error);
    }
  }
}

module.exports = new ArsipBarangController();
