/**
 * Ikhtisar Bidang SPKED — bahan grafik halaman depan bidang.
 * Base path: /api/spked/ikhtisar
 *
 * Hanya baca: staf internal DPMD, ditambah Tenaga Ahli yang memantau pembinaan
 * BUM Desa.
 */

const express = require('express');
const router = express.Router();
const controller = require('../controllers/spkedIkhtisar.controller');
const { auth, checkRole } = require('../middlewares/auth');
const { PERAN_PEMANTAU_SPKED } = require('../config/peranDpmd');

router.get('/', auth, checkRole(PERAN_PEMANTAU_SPKED), controller.ikhtisar);

module.exports = router;
