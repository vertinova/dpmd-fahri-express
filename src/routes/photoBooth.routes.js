const express = require('express');
const router = express.Router();
const photoBoothController = require('../controllers/photoBooth.controller');
const { auth, checkRole } = require('../middlewares/auth');

const staffRoles = ['superadmin', 'kepala_dinas', 'sekretaris_dinas', 'kepala_bidang', 'ketua_tim', 'pegawai', 'bendahara'];

router.use(auth, checkRole(staffRoles));
router.get('/gallery', photoBoothController.getGallery);
router.post('/save', photoBoothController.savePhoto);
router.delete('/:id', photoBoothController.deletePhoto);

module.exports = router;
