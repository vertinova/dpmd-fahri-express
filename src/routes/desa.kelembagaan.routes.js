/**
 * Desa Kelembagaan Routes
 * Routes for desa role to manage their own kelembagaan
 * Matches Laravel pattern: /api/desa/rw, /api/desa/rt, etc.
 */

const express = require('express');
const router = express.Router();
const { auth } = require('../middlewares/auth');
const desaContextMiddleware = require('../middlewares/desaContext.middleware');
const { uploadPengurus } = require('../middlewares/upload');

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

// Import dashboard controller
const { getDesaDashboardSummary } = require('../controllers/dashboard/desa.dashboard.controller');

// All routes require authentication
router.use(auth);

// Apply desaContextMiddleware to all routes (for admin access via desa_id query param)
router.use(desaContextMiddleware);

// Dashboard summary endpoint (for Desa Dashboard Page)
router.get('/dashboard/summary', getDesaDashboardSummary);

// Summary endpoint for logged-in desa (for Kelembagaan Page)
router.get('/kelembagaan/summary', summaryController.getDesaSummary.bind(summaryController));

// RW routes
router.get('/rw', rwController.listDesaRW.bind(rwController));
router.post('/rw', rwController.createRW.bind(rwController));
router.get('/rw/:id', rwController.showDesaRW.bind(rwController));
router.put('/rw/:id', rwController.updateRW.bind(rwController));
router.put('/rw/:id/toggle-status', rwController.toggleStatus.bind(rwController));
router.put('/rw/:id/toggle-verification', rwController.toggleVerification.bind(rwController));

// RT routes
router.get('/rt', rtController.listDesaRT.bind(rtController));
router.post('/rt', rtController.createRT.bind(rtController));
router.get('/rt/:id', rtController.showDesaRT.bind(rtController));
router.put('/rt/:id', rtController.updateRT.bind(rtController));
router.put('/rt/:id/toggle-status', rtController.toggleStatus.bind(rtController));
router.put('/rt/:id/toggle-verification', rtController.toggleVerification.bind(rtController));

// Posyandu routes
router.get('/posyandu', posyanduController.listDesaPosyandu.bind(posyanduController));
router.post('/posyandu', posyanduController.createPosyandu.bind(posyanduController));
router.get('/posyandu/:id', posyanduController.showDesaPosyandu.bind(posyanduController));
router.put('/posyandu/:id', posyanduController.updatePosyandu.bind(posyanduController));
router.put('/posyandu/:id/toggle-status', posyanduController.toggleStatus.bind(posyanduController));
router.put('/posyandu/:id/toggle-verification', posyanduController.toggleVerification.bind(posyanduController));

// Karang Taruna routes (singleton - usually only 1 per desa)
router.get('/karang-taruna', karangTarunaController.listDesa.bind(karangTarunaController));
router.post('/karang-taruna', karangTarunaController.create.bind(karangTarunaController));
router.get('/karang-taruna/:id', karangTarunaController.showDesa.bind(karangTarunaController));
router.put('/karang-taruna/:id', karangTarunaController.update.bind(karangTarunaController));
router.put('/karang-taruna/:id/toggle-status', karangTarunaController.toggleStatus.bind(karangTarunaController));

// LPM routes (singleton)
router.get('/lpm', lpmController.listDesa.bind(lpmController));
router.post('/lpm', lpmController.create.bind(lpmController));
router.get('/lpm/:id', lpmController.showDesa.bind(lpmController));
router.put('/lpm/:id', lpmController.update.bind(lpmController));
router.put('/lpm/:id/toggle-status', lpmController.toggleStatus.bind(lpmController));

// Satlinmas routes (singleton)
router.get('/satlinmas', satlinmasController.listDesa.bind(satlinmasController));
router.post('/satlinmas', satlinmasController.create.bind(satlinmasController));
router.get('/satlinmas/:id', satlinmasController.showDesa.bind(satlinmasController));
router.put('/satlinmas/:id', satlinmasController.update.bind(satlinmasController));
router.put('/satlinmas/:id/toggle-status', satlinmasController.toggleStatus.bind(satlinmasController));

// PKK routes (singleton)
router.get('/pkk', pkkController.listDesa.bind(pkkController));
router.post('/pkk', pkkController.create.bind(pkkController));
router.get('/pkk/:id', pkkController.showDesa.bind(pkkController));
router.put('/pkk/:id', pkkController.update.bind(pkkController));
router.put('/pkk/:id/toggle-status', pkkController.toggleStatus.bind(pkkController));

// Lembaga Lainnya routes (multi-instance - desa can create many)
router.get('/lembaga-lainnya', lembagaLainnyaController.listDesa.bind(lembagaLainnyaController));
router.post('/lembaga-lainnya', lembagaLainnyaController.create.bind(lembagaLainnyaController));
router.get('/lembaga-lainnya/:id', lembagaLainnyaController.showDesa.bind(lembagaLainnyaController));
router.put('/lembaga-lainnya/:id', lembagaLainnyaController.update.bind(lembagaLainnyaController));
router.put('/lembaga-lainnya/:id/toggle-status', lembagaLainnyaController.toggleStatus.bind(lembagaLainnyaController));
router.put('/lembaga-lainnya/:id/toggle-verification', lembagaLainnyaController.toggleVerification.bind(lembagaLainnyaController));

// Pengurus routes (polymorphic - can be attached to any kelembagaan)
router.get('/pengurus/by-kelembagaan', pengurusController.getPengurusByKelembagaan.bind(pengurusController));
router.get('/pengurus/history', pengurusController.getPengurusHistory.bind(pengurusController));
router.get('/pengurus', pengurusController.listDesaPengurus.bind(pengurusController));
router.post('/pengurus', uploadPengurus.single('avatar'), pengurusController.createPengurus.bind(pengurusController));
router.get('/pengurus/:id', pengurusController.showDesaPengurus.bind(pengurusController));
router.put('/pengurus/:id', uploadPengurus.single('avatar'), pengurusController.updatePengurus.bind(pengurusController));
router.delete('/pengurus/:id', pengurusController.deletePengurus.bind(pengurusController));
router.put('/pengurus/:id/status', pengurusController.updatePengurusStatus.bind(pengurusController));

module.exports = router;
