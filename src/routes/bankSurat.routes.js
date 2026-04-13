
const express = require('express');
const router = express.Router();
const bankSuratController = require('../controllers/bankSurat.controller');
const { auth, checkRole } = require('../middlewares/auth');



/**
 * @route DELETE /api/bank-surat/:id
 * @desc Delete surat by ID (only superadmin or pegawai sekretariat)
 */
router.delete('/:id', bankSuratController.deleteSurat);



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
