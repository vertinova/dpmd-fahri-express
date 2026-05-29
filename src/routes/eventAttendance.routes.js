const express = require('express');
const controller = require('../controllers/eventAttendance.controller');
const { auth, checkRole } = require('../middlewares/auth');

const router = express.Router();

const adminRoles = ['superadmin', 'kepala_dinas', 'sekretaris_dinas', 'kepala_bidang', 'ketua_tim', 'pegawai', 'bendahara'];

router.get('/public/config', controller.getPublicConfig);
router.get('/public/resolve/:payload', controller.resolveScan);
router.post('/public/register', controller.registerAttendance);

router.get('/admin/attendances', auth, checkRole(adminRoles), controller.getAttendances);

module.exports = router;
