const express = require('express');
const router = express.Router();
const {
  getListActivityLogs,
  getDetailActivityLogs,
  getAllActivityLogs,
  getPengurusActivityLogs
} = require('../controllers/kelembagaanActivityLogs.controller');
const { auth } = require('../middlewares/auth');

/**
 * Activity Logs Routes
 * 
 * GET /api/kelembagaan/activity-logs/list - List page logs (lembaga only)
 * GET /api/kelembagaan/activity-logs/detail/:type/:id - Detail page logs (all activities)
 * GET /api/kelembagaan/activity-logs - All logs with filters
 */

// List page logs (untuk RT, RW, Posyandu list page)
router.get('/list', auth, getListActivityLogs);

// Detail page logs (untuk detail page semua kelembagaan)
router.get('/detail/:type/:id', auth, getDetailActivityLogs);

// Log satu pengurus (untuk detail page pengurus)
router.get('/pengurus/:id', auth, getPengurusActivityLogs);

// All logs with filters (admin/monitoring purpose)
router.get('/', auth, getAllActivityLogs);

module.exports = router;
