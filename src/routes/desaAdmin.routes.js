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

router.use(auth, checkRole('admin_desa'));

router.get('/permissions', desaAdminController.getPermissionCatalog);
router.get('/info', desaAdminController.getDesaInfo);

router.get('/users', desaAdminController.getUsers);
router.post('/users', desaAdminController.createUser);
router.get('/users/:id', desaAdminController.getUserById);
router.put('/users/:id', desaAdminController.updateUser);
router.put('/users/:id/permissions', desaAdminController.updatePermissions);
router.delete('/users/:id', desaAdminController.deleteUser);

module.exports = router;
