const express = require('express');
const router = express.Router();
const { auth, checkRole } = require('../middlewares/auth');
const hariLiburController = require('../controllers/hariLibur.controller');

// READ: semua user terautentikasi (kecamatan butuh untuk menonaktifkan tanggal di date picker)
router.get('/', auth, hariLiburController.list.bind(hariLiburController));

// MUTATIONS: hanya admin (superadmin + bidang pengelola bankeu)
const ADMIN_ROLES = ['superadmin', 'sarana_prasarana', 'kekayaan_keuangan', 'kepala_bidang'];
router.post('/sync', auth, checkRole(...ADMIN_ROLES), hariLiburController.sync.bind(hariLiburController));
router.post('/', auth, checkRole(...ADMIN_ROLES), hariLiburController.create.bind(hariLiburController));
router.put('/:id', auth, checkRole(...ADMIN_ROLES), hariLiburController.update.bind(hariLiburController));
router.delete('/:id', auth, checkRole(...ADMIN_ROLES), hariLiburController.remove.bind(hariLiburController));

module.exports = router;
