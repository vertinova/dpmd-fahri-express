const express = require('express');
const router = express.Router();
const { auth } = require('../middlewares/auth');

// Import new modular controllers
const {
  rwController,
  rtController,
  posyanduController,
  karangTarunaController,
  lpmController,
  pkkController,
  satlinmasController,
  summaryController,
  pengurusController,
  lembagaLainnyaController
} = require('../controllers/kelembagaan/index');
const posyanduComparisonController = require('../controllers/kelembagaan/posyanduComparison.controller');
const rtrwComparisonController = require('../controllers/kelembagaan/rtrwComparison.controller');

// All kelembagaan routes require authentication
router.use(auth);

// Posyandu comparison endpoint
router.get('/posyandu-comparison', posyanduComparisonController.getComparison.bind(posyanduComparisonController));
router.get('/rtrw-comparison', rtrwComparisonController.getComparison.bind(rtrwComparisonController));

// Summary and overview endpoints
router.get('/', summaryController.index.bind(summaryController));
router.get('/summary', summaryController.summary.bind(summaryController));
router.get('/lainnya-dashboard', summaryController.lainnyaDashboard.bind(summaryController));
router.get('/pengurus-dashboard', summaryController.pengurusDashboard.bind(summaryController));
router.get('/statistik-tahunan', summaryController.statistikTahunan.bind(summaryController));
router.get('/kecamatan/:id', summaryController.byKecamatan.bind(summaryController));

// Desa-specific endpoints
router.get('/desa/:id/summary', summaryController.summaryByDesa.bind(summaryController));
router.get('/desa-detail/:id', summaryController.getDesaKelembagaanDetail.bind(summaryController));
router.get('/desa/:id/rw', summaryController.getDesaRW.bind(summaryController));
router.get('/desa/:id/rt', summaryController.getDesaRT.bind(summaryController));
router.get('/desa/:id/posyandu', summaryController.getDesaPosyandu.bind(summaryController));
router.get('/desa/:id/karang-taruna', summaryController.getDesaKarangTaruna.bind(summaryController));
router.get('/desa/:id/lpm', summaryController.getDesaLPM.bind(summaryController));
router.get('/desa/:id/satlinmas', summaryController.getDesaSatlinmas.bind(summaryController));
router.get('/desa/:id/pkk', summaryController.getDesaPKK.bind(summaryController));

// Admin create endpoints - superadmin can create kelembagaan for any desa
router.post('/desa/:desaId/karang-taruna', karangTarunaController.createByAdmin.bind(karangTarunaController));
router.post('/desa/:desaId/lpm', lpmController.createByAdmin.bind(lpmController));
router.post('/desa/:desaId/satlinmas', satlinmasController.createByAdmin.bind(satlinmasController));
router.post('/desa/:desaId/pkk', pkkController.createByAdmin.bind(pkkController));

// List endpoints (with optional desa_id query parameter)
router.get('/rw', rwController.listRW.bind(rwController));
router.get('/rt', rtController.listRT.bind(rtController));
router.get('/posyandu', posyanduController.listPosyandu.bind(posyanduController));
router.get('/karang-taruna', karangTarunaController.list.bind(karangTarunaController));
router.get('/lpm', lpmController.list.bind(lpmController));
router.get('/satlinmas', satlinmasController.list.bind(satlinmasController));
router.get('/pkk', pkkController.list.bind(pkkController));
router.get('/lembaga-lainnya', lembagaLainnyaController.list.bind(lembagaLainnyaController));

// Create endpoints (supports desa_id query parameter for admin)
router.post('/rw', rwController.createRW.bind(rwController));
router.post('/rt', rtController.createRT.bind(rtController));
router.post('/posyandu', posyanduController.createPosyandu.bind(posyanduController));
router.post('/lembaga-lainnya', lembagaLainnyaController.create.bind(lembagaLainnyaController));

