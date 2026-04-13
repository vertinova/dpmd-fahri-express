const express = require('express');
const router = express.Router();
const bankSuratController = require('../controllers/bankSurat.controller');
const { auth, checkRole } = require('../middlewares/auth');

// All routes require auth + DPMD staff roles
const DPMD_ROLES = ['superadmin', 'kepala_dinas', 'sekretaris_dinas', 'kepala_bidang', 'ketua_tim', 'pegawai'];

router.use(auth);
router.use(checkRole(DPMD_ROLES));

/**
 * @route GET /api/bank-surat
 * @desc Get all archived surat with search & pagination
 */
router.get('/', bankSuratController.getAll);

/**
 * @route GET /api/bank-surat/export
 * @desc Export surat data for Excel
 */
router.get('/export', bankSuratController.exportData);

/**
 * @route GET /api/bank-surat/statistik
 * @desc Get surat statistics
 */
router.get('/statistik', bankSuratController.getStatistik);

module.exports = router;
