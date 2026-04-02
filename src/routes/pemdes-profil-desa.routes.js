const express = require('express');
const router = express.Router();
const controller = require('../controllers/pemdes-profil-desa.controller');
const { auth, checkRole } = require('../middlewares/auth');

router.use(auth);
router.use(checkRole(['pegawai', 'kepala_bidang', 'ketua_tim', 'kepala_dinas', 'superadmin']));

router.get('/', controller.getAllProfilDesa);
router.get('/stats', controller.getStats);

module.exports = router;