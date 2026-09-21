/**
 * Kerja Sama Desa — rute sisi DPMD (Bidang SPKED).
 * Base path: /api/dpmd/kerjasama-desa
 *
 * HANYA BACA. Tidak ada POST/PUT/DELETE di sini, dan itu bukan kebetulan yang
 * menunggu dilengkapi: yang disepakati adalah DPMD memantau, bukan memverifikasi.
 * Menambah rute tulis di berkas ini berarti mengubah kesepakatan itu, bukan
 * sekadar menambah fitur.
 */

const express = require('express');
const router = express.Router();
const controller = require('../controllers/kerjasamaDesaMonitoring.controller');
const { auth, checkRole } = require('../middlewares/auth');
const { PERAN_INTERNAL_DPMD } = require('../config/peranDpmd');

router.use(auth, checkRole(PERAN_INTERNAL_DPMD));

// Bahan penyaring: katalog bidang/jenis, daftar kecamatan, tahun yang ada datanya.
router.get('/meta', controller.meta);

// Empat angka kepala + sebaran bidang + peringkat kecamatan.
router.get('/statistik', controller.statistik);

// Isi kartu "Cakupan Perdes Desa" saat diklik.
router.get('/desa-belum-legalitas', controller.desaBelumLegalitas);

// Tabel monitoring transaksi.
router.get('/', controller.daftar);

module.exports = router;
