const express = require('express');
const router = express.Router();
const controller = require('../controllers/pemdes-produk-hukum.controller');
const { auth, checkRole } = require('../middlewares/auth');

router.use(auth);
router.use(checkRole(['pegawai', 'kepala_bidang', 'ketua_tim', 'kepala_dinas', 'superadmin']));

// GET /api/pemdes/produk-hukum - List all produk hukum from all desas
router.get('/', controller.getAllProdukHukum);

// GET /api/pemdes/produk-hukum/stats - Get produk hukum statistics
router.get('/stats', controller.getStats);

// GET /api/pemdes/produk-hukum/:id/related - Get related kelembagaan & pengurus
router.get('/:id/related', controller.getRelated);

// GET /api/pemdes/produk-hukum/:id - Get single produk hukum detail
router.get('/:id', controller.getById);

module.exports = router;
