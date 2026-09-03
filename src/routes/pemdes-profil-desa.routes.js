const express = require('express');
const router = express.Router();
const controller = require('../controllers/pemdes-profil-desa.controller');
const { auth, checkRole } = require('../middlewares/auth');
const { PERAN_INTERNAL_DPMD } = require('../config/peranDpmd');

router.use(auth);
router.use(checkRole(PERAN_INTERNAL_DPMD));

router.get('/', controller.getAllProfilDesa);
router.get('/stats', controller.getStats);
router.get('/:desaId', controller.getProfilDesaDetail);

module.exports = router;