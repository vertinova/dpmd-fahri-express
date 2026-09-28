const express = require('express');
const router = express.Router();
const prisma = require('../config/prisma');
const logger = require('../utils/logger');
const { auth, checkRole } = require('../middlewares/auth');
const {
  jenisAparatur, bakuJabatan, peringkatJabatan,
} = require('../controllers/pemdes-aparatur.controller');

/**
 * Aparatur desa di wilayah akun kecamatan — HANYA MEMBACA.
 *
 * Sengaja hanya GET. Menyunting tetap hak desa, verifikasi tetap hak Bidang
 * Pemerintahan Desa; kecamatan memantau.
 *
 * Berkas pribadi (KTP, KK, akta, ijazah, kartu BPJS) dan nomor BPJS TIDAK
 * dikirim — yang dikirim hanya penanda ada/tidaknya. Pemantauan tidak butuh
 * isi dokumen identitas, dan setiap salinan tambahan data pribadi adalah
 * kebocoran yang menunggu terjadi. Pas foto tetap dikirim untuk wajah direktori.
 */

const KOLOM_BERKAS = [
  ['file_pas_foto', 'Pas Foto'],
  ['file_ktp', 'KTP'],
  ['file_kk', 'Kartu Keluarga'],
  ['file_akta_kelahiran', 'Akta Kelahiran'],
  ['file_ijazah_terakhir', 'Ijazah Terakhir'],
  ['file_bpjs_kesehatan', 'Kartu BPJS Kesehatan'],
  ['file_bpjs_ketenagakerjaan', 'Kartu BPJS Ketenagakerjaan'],
];

const ada = (v) => Boolean(v && String(v).trim() !== '');

/** Menentukan wilayah akun, sekali per permintaan. */
const wilayahKecamatan = async (req, res, next) => {
  try {
    const kecamatanId = req.user.kecamatan_id;
    if (!kecamatanId) {
      return res.status(403).json({ success: false, message: 'Akun ini tidak terhubung ke kecamatan mana pun' });
    }
    const kecamatan = await prisma.kecamatans.findUnique({
      where: { id: BigInt(kecamatanId) },
      select: {
        id: true,
        nama: true,
        desas: { select: { id: true, nama: true, status_pemerintahan: true }, orderBy: { nama: 'asc' } },
      },
    });
    if (!kecamatan) {
      return res.status(404).json({ success: false, message: 'Kecamatan tidak ditemukan' });
    }
    req.wilayah = kecamatan;
    return next();
  } catch (error) {
    logger.error('Gagal menentukan wilayah aparatur kecamatan:', error);
    return next(error);
  }
};

router.use(auth, checkRole('kecamatan'), wilayahKecamatan);

