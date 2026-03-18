const express = require('express');
const router = express.Router();
const controller = require('../controllers/pemdes-aparatur.controller');
const { auth, checkRole } = require('../middlewares/auth');

router.use(auth);
router.use(checkRole(['pegawai', 'kepala_bidang', 'ketua_tim', 'kepala_dinas', 'superadmin']));

// GET /api/pemdes/aparatur-desa - List all aparatur desa from database
router.get('/', controller.getAllAparaturDesa);

// GET /api/pemdes/aparatur-desa/stats - Get aparatur desa statistics
router.get('/stats', controller.getStats);

// GET /api/pemdes/aparatur-desa/:id - Get single aparatur desa detail
router.get('/:id', controller.getAparaturDesaById);

module.exports = router;
