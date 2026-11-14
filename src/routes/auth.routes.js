const express = require('express');
const router = express.Router();
const { login, verifyToken, getProfile, forceChangePassword, saveDesaProfile, renewToken, pasang2fa, aktifkan2fa, verifikasi2fa } = require('../controllers/auth.controller');
const { auth } = require('../middlewares/auth');
const loginRateLimiter = require('../middlewares/loginRateLimit');

// Public routes - with rate limiting (max 5 attempts per 5 minutes per IP)
router.post('/login', loginRateLimiter, login);
// Tukar token kedaluwarsa dengan yang baru. Tanpa middleware `auth` — tokennya
// memang sudah lewat masa berlaku; keabsahannya diperiksa di dalam controller.
// Tanpa rate limit login: pemanggilnya wajib sudah memegang token bertanda
// tangan sah, dan ini jalur yang menjaga user tidak keluar sendiri.
router.post('/renew', renewToken);

// Verifikasi 2 langkah pegawai DPMD. Tanpa loginRateLimiter: dibatasi 5 percobaan
// per tiket; tiket butuh sandi benar yang sudah dibatasi per IP.
router.post('/2fa/pasang', pasang2fa);
router.post('/2fa/aktifkan', aktifkan2fa);
router.post('/2fa/verifikasi', verifikasi2fa);

// Protected routes
router.get('/verify', auth, verifyToken);
router.get('/profile', auth, getProfile); // Get current user profile with relations
// Ganti password default (popup wajib ganti saat pertama login)
router.post('/change-default-password', auth, forceChangePassword);
// Identitas akun desa: nama asli, jabatan, nomor HP (popup wajib isi + ubah manual)
router.put('/desa-profile', auth, saveDesaProfile);

module.exports = router;
