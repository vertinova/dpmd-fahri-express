// src/routes/dd-nonearmarked-t2.routes.js
const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const { auth, checkRole } = require('../middlewares/auth');
const ddNonEarmarkedT2Controller = require('../controllers/dd-nonearmarked-t2.controller');

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, 'storage/uploads/temp');
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, 'dd-nonearmarked-t2-' + uniqueSuffix + path.extname(file.originalname));
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

router.post('/upload', auth, checkRole('superadmin', 'sarana_prasarana', 'kekayaan_keuangan', 'kepala_bidang'), upload.single('file'), ddNonEarmarkedT2Controller.uploadDdNonEarmarkedT2Data);
router.get('/data', auth, ddNonEarmarkedT2Controller.getDdNonEarmarkedT2Data);
router.get('/info', auth, ddNonEarmarkedT2Controller.getDdNonEarmarkedT2Info);
router.get('/backups', auth, checkRole('superadmin', 'sarana_prasarana', 'kekayaan_keuangan'), ddNonEarmarkedT2Controller.getDdNonEarmarkedT2BackupList);

module.exports = router;
