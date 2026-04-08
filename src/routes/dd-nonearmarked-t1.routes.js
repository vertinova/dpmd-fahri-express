// src/routes/dd-nonearmarked-t1.routes.js
const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const { auth, checkRole } = require('../middlewares/auth');
const ddNonEarmarkedT1Controller = require('../controllers/dd-nonearmarked-t1.controller');

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, 'storage/uploads/temp');
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, 'dd-nonearmarked-t1-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({
  storage: storage,
  limits: {
    fileSize: 10 * 1024 * 1024
  },
  fileFilter: function (req, file, cb) {
    const ext = path.extname(file.originalname).toLowerCase();
    if (ext !== '.json') {
      return cb(new Error('Hanya file JSON yang diperbolehkan'));
    }
    cb(null, true);
  }
});

router.post('/upload', auth, checkRole('superadmin', 'sarana_prasarana', 'kekayaan_keuangan', 'kepala_bidang'), upload.single('file'), ddNonEarmarkedT1Controller.uploadDdNonEarmarkedT1Data);
router.get('/data', auth, ddNonEarmarkedT1Controller.getDdNonEarmarkedT1Data);
router.get('/info', auth, ddNonEarmarkedT1Controller.getDdNonEarmarkedT1Info);
router.get('/backups', auth, checkRole('superadmin', 'sarana_prasarana', 'kekayaan_keuangan'), ddNonEarmarkedT1Controller.getDdNonEarmarkedT1BackupList);

module.exports = router;
