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

module.exports = router;