// GET /api/kecamatan/aparatur-desa
// Seluruh aparatur se-kecamatan sekali kirim (ratusan baris), supaya statistik,
// penyaringan, dan direktori di layar dihitung dari satu daftar yang sama.
router.get('/', async (req, res, next) => {
  try {
    const { wilayah } = req;
    const rows = await prisma.aparatur_desa.findMany({
      where: { desas: { kecamatan_id: wilayah.id } },
      select: {
        id: true, desa_id: true, nama_lengkap: true, jabatan: true, nipd: true, niap: true,
        tanggal_lahir: true, jenis_kelamin: true, pendidikan_terakhir: true,
        tanggal_pengangkatan: true, status: true, status_verifikasi: true,
        file_pas_foto: true, file_ktp: true, file_kk: true, file_akta_kelahiran: true,
        file_ijazah_terakhir: true, file_bpjs_kesehatan: true, file_bpjs_ketenagakerjaan: true,
        bpjs_kesehatan_nomor: true, bpjs_ketenagakerjaan_nomor: true,
        produk_hukum_id: true,
      },
    });

    const data = rows.map((r) => {
      const { urutan, nomor } = peringkatJabatan(r.jabatan || '');
      return {
        id: r.id,
        desa_id: String(r.desa_id),
        nama_lengkap: r.nama_lengkap,
        jabatan: r.jabatan,
        jabatan_baku: bakuJabatan(r.jabatan),
        jenis: jenisAparatur(r.jabatan),
        urutan,
        nomor,
        nipd: r.nipd,
        niap: r.niap,
        tanggal_lahir: r.tanggal_lahir,
        jenis_kelamin: r.jenis_kelamin,
        pendidikan_terakhir: r.pendidikan_terakhir,
        tanggal_pengangkatan: r.tanggal_pengangkatan,
        status: r.status,
        status_verifikasi: r.status_verifikasi,
        file_pas_foto: r.file_pas_foto,
        berkas_ada: KOLOM_BERKAS.filter(([k]) => ada(r[k])).length,
        berkas_total: KOLOM_BERKAS.length,
        punya_bpjs_kesehatan: ada(r.bpjs_kesehatan_nomor) || ada(r.file_bpjs_kesehatan),
        punya_bpjs_ketenagakerjaan: ada(r.bpjs_ketenagakerjaan_nomor) || ada(r.file_bpjs_ketenagakerjaan),
        punya_sk: Boolean(r.produk_hukum_id),
      };
    });

    return res.json({
      success: true,
      wilayah: {
        kecamatan: wilayah.nama,
        desa: wilayah.desas.map((d) => ({ id: String(d.id), nama: d.nama, status: d.status_pemerintahan })),
      },
      total: data.length,
      data,
    });
  } catch (error) {
    logger.error('Gagal mengambil aparatur kecamatan:', error);
    return next(error);
  }
});

// GET /api/kecamatan/aparatur-desa/:id — detail satu aparatur di wilayah sendiri.
router.get('/:id', async (req, res, next) => {
  try {
    const r = await prisma.aparatur_desa.findFirst({
      where: { id: String(req.params.id), desas: { kecamatan_id: req.wilayah.id } },
      include: {
        desas: { select: { id: true, nama: true } },
        produk_hukums: { select: { judul: true, nomor: true, tahun: true } },
      },
    });
    if (!r) {
      return res.status(404).json({ success: false, message: 'Aparatur tidak ditemukan di wilayah Anda' });
    }

    return res.json({
      success: true,
      data: {
        id: r.id,
        desa: r.desas ? { id: String(r.desas.id), nama: r.desas.nama } : null,
        nama_lengkap: r.nama_lengkap,
        jabatan: r.jabatan,
        jenis: jenisAparatur(r.jabatan),
        nipd: r.nipd,
        niap: r.niap,
        tempat_lahir: r.tempat_lahir,
        tanggal_lahir: r.tanggal_lahir,
        jenis_kelamin: r.jenis_kelamin,
        pendidikan_terakhir: r.pendidikan_terakhir,
        agama: r.agama,
        pangkat_golongan: r.pangkat_golongan,
        tanggal_pengangkatan: r.tanggal_pengangkatan,
        nomor_sk_pengangkatan: r.nomor_sk_pengangkatan,
        tanggal_pemberhentian: r.tanggal_pemberhentian,
        nomor_sk_pemberhentian: r.nomor_sk_pemberhentian,
        keterangan: r.keterangan,
        status: r.status,
        status_verifikasi: r.status_verifikasi,
        dpmd_verified_at: r.dpmd_verified_at,
        catatan_verifikasi: r.catatan_verifikasi,
        file_pas_foto: r.file_pas_foto,
        produk_hukum: r.produk_hukums || null,
        berkas: KOLOM_BERKAS.map(([k, label]) => ({ label, ada: ada(r[k]) })),
        punya_bpjs_kesehatan: ada(r.bpjs_kesehatan_nomor) || ada(r.file_bpjs_kesehatan),
        punya_bpjs_ketenagakerjaan: ada(r.bpjs_ketenagakerjaan_nomor) || ada(r.file_bpjs_ketenagakerjaan),
      },
    });
  } catch (error) {
    logger.error('Gagal mengambil detail aparatur kecamatan:', error);
    return next(error);
  }
});

module.exports = router;
