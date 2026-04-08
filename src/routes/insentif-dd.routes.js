// src/routes/insentif-dd.routes.js
const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const { auth, checkRole } = require('../middlewares/auth');
const insentifDdController = require('../controllers/insentif-dd.controller');

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, 'storage/uploads/temp');
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, 'insentif-dd-' + uniqueSuffix + path.extname(file.originalname));
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

router.post('/upload', auth, checkRole('superadmin', 'sarana_prasarana', 'kekayaan_keuangan'), upload.single('file'), insentifDdController.uploadInsentifDdData);
router.get('/data', auth, insentifDdController.getInsentifDdData);
router.get('/info', auth, insentifDdController.getInsentifDdInfo);
router.get('/backups', auth, checkRole('superadmin', 'sarana_prasarana', 'kekayaan_keuangan'), insentifDdController.getInsentifDdBackupList);

module.exports = router;
