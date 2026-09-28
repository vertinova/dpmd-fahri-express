const express = require('express');
const router = express.Router();
const prisma = require('../config/prisma');
const logger = require('../utils/logger');
const { auth, checkRole } = require('../middlewares/auth');
const kepalaDinasController = require('../controllers/kepalaDinas.controller');

/**
 * BUMDes di wilayah akun kecamatan — HANYA MEMBACA.
 *
 * Sengaja hanya ada GET di sini. Akun kecamatan tidak masuk ke /api/bumdes
 * (bumdesRoles tidak memuatnya), jadi tidak ada satu pun jalur ubah/hapus yang
 * terbuka untuknya.
 *
 * Daftarnya memakai getBumdesList yang sama dengan Core Dashboard supaya angka
 * dan bentuk datanya tidak bisa menyimpang; yang berbeda hanya lingkupnya.
 */
const batasiKeKecamatan = async (req, res, next) => {
  try {
    const kecamatanId = req.user.kecamatan_id;
    if (!kecamatanId) {
      return res.status(403).json({ success: false, message: 'Akun ini tidak terhubung ke kecamatan mana pun' });
    }

    const kecamatan = await prisma.kecamatans.findUnique({
      where: { id: BigInt(kecamatanId) },
      select: { nama: true, desas: { select: { id: true } } },
    });
    if (!kecamatan) {
      return res.status(404).json({ success: false, message: 'Kecamatan tidak ditemukan' });
    }

    // Utamanya lewat desa_id. Baris lama hasil impor ada yang desa_id-nya
    // kosong dan hanya membawa nama kecamatan — itu ikut lewat cabang kedua,
    // tapi hanya bila desa_id benar-benar kosong, supaya BUMDes desa lain yang
    // kebetulan salah tulis nama kecamatannya tidak ikut terbaca.
    req.lingkupBumdes = {
      OR: [
        { desa_id: { in: kecamatan.desas.map((d) => Number(d.id)) } },
        { desa_id: null, kecamatan: kecamatan.nama },
      ],
    };
    req.wilayahBumdes = { kecamatan: kecamatan.nama, jumlah_desa: kecamatan.desas.length };
    return next();
  } catch (error) {
    logger.error('Gagal menentukan lingkup BUMDes kecamatan:', error);
    return next(error);
  }
};

router.get('/', auth, checkRole('kecamatan'), batasiKeKecamatan, kepalaDinasController.getBumdesList);

module.exports = router;
