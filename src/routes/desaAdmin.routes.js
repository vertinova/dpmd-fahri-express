/**
 * Routes Manajemen Akun untuk Admin Desa.
 * Base path: /api/desa-admin
 *
 * Hanya role `admin_desa`. Cakupan data dikunci ke desa_id milik akun yang login
 * di dalam controller.
 */

const express = require('express');
const router = express.Router();
const desaAdminController = require('../controllers/desaAdmin.controller');
const { auth, checkRole } = require('../middlewares/auth');
const prisma = require('../config/prisma');
const { mustCompleteDesaProfile } = require('../config/desaProfile');

router.use(auth, checkRole('admin_desa'));

/**
 * Selama identitas Admin Desa belum lengkap, akun tidak boleh mengubah apa pun.
 * Popup di frontend sudah menghalangi, ini penjaga sisi server supaya tidak bisa
 * dilewati lewat pemanggilan API langsung. GET tetap diizinkan agar halaman
 * tetap bisa dimuat di belakang popup.
 */
const requireCompleteProfile = async (req, res, next) => {
  if (req.method === 'GET') return next();

  try {
    const user = await prisma.users.findUnique({
      where: { id: BigInt(String(req.user.id)) },
      select: { name: true, role: true, jabatan_desa: true, no_hp: true }
    });

    if (user && mustCompleteDesaProfile(user)) {
      return res.status(403).json({
        success: false,
        code: 'PROFILE_INCOMPLETE',
        message: 'Lengkapi identitas Admin Desa (nama, jabatan, nomor HP) sebelum mengelola akun.'
      });
    }
  } catch {
    // Fail-open: gangguan database tidak boleh mengunci pengelolaan akun.
  }

  return next();
};

router.use(requireCompleteProfile);

router.get('/permissions', desaAdminController.getPermissionCatalog);
router.get('/info', desaAdminController.getDesaInfo);

router.get('/users', desaAdminController.getUsers);
router.post('/users', desaAdminController.createUser);
router.get('/users/:id', desaAdminController.getUserById);
router.put('/users/:id', desaAdminController.updateUser);
router.put('/users/:id/permissions', desaAdminController.updatePermissions);
router.delete('/users/:id', desaAdminController.deleteUser);

module.exports = router;
