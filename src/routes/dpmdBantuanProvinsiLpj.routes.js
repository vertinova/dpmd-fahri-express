const express = require('express');
const router = express.Router();
const bantuanProvinsiLpjController = require('../controllers/bantuanProvinsiLpj.controller');
const { auth, checkRole } = require('../middlewares/auth');

router.use(auth);
router.use(checkRole('kepala_dinas', 'sarana_prasarana', 'pegawai', 'kepala_bidang', 'ketua_tim', 'superadmin'));

router.get('/', bantuanProvinsiLpjController.getAllLpj);
router.put('/:id/verify', bantuanProvinsiLpjController.verifyLpj);
router.delete('/:id', bantuanProvinsiLpjController.adminDeleteLpj);

module.exports = router;