// Update endpoints (supports desa_id query parameter for admin)
router.put('/rw/:id', rwController.updateRW.bind(rwController));
router.put('/rt/:id', rtController.updateRT.bind(rtController));
router.put('/posyandu/:id', posyanduController.updatePosyandu.bind(posyanduController));
router.delete('/rw/:id', rwController.deleteRW.bind(rwController));
router.delete('/rt/:id', rtController.deleteRT.bind(rtController));
router.delete('/posyandu/:id', posyanduController.deletePosyandu.bind(posyanduController));
router.delete('/lembaga-lainnya/:id', lembagaLainnyaController.delete.bind(lembagaLainnyaController));

// Toggle endpoints (supports desa_id query parameter for admin)
router.put('/rw/:id/toggle-status', rwController.toggleStatus.bind(rwController));
router.put('/rw/:id/toggle-verification', rwController.toggleVerification.bind(rwController));
router.put('/rt/:id/toggle-status', rtController.toggleStatus.bind(rtController));
router.put('/rt/:id/toggle-verification', rtController.toggleVerification.bind(rtController));
router.put('/posyandu/:id/toggle-status', posyanduController.toggleStatus.bind(posyanduController));
router.put('/posyandu/:id/toggle-verification', posyanduController.toggleVerification.bind(posyanduController));
router.put('/karang-taruna/:id/toggle-status', karangTarunaController.toggleStatus.bind(karangTarunaController));
router.put('/karang-taruna/:id/toggle-verification', karangTarunaController.toggleVerification.bind(karangTarunaController));
router.put('/lpm/:id/toggle-status', lpmController.toggleStatus.bind(lpmController));
router.put('/lpm/:id/toggle-verification', lpmController.toggleVerification.bind(lpmController));
router.put('/satlinmas/:id/toggle-status', satlinmasController.toggleStatus.bind(satlinmasController));
router.put('/satlinmas/:id/toggle-verification', satlinmasController.toggleVerification.bind(satlinmasController));
router.put('/pkk/:id/toggle-status', pkkController.toggleStatus.bind(pkkController));
router.put('/pkk/:id/toggle-verification', pkkController.toggleVerification.bind(pkkController));
router.put('/lembaga-lainnya/:id/toggle-status', lembagaLainnyaController.toggleStatus.bind(lembagaLainnyaController));
router.put('/lembaga-lainnya/:id/toggle-verification', lembagaLainnyaController.toggleVerification.bind(lembagaLainnyaController));

// Detail endpoints
router.get('/rw/:id', rwController.showRW.bind(rwController));
router.get('/rt/:id', rtController.showRT.bind(rtController));
router.get('/posyandu/:id', posyanduController.showPosyandu.bind(posyanduController));
router.get('/karang-taruna/:id', karangTarunaController.show.bind(karangTarunaController));
router.get('/lpm/:id', lpmController.show.bind(lpmController));
router.get('/satlinmas/:id', satlinmasController.show.bind(satlinmasController));
router.get('/pkk/:id', pkkController.show.bind(pkkController));
router.get('/lembaga-lainnya/:id', lembagaLainnyaController.show.bind(lembagaLainnyaController));
router.put('/lembaga-lainnya/:id', lembagaLainnyaController.update.bind(lembagaLainnyaController));

// Pengurus endpoints (polymorphic relation)
router.get('/pengurus/by-kelembagaan', pengurusController.getPengurusByKelembagaan.bind(pengurusController));
router.get('/pengurus/history', pengurusController.getPengurusHistory.bind(pengurusController));
router.get('/pengurus/:id', pengurusController.showPengurus.bind(pengurusController));
router.get('/pengurus', pengurusController.getPengurusByKelembagaan.bind(pengurusController));
router.delete('/pengurus/:id', pengurusController.deletePengurus.bind(pengurusController));

// Admin only: Update pengurus verification status
router.put('/pengurus/:id/verifikasi', pengurusController.updateVerifikasi.bind(pengurusController));

module.exports = router;
