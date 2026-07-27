const express = require('express');
const router = express.Router();
const { login, verifyToken, getProfile, forceChangePassword, saveDesaProfile } = require('../controllers/auth.controller');
const { auth } = require('../middlewares/auth');
const loginRateLimiter = require('../middlewares/loginRateLimit');

// Public routes - with rate limiting (max 5 attempts per 5 minutes per IP)
router.post('/login', loginRateLimiter, login);

// Protected routes
router.get('/verify', auth, verifyToken);
router.get('/profile', auth, getProfile); // Get current user profile with relations
// Ganti password default (popup wajib ganti saat pertama login)
router.post('/change-default-password', auth, forceChangePassword);
// Identitas akun desa: nama asli, jabatan, nomor HP (popup wajib isi + ubah manual)
router.put('/desa-profile', auth, saveDesaProfile);

module.exports = router;
