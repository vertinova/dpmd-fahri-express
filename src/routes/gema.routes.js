/**
 * Gema — asisten suara Core Dashboard.
 *
 * Nyaris seluruhnya baca: Gema menjawab dari data yang sudah ada. SATU
 * pengecualian yang disengaja adalah menyetel ulang sandi akun pegawai ke sandi
 * default, dan itu pun tidak pernah terjadi dari kalimat yang diucapkan —
 * perintahnya hanya menyiapkan, lalu pengguna menekan tombol dan front-end
 * memanggil /konfirmasi. Izinnya sama persis dengan halaman Manajemen Pengguna
 * (lihat src/config/akunStaf.js), jadi Gema hanya pintu lain menuju kewenangan
 * yang sudah dipegang, bukan kewenangan baru.
 */

const express = require('express');
const router = express.Router();
const controller = require('../controllers/gema.controller');
const { auth, checkRole } = require('../middlewares/auth');
const { PERAN_INTERNAL_DPMD } = require('../config/peranDpmd');

router.use(auth);
router.use(checkRole(PERAN_INTERNAL_DPMD));

router.get('/kemampuan', controller.kemampuan);
router.post('/tanya', controller.tanya);

// Langkah kedua tindakan yang mengubah data; memeriksa izinnya sendiri.
router.post('/konfirmasi', controller.konfirmasi);

module.exports = router;
