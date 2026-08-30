/**
 * Gema — asisten suara Core Dashboard.
 * Hanya baca: Gema menjawab dari data yang sudah ada, tidak pernah mengubahnya.
 */

const express = require('express');
const router = express.Router();
const controller = require('../controllers/gema.controller');
const { auth, checkRole } = require('../middlewares/auth');

router.use(auth);
router.use(checkRole([
	'pegawai', 'kepala_bidang', 'ketua_tim',
	'sekretaris_dinas', 'kepala_dinas', 'bendahara', 'superadmin',
]));

router.get('/kemampuan', controller.kemampuan);
router.post('/tanya', controller.tanya);

module.exports = router;
