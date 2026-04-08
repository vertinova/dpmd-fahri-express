// src/routes/dd.routes.js
const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const { auth, checkRole } = require('../middlewares/auth');
const ddController = require('../controllers/dd.controller');

// Configure multer for file upload
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, 'storage/uploads/temp');
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, 'dd-' + uniqueSuffix + path.extname(file.originalname));
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
 * @route   POST /api/dd/upload
 * @desc    Upload and replace dd2025.json file
 * @access  Private - superadmin, sarana_prasarana, kekayaan_keuangan
 */
router.post(
  '/upload',
  auth,
  checkRole('superadmin', 'sarana_prasarana', 'kekayaan_keuangan'),
  upload.single('file'),
  ddController.uploadDdData
);

/**
 * @route   GET /api/dd/data
 * @desc    Get dd2025.json data
 * @access  Private - authenticated users
 */
router.get(
  '/data',
  auth,
  ddController.getDdData
);

/**
 * @route   GET /api/dd/info
 * @desc    Get current DD data information
 * @access  Private - authenticated users
 */
router.get(
  '/info',
  auth,
  ddController.getDdInfo
);

/**
 * @route   GET /api/dd/backups
 * @desc    Get list of backup files
 * @access  Private - superadmin, sarana_prasarana, kekayaan_keuangan
 */
router.get(
  '/backups',
  auth,
  checkRole('superadmin', 'sarana_prasarana', 'kekayaan_keuangan'),
  ddController.getBackupList
);

module.exports = router;
