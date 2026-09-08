/**
 * Routes pembuatan akun operasional desa oleh staf bidang DPMD.
 * Base path: /api/bidang/akun-desa
 *
 * Dua lapis penjaga, dan keduanya perlu:
 *
 *   1. `checkRole` memastikan yang masuk memang staf internal DPMD.
 *   2. `requireBidangScope` memastikan akun itu punya wewenang fitur desa.
 *      Peran yang benar tapi tanpa bidang_id (atau bidang tanpa fitur desa,
 *      seperti Sekretariat) tetap ditolak — tanpa lapis ini, `pegawai` mana pun
 *      bisa membuat akun desa dengan katalog kosong, dan yang lebih buruk,
 *      controller akan menghitung wewenangnya sebagai "tidak ada" sambil tetap
 *      menulis ke tabel users.
 */

const express = require('express');
const router = express.Router();
const bidangAkunDesaController = require('../controllers/bidangAkunDesa.controller');
const { auth, checkRole } = require('../middlewares/auth');
const { canManageDesaAccounts } = require('../config/bidangDesaPermissions');
const { PERAN_INTERNAL_DPMD } = require('../config/peranDpmd');
const logger = require('../utils/logger');

const requireBidangScope = (req, res, next) => {
  if (canManageDesaAccounts(req.user)) return next();

  logger.warn(
    `❌ ${req.user?.email} (role: ${req.user?.role}, bidang_id: ${req.user?.bidang_id}) mencoba mengelola akun desa tanpa wewenang bidang`,
  );
  return res.status(403).json({
    success: false,
    code: 'BIDANG_TANPA_FITUR_DESA',
    message:
      'Akun Anda tidak terhubung dengan bidang yang memiliki fitur halaman desa, sehingga tidak dapat membuat akun operator desa.',
  });
};

router.use(auth, checkRole(PERAN_INTERNAL_DPMD), requireBidangScope);

// Daftar desa untuk dropdown TIDAK disediakan di sini — sudah ada
// GET /api/desas?include_kelurahan=1 (location.routes.js) yang dipakai bersama
// seluruh aplikasi. Kelurahan wajib ikut: kelurahan juga memakai halaman desa.
router.get('/meta', bidangAkunDesaController.getMeta);

// Wajib dipanggil frontend saat desa dipilih: menjawab "desa ini sudah punya
// operator untuk fitur bidang saya atau belum" sebelum akun baru dibuat.
router.get('/desa/:desaId/ringkasan', bidangAkunDesaController.getRingkasanDesa);

router.get('/users', bidangAkunDesaController.getUsers);
router.post('/users', bidangAkunDesaController.createUser);
router.put('/users/:id', bidangAkunDesaController.updateUser);
router.put('/users/:id/permissions', bidangAkunDesaController.updatePermissions);
router.patch('/users/:id/status', bidangAkunDesaController.setStatus);

module.exports = router;
