// src/routes/arsipBarang.routes.js
const express = require('express');
const router = express.Router();
const arsipBarangController = require('../controllers/arsipBarang.controller');
const { auth, checkRole } = require('../middlewares/auth');
const { uploadArsipBarang } = require('../middlewares/upload');

// Pseudo-role 'sekretariat' otomatis dipetakan ke bidang_id = 2 oleh checkRole,
// jadi seluruh pegawai Sekretariat masuk tanpa perlu daftar role satu per satu.
// kepala_dinas & sekretaris_dinas ikut karena membawahi Sekretariat.
const BARANG_ROLES = ['superadmin', 'sekretariat', 'kepala_dinas', 'sekretaris_dinas'];

// Rute statis didaftarkan sebelum '/:id' agar tidak tertelan sebagai id.
router.get('/kategori', auth, checkRole(...BARANG_ROLES), arsipBarangController.getKategori);
router.get('/lokasi', auth, checkRole(...BARANG_ROLES), arsipBarangController.getLokasi);
router.get('/stats', auth, checkRole(...BARANG_ROLES), arsipBarangController.getStats);

// Tujuan QR pada label barang: token → id barang (sekaligus mencatat scan).
router.get('/qr/:token', auth, checkRole(...BARANG_ROLES), arsipBarangController.resolveToken);

router.get('/', auth, checkRole(...BARANG_ROLES), arsipBarangController.getAll);
router.post(
  '/',
  auth,
  checkRole(...BARANG_ROLES),
  uploadArsipBarang.single('foto'),
  arsipBarangController.create
);

router.get('/:id', auth, checkRole(...BARANG_ROLES), arsipBarangController.getById);
router.get('/:id/label', auth, checkRole(...BARANG_ROLES), arsipBarangController.getLabel);
router.put(
  '/:id',
  auth,
  checkRole(...BARANG_ROLES),
  uploadArsipBarang.single('foto'),
  arsipBarangController.update
);
router.post('/:id/mutasi', auth, checkRole(...BARANG_ROLES), arsipBarangController.createMutasi);
router.post('/:id/penghapusan', auth, checkRole(...BARANG_ROLES), arsipBarangController.penghapusanAset);
router.delete('/:id', auth, checkRole(...BARANG_ROLES), arsipBarangController.remove);

module.exports = router;
