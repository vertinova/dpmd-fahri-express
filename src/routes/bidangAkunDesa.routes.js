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
const { canManageDesaAccounts, resolveModul } = require('../config/bidangDesaPermissions');
const { PERAN_INTERNAL_DPMD } = require('../config/peranDpmd');
const logger = require('../utils/logger');

/**
 * Kunci cakupan ke satu modul bila frontend memintanya.
 *
 * Halaman akun operator kini dipanggil dari dua tempat berbeda di SpkedPage —
 * tab Bantuan Keuangan dan tab BUMDes — dan keduanya harus berdiri sendiri:
 * akun yang dibuat dari tab Bankeu tidak boleh ikut membawa hak akses BUMDes.
 * Slugnya dibaca sekali di sini, dari query maupun body, lalu dipakai seluruh
 * controller lewat req.modulAkunDesa. Slug yang tidak dikenali DITOLAK, bukan
 * diabaikan diam-diam menjadi "seluruh wewenang bidang" — salah ketik di
 * frontend tidak boleh berakhir sebagai hak akses yang lebih luas.
 */
const resolveModulRequest = (req, res, next) => {
  const slug = req.query.modul ?? req.body?.modul ?? null;
  if (slug === null || String(slug).trim() === '') {
    req.modulAkunDesa = null;
    return next();
  }

  const modul = resolveModul(slug);
  if (!modul) {
    return res.status(400).json({
      success: false,
      code: 'MODUL_TIDAK_DIKENAL',
      message: `Modul akun operator "${slug}" tidak dikenali.`,
    });
  }

  req.modulAkunDesa = modul.slug;
  return next();
};

const requireBidangScope = (req, res, next) => {
  if (canManageDesaAccounts(req.user, req.modulAkunDesa)) return next();

  logger.warn(
    `❌ ${req.user?.email} (role: ${req.user?.role}, bidang_id: ${req.user?.bidang_id}) mencoba mengelola akun desa${req.modulAkunDesa ? ` modul ${req.modulAkunDesa}` : ''} tanpa wewenang bidang`,
  );
  return res.status(403).json({
    success: false,
    code: 'BIDANG_TANPA_FITUR_DESA',
    message: req.modulAkunDesa
      ? `Bidang Anda tidak memegang fitur "${req.modulAkunDesa}", sehingga tidak dapat membuat akun operator untuk fitur itu.`
      : 'Akun Anda tidak terhubung dengan bidang yang memiliki fitur halaman desa, sehingga tidak dapat membuat akun operator desa.',
  });
};

router.use(auth, checkRole(PERAN_INTERNAL_DPMD), resolveModulRequest, requireBidangScope);

// Daftar desa untuk dropdown TIDAK disediakan di sini — sudah ada
// GET /api/desas?include_kelurahan=1 (location.routes.js) yang dipakai bersama
// seluruh aplikasi. Kelurahan wajib ikut: kelurahan juga memakai halaman desa.
router.get('/meta', bidangAkunDesaController.getMeta);

// Wajib dipanggil frontend saat desa dipilih: menjawab "desa ini sudah punya
// operator untuk fitur bidang saya atau belum" sebelum akun baru dibuat.
router.get('/desa/:desaId/ringkasan', bidangAkunDesaController.getRingkasanDesa);

// Pembuatan massal. Pratinjau WAJIB dipanggil lebih dulu oleh frontend, tapi
// keduanya menghitung daftar sasaran dengan fungsi yang sama — jadi tidak ada
// celah antara "yang ditampilkan" dan "yang dibuat" walau pratinjau dilewati.
router.post('/generate/pratinjau', bidangAkunDesaController.pratinjauGenerate);
router.post('/generate', bidangAkunDesaController.generateAkun);

router.get('/users', bidangAkunDesaController.getUsers);

// Ekspor akun operator fitur ini — sandi hanya untuk akun yang masih memakai
// sandi default (untuk dibagikan ke penanggung jawab di desa).
router.get('/ekspor', bidangAkunDesaController.eksporAkun);
router.post('/users', bidangAkunDesaController.createUser);
router.put('/users/:id', bidangAkunDesaController.updateUser);
router.put('/users/:id/permissions', bidangAkunDesaController.updatePermissions);
router.patch('/users/:id/status', bidangAkunDesaController.setStatus);

module.exports = router;
