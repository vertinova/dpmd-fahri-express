const express = require('express');
const router = express.Router();
const userController = require('../controllers/user.controller');
const { auth } = require('../middlewares/auth');
const multer = require('multer');
const path = require('path');

// Configure multer for avatar upload
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, 'storage/avatars/');
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, 'avatar-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const uploadAvatar = multer({
  storage: storage,
  limits: { fileSize: 2 * 1024 * 1024 }, // 2MB
  fileFilter: function (req, file, cb) {
    const allowedTypes = /jpeg|jpg|png|gif|webp/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);
    
    if (mimetype && extname) {
      return cb(null, true);
    } else {
      cb(new Error('Only image files are allowed!'));
    }
  }
});

/**
 * User Management Routes
 * Base path: /api/users
 */

// Get user statistics
router.get('/stats', auth, userController.getUserStats);

// Get all users (with filtering & pagination)
router.get('/', auth, userController.getAllUsers);

// Change own password (authenticated user) - MUST be before /:id routes
router.put('/change-password', auth, userController.changePassword);

// Superadmin masuk sebagai user lain
router.post('/:id/impersonate', auth, userController.impersonateUser);

// Get user by ID
router.get('/:id', auth, userController.getUserById);

// Create new user
router.post('/', auth, userController.createUser);

// Update user
router.put('/:id', auth, userController.updateUser);

// Upload avatar
router.post('/:id/avatar', auth, uploadAvatar.single('avatar'), userController.uploadAvatar);

// Reset user password (admin only)
router.put('/:id/reset-password', auth, userController.resetPassword);

// Delete user
router.delete('/:id', auth, userController.deleteUser);

module.exports = router;
