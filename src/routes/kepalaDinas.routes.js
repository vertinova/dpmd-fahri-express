const express = require('express');
const router = express.Router();
const kepalaDinasController = require('../controllers/kepalaDinas.controller');
const { auth } = require('../middlewares/auth');

// Dashboard statistics route - accessible by all authenticated users
router.get('/dashboard',
  auth,
  kepalaDinasController.getDashboardStats.bind(kepalaDinasController)
);

// Analisis trend - deret waktu asli dari tanggal kejadian di database
router.get('/trends',
  auth,
  kepalaDinasController.getTrends.bind(kepalaDinasController)
);

// Daftar BUMDes untuk halaman Statistik BUMDes di Core Dashboard.
// Memakai `auth` saja, sama seperti /dashboard: rute /api/bumdes menolak
// sekretaris_dinas yang justru punya akses Core Dashboard.
router.get('/bumdes',
  auth,
  kepalaDinasController.getBumdesList
);

module.exports = router;
