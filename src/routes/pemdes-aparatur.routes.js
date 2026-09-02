const express = require('express');
const router = express.Router();
const controller = require('../controllers/pemdes-aparatur.controller');
const { auth, checkRole } = require('../middlewares/auth');

router.use(auth);
router.use(checkRole(['pegawai', 'kepala_bidang', 'ketua_tim', 'kepala_dinas', 'superadmin']));

// GET /api/pemdes/aparatur-desa - List all aparatur desa from database
router.get('/', controller.getAllAparaturDesa);

// GET /api/pemdes/aparatur-desa/stats - Get aparatur desa statistics
router.get('/stats', controller.getStats);

// GET /api/pemdes/aparatur-desa/grouped - Kecamatan → Desa, urut jabatan
router.get('/grouped', controller.getGrouped);

// GET /api/pemdes/aparatur-desa/riwayat-terbaru - Aktivitas lintas desa
router.get('/riwayat-terbaru', controller.getRiwayatTerbaru);

// GET /api/pemdes/aparatur-desa/notifikasi - Usia lanjut & menunggu verifikasi
router.get('/notifikasi', controller.getNotifikasi);

// GET /api/pemdes/aparatur-desa/:id - Get single aparatur desa detail
router.get('/:id', controller.getAparaturDesaById);

// Menyunting dan memverifikasi hanya untuk staf Bidang Pemerintahan Desa.
// 'pemerintahan_desa' di checkRole adalah pseudo-role bidang: yang lolos adalah
// akun ber-bidang_id 6, apa pun jabatannya (lihat BIDANG_ROLE_MAP di auth.js).
const hanyaBidangPemdes = checkRole(['pemerintahan_desa', 'superadmin']);

// PUT /api/pemdes/aparatur-desa/:id - Perbaiki isian data aparatur
router.put('/:id', hanyaBidangPemdes, controller.updateAparaturDesa);

// POST /api/pemdes/aparatur-desa/:id/verifikasi - Tandai / batalkan verifikasi
router.post('/:id/verifikasi', hanyaBidangPemdes, controller.verifikasiAparaturDesa);

module.exports = router;
