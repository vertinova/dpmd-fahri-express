/**
 * Ikhtisar Bidang SPKED — bahan grafik halaman depan bidang.
 * Base path: /api/spked/ikhtisar
 *
 * Hanya baca, dan hanya untuk staf internal DPMD.
 */

const express = require('express');
const router = express.Router();
const controller = require('../controllers/spkedIkhtisar.controller');
const { auth, checkRole } = require('../middlewares/auth');
const { PERAN_INTERNAL_DPMD } = require('../config/peranDpmd');

router.get('/', auth, checkRole(PERAN_INTERNAL_DPMD), controller.ikhtisar);

module.exports = router;
