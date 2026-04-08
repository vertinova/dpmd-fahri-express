// src/routes/add.routes.js
const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const { auth, checkRole } = require('../middlewares/auth');
const addController = require('../controllers/add.controller');

// Configure multer for file upload
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, 'storage/uploads/temp');
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, 'add-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({
  storage: storage,
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB max file size
  },
  fileFilter: function (req, file, cb) {
    const ext = path.extname(file.originalname).toLowerCase();
    if (ext !== '.json') {
      return cb(new Error('Hanya file JSON yang diperbolehkan'));
    }
    cb(null, true);
  }
});

/**
 * @route   POST /api/add/upload
 * @desc    Upload and replace add2025.json file
 * @access  Private - superadmin, sarana_prasarana, kekayaan_keuangan, kepala_bidang (KKD)
 */
router.post(
  '/upload',
  auth,
  checkRole('superadmin', 'sarana_prasarana', 'kekayaan_keuangan', 'kepala_bidang'),
  upload.single('file'),
  addController.uploadAddData
);

/**
 * @route   GET /api/add/data
 * @desc    Get add2025.json data
 * @access  Private - authenticated users
 */
router.get(
  '/data',
  auth,
  addController.getAddData
);

/**
 * @route   GET /api/add/info
 * @desc    Get current ADD data information
 * @access  Private - authenticated users
 */
router.get(
  '/info',
  auth,
  addController.getAddInfo
);

/**
 * @route   GET /api/add/backups
 * @desc    Get list of backup files
 * @access  Private - superadmin, sarana_prasarana, kepala_bidang (KKD)
 */
router.get(
  '/backups',
  auth,
  checkRole('superadmin', 'sarana_prasarana', 'kekayaan_keuangan'),
  addController.getBackupList
);

module.exports = router;
