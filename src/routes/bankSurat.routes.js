
const express = require('express');
const router = express.Router();
const bankSuratController = require('../controllers/bankSurat.controller');
const { auth, checkRole } = require('../middlewares/auth');



/**
 * @route GET /api/bank-surat
 * @desc Get all archived surat with search & pagination
 */
router.get('/', auth, bankSuratController.getAll);

/**
 * @route GET /api/bank-surat/export
 * @desc Export surat data for Excel
 */
router.get('/export', auth, bankSuratController.exportData);

/**
 * @route GET /api/bank-surat/statistik
 * @desc Get surat statistics
 */
router.get('/statistik', auth, bankSuratController.getStatistik);

/**
 * @route DELETE /api/bank-surat/:id
 * @desc Delete surat by ID (only superadmin or staff sekretariat)
 */
router.delete('/:id', auth, bankSuratController.deleteSurat);

module.exports = router;
