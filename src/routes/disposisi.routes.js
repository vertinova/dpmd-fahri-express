const express = require('express');
const router = express.Router();
const disposisiController = require('../controllers/disposisi.controller');
const { auth } = require('../middlewares/auth');
const multer = require('multer');
const path = require('path');

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'storage/surat_masuk/');
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, 'surat-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({
  storage: storage,
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/pdf') {
      cb(null, true);
    } else {
      cb(new Error('Only PDF files are allowed!'), false);
    }
  },
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB max
});

/**
 * @route POST /api/disposisi/surat-masuk
 * @desc Input surat masuk by pegawai sekretariat
 * @access Pegawai Sekretariat only (bidang_id = 2)
 */
router.post(
  '/surat-masuk',
  auth,
  upload.single('file_surat'),
  disposisiController.createSuratMasuk
);

/**
 * @route POST /api/disposisi
 * @access Authenticated users (role-based in controller)
 */
router.post(
  '/',
  auth,
  disposisiController.createDisposisi
);

/**
 * @route GET /api/disposisi/masuk
 * @access All authenticated users
 */
router.get(
  '/masuk',
  auth,
  disposisiController.getDisposisiMasuk
);

/**
 * @route GET /api/disposisi/keluar
 * @access All authenticated users
 */
router.get(
  '/keluar',
  auth,
  disposisiController.getDisposisiKeluar
);

/**
 * @route GET /api/disposisi/statistik
 * @access All authenticated users
 */
router.get(
  '/statistik',
  auth,
  disposisiController.getStatistik
);

/**
 * @route GET /api/disposisi/history/:surat_id
 * @access All authenticated users
 */
router.get(
  '/history/:surat_id',
  auth,
  disposisiController.getDisposisiHistory
);

/**
 * @route GET /api/disposisi/available-users
 * @access All authenticated users
 */
router.get(
  '/available-users',
  auth,
  disposisiController.getAvailableUsers
);

/**
 * @route GET /api/disposisi/riwayat-sekretariat
 * @desc Riwayat disposisi yang dikirim oleh user sekretariat
 * @access Authenticated (sekretariat)
 */
router.get(
  '/riwayat-sekretariat',
  auth,
  disposisiController.getRiwayatSekretariat
);

/**
 * @route GET /api/disposisi/:id
 * @access All authenticated users
 */
router.get(
  '/:id',
  auth,
  disposisiController.getDisposisiById
);

/**
 * @route PUT /api/disposisi/:id/baca
 * @access Disposisi recipient only
 */
router.put(
  '/:id/baca',
  auth,
  disposisiController.markAsRead
);

/**
 * @route PUT /api/disposisi/:id/status
 * @access Disposisi recipient only
 */
router.put(
  '/:id/status',
  auth,
  disposisiController.updateStatus
);

/**
 * @route PUT /api/disposisi/:id/tarik
 * @desc Tarik kembali disposisi (recall)
 * @access Pengirim disposisi, status pending
 */
router.put(
  '/:id/tarik',
  auth,
  disposisiController.tarikDisposisi
);

/**
 * @route PUT /api/disposisi/:id/edit
 * @desc Edit disposisi yang sudah ditarik, lalu kirim ulang
 * @access Pengirim disposisi, status ditarik
 */
router.put(
  '/:id/edit',
  auth,
  disposisiController.editDisposisi
);

/**
 * @route DELETE /api/disposisi/:id
 * @desc Hapus disposisi yang sudah ditarik
 * @access Pengirim disposisi, status ditarik
 */
router.delete(
  '/:id',
  auth,
  disposisiController.deleteDisposisi
);

module.exports = router;
