/**
 * Routes Akun Operator untuk akun UTAMA kecamatan.
 * Base path: /api/kecamatan-admin
 *
 * Role `kecamatan` saja, lalu requireKecamatanUtama menolak akun operator —
 * operator tidak boleh membuat operator lain atau mengubah hak aksesnya sendiri.
 * Cakupan data dikunci ke kecamatan_id akun yang login di dalam controller.
 */
const express = require('express');
const router = express.Router();
const controller = require('../controllers/kecamatanAdmin.controller');
const { auth, checkRole } = require('../middlewares/auth');
const { requireKecamatanUtama } = require('../middlewares/kecamatanPermission');

router.use(auth, checkRole('kecamatan'), requireKecamatanUtama);

router.get('/meta', controller.getMeta);
router.get('/users', controller.getUsers);
router.post('/users', controller.createUser);
router.put('/users/:id', controller.updateUser);
router.delete('/users/:id', controller.deleteUser);

module.exports = router;
