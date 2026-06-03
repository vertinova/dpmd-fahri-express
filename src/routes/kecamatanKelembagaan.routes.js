const express = require('express');
const router = express.Router();
const { auth } = require('../middlewares/auth');
const controller = require('../controllers/kecamatanKelembagaan.controller');

router.use(auth);

// GET summary stats (pengurus-based, legacy)
router.get('/summary', controller.getSummary.bind(controller));

// GET per-desa, per-type lembaga counts
router.get('/lembaga-per-desa', controller.getLembagaByDesa.bind(controller));

// Detailed data for a single desa (RW+RT, Posyandu, singletons)
router.get('/desa/:desaId/detail', controller.getDesaDetail.bind(controller));

// GET aggregate lembaga summary by type
router.get('/lembaga-per-desa/summary', controller.getLembagaSummary.bind(controller));

// GET all pengurus grouped by desa (with optional filter ?status_verifikasi=unverified&desa_id=X)
router.get('/pengurus', controller.getPengurusByKecamatan.bind(controller));

// Bulk verification (must be before /:id route)
router.put('/pengurus/bulk-verifikasi', controller.bulkVerifikasiPengurus.bind(controller));

// Verify single pengurus
router.put('/pengurus/:id/verifikasi', controller.verifikasiPengurus.bind(controller));

module.exports = router;
