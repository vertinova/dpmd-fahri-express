const express = require('express');
const router = express.Router();
const aparaturDesaController = require('../controllers/aparatur-desa.controller');
const { auth } = require('../middlewares/auth');
const { requireDesaPermission } = require('../middlewares/desaPermission');
const { uploadAparaturDesa } = require('../middlewares/upload');

// All routes require authentication
router.use(auth);

// Akun desa hanya boleh masuk bila diberi hak akses "aparatur-desa" oleh Admin Desa.
router.use(requireDesaPermission('aparatur-desa'));

// GET /api/desa/aparatur-desa - Get all aparatur desa for logged in user's desa
router.get('/', aparaturDesaController.getAllAparaturDesa);

// Rekonsiliasi arsip Dapur Desa. HARUS didaftarkan sebelum '/:id' di bawah,
// kalau tidak "dapur-desa" akan ditangkap sebagai id aparatur.
router.get('/dapur-desa', aparaturDesaController.getRekonsiliasiDapurDesa);
router.post('/dapur-desa/tambah-semua-baru', aparaturDesaController.tambahSemuaBaruDapurDesa);
router.post('/dapur-desa/:dapurId/putuskan', aparaturDesaController.putuskanDapurDesa);

// GET /api/desa/aparatur-desa/:id - Get single aparatur desa by ID
router.get('/:id', aparaturDesaController.getAparaturDesaById);

// POST /api/desa/aparatur-desa - Create new aparatur desa
router.post('/', uploadAparaturDesa.fields([
  { name: 'file_bpjs_kesehatan', maxCount: 1 },
  { name: 'file_bpjs_ketenagakerjaan', maxCount: 1 },
  { name: 'file_pas_foto', maxCount: 1 },
  { name: 'file_ktp', maxCount: 1 },
  { name: 'file_kk', maxCount: 1 },
  { name: 'file_akta_kelahiran', maxCount: 1 },
  { name: 'file_ijazah_terakhir', maxCount: 1 }
]), aparaturDesaController.createAparaturDesa);

// POST /api/desa/aparatur-desa/:id - Update aparatur desa (using POST for form-data compatibility)
router.post('/:id', uploadAparaturDesa.fields([
  { name: 'file_bpjs_kesehatan', maxCount: 1 },
  { name: 'file_bpjs_ketenagakerjaan', maxCount: 1 },
  { name: 'file_pas_foto', maxCount: 1 },
  { name: 'file_ktp', maxCount: 1 },
  { name: 'file_kk', maxCount: 1 },
  { name: 'file_akta_kelahiran', maxCount: 1 },
  { name: 'file_ijazah_terakhir', maxCount: 1 }
]), aparaturDesaController.updateAparaturDesa);

// DELETE /api/desa/aparatur-desa/:id - Delete aparatur desa
router.delete('/:id', aparaturDesaController.deleteAparaturDesa);

module.exports = router;
