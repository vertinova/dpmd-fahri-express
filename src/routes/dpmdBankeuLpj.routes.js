const express = require('express');
const router = express.Router();
const bankeuLpjController = require('../controllers/bankeuLpj.controller');
const { auth, checkRole } = require('../middlewares/auth');

// All routes require authentication + SPKED/admin role
router.use(auth);
router.use(checkRole('kepala_dinas', 'sarana_prasarana', 'pegawai', 'kepala_bidang', 'ketua_tim', 'superadmin'));

// Get all LPJ submissions grouped by kecamatan
router.get('/', bankeuLpjController.getAllLpj);

// Verify LPJ (approve/reject/revision)
router.put('/:id/verify', bankeuLpjController.verifyLpj);

module.exports = router;
