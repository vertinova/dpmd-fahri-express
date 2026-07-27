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
 *
 * Endpoint di sini adalah manajemen akun LINTAS instansi, jadi hanya untuk staf
 * internal DPMD. Akun desa/kecamatan/dinas hanya boleh menyentuh akunnya sendiri;
 * Admin Desa mengelola akun desanya lewat /api/desa-admin.
 */

const USER_ADMIN_ROLES = [
  'superadmin',
  'kepala_dinas',
  'sekretaris_dinas',
  'kepala_bidang',
  'ketua_tim',
  'pegawai',
  'bendahara',
];

// Field yang boleh diubah sendiri oleh pemilik akun lewat halaman Profil.
const SELF_EDITABLE_FIELDS = ['name', 'email', 'tempat_lahir', 'tanggal_lahir'];

const isUserAdmin = (req) =>
  USER_ADMIN_ROLES.includes(String(req.user?.role || '').trim().toLowerCase());

const forbidden = (res, message) => res.status(403).json({ success: false, message });

const requireUserAdmin = (req, res, next) => {
  if (isUserAdmin(req)) return next();
  return forbidden(res, 'Akses ditolak - manajemen akun hanya untuk staf DPMD');
};

const requireUserAdminOrSelf = (req, res, next) => {
  if (isUserAdmin(req)) return next();
  if (String(req.user?.id) === String(req.params.id)) return next();
  return forbidden(res, 'Akses ditolak - Anda hanya dapat mengubah akun sendiri');
};

// Cegah non-admin menaikkan hak aksesnya sendiri (role/desa_id/bidang_id/dll).
const restrictSelfUpdateFields = (req, res, next) => {
  if (isUserAdmin(req)) return next();
  const disallowed = Object.keys(req.body || {}).filter(
    (field) => !SELF_EDITABLE_FIELDS.includes(field)
  );
  if (disallowed.length > 0) {
    return forbidden(res, `Field tidak boleh diubah sendiri: ${disallowed.join(', ')}`);
  }
  return next();
};

// Get user statistics
router.get('/stats', auth, requireUserAdmin, userController.getUserStats);

// Get all users (with filtering & pagination)
router.get('/', auth, requireUserAdmin, userController.getAllUsers);

// Change own password (authenticated user) - MUST be before /:id routes
router.put('/change-password', auth, userController.changePassword);

// Superadmin masuk sebagai user lain
router.post('/:id/impersonate', auth, requireUserAdmin, userController.impersonateUser);

// Hak akses fitur akun operasional desa (bantuan dari sisi staf DPMD)
router.get('/:id/desa-permissions', auth, requireUserAdmin, userController.getDesaPermissions);
router.put('/:id/desa-permissions', auth, requireUserAdmin, userController.updateDesaPermissions);

// Get user by ID
router.get('/:id', auth, requireUserAdminOrSelf, userController.getUserById);

// Create new user
router.post('/', auth, requireUserAdmin, userController.createUser);

// Update user
router.put('/:id', auth, requireUserAdminOrSelf, restrictSelfUpdateFields, userController.updateUser);

// Upload avatar
router.post('/:id/avatar', auth, requireUserAdminOrSelf, uploadAvatar.single('avatar'), userController.uploadAvatar);

// Reset user password (admin only)
router.put('/:id/reset-password', auth, requireUserAdmin, userController.resetPassword);

// Delete user
router.delete('/:id', auth, requireUserAdmin, userController.deleteUser);

module.exports = router;
