/**
 * Status Routes - WhatsApp-like status/story feature
 */

const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const statusController = require('../controllers/status.controller');
const { auth } = require('../middlewares/auth');

// Ensure upload directory exists
const UPLOAD_DIR = 'storage/uploads/status';
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// Configure multer for status media uploads
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, UPLOAD_DIR);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, 'status-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({
  storage: storage,
  limits: {
    fileSize: 30 * 1024 * 1024 // 30MB max (for 30s video)
  },
  fileFilter: function (req, file, cb) {
    const allowedImage = ['.jpg', '.jpeg', '.png', '.gif', '.webp'];
    const allowedVideo = ['.mp4', '.webm', '.mov'];
    const ext = path.extname(file.originalname).toLowerCase();
    if ([...allowedImage, ...allowedVideo].includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error('Format file tidak didukung. Gunakan gambar (jpg, png, gif, webp) atau video (mp4, webm, mov)'));
    }
  }
});

// All routes require authentication
router.use(auth);

// Get all active statuses
router.get('/', (req, res) => statusController.getStatuses(req, res));

// Create a new status (with optional media)
router.post('/', upload.single('media'), (req, res) => statusController.createStatus(req, res));

// View a status (track view)
router.post('/:id/view', (req, res) => statusController.viewStatus(req, res));

// Get viewers of a status
router.get('/:id/viewers', (req, res) => statusController.getViewers(req, res));

// Delete own status
router.delete('/:id', (req, res) => statusController.deleteStatus(req, res));

// Reply or react to a status (sends DM to owner)
router.post('/:id/reply', (req, res) => statusController.replyToStatus(req, res));

module.exports = router;
