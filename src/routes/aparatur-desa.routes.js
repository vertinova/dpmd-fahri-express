const express = require('express');
const router = express.Router();
const aparaturDesaController = require('../controllers/aparatur-desa.controller');
const { auth } = require('../middlewares/auth');
const { uploadAparaturDesa } = require('../middlewares/upload');

// All routes require authentication
router.use(auth);

// GET /api/desa/aparatur-desa - Get all aparatur desa for logged in user's desa
router.get('/', aparaturDesaController.getAllAparaturDesa);

// POST /api/desa/aparatur-desa/import-external - Import from Dapur Desa external API
router.post('/import-external', aparaturDesaController.importFromExternal);

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
