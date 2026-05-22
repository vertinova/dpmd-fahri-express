// src/routes/berita.routes.js
const express = require('express');
const router = express.Router();
const beritaController = require('../controllers/berita.controller');
const { auth, checkRole } = require('../middlewares/auth');
const { uploadBerita } = require('../middlewares/upload');

const BERITA_ADMIN_ROLES = ['superadmin', 'kepala_dinas', 'sekretaris_dinas', 'sekretariat'];
const uploadBeritaFields = uploadBerita.fields([
  { name: 'gambar', maxCount: 1 },
  { name: 'dokumen_pdf', maxCount: 1 }
]);

// Public routes (for landing page)
router.get('/public', beritaController.getAllBerita);
router.get('/public/terbaru', beritaController.getBeritaTerbaru);
router.get('/public/:slug', beritaController.getBeritaBySlug);

// Admin routes (protected) - superadmin, kepala dinas, and sekretariat
router.get('/admin', auth, checkRole(...BERITA_ADMIN_ROLES), beritaController.getAllBeritaAdmin);
router.get('/admin/stats', auth, checkRole(...BERITA_ADMIN_ROLES), beritaController.getBeritaStats);
router.post('/admin', auth, checkRole(...BERITA_ADMIN_ROLES), uploadBeritaFields, beritaController.createBerita);
router.put('/admin/:id', auth, checkRole(...BERITA_ADMIN_ROLES), uploadBeritaFields, beritaController.updateBerita);
router.delete('/admin/:id', auth, checkRole(...BERITA_ADMIN_ROLES), beritaController.deleteBerita);

module.exports = router;
