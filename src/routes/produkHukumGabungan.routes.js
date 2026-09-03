/**
 * Ringkasan produk hukum lintas sumber (desa + bidang + referensi).
 * Hanya baca; menulis dilakukan lewat rute sumbernya masing-masing.
 */

const express = require('express');
const router = express.Router();
const controller = require('../controllers/produkHukumGabungan.controller');
const { auth, checkRole } = require('../middlewares/auth');
const { PERAN_INTERNAL_DPMD } = require('../config/peranDpmd');

router.use(auth);
router.use(checkRole(PERAN_INTERNAL_DPMD));

router.get('/stats', controller.stats);
router.get('/referensi', controller.referensi);

module.exports = router;
