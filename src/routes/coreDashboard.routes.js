const express = require('express');
const router = express.Router();
const c = require('../controllers/coreDashboard.controller');
const { auth, checkRole } = require('../middlewares/auth');
const { PERAN_INTERNAL_DPMD } = require('../config/peranDpmd');

// Ringkasan & rapor wilayah: seluruh staf internal DPMD
router.use(auth, checkRole(PERAN_INTERNAL_DPMD));

router.get('/ringkasan', c.getRingkasan);
router.get('/wilayah', c.getWilayah);
router.get('/rapor/kecamatan/:id', c.getRaporKecamatan);
router.get('/rapor/desa/:id', c.getRaporDesa);

module.exports = router;
