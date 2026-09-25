const express = require('express');
const router = express.Router();
const bumdesController = require('../controllers/bumdes.controller');
const { auth, checkRole } = require('../middlewares/auth');
const { requireDesaPermission } = require('../middlewares/desaPermission');
const { uploadBumdes, uploadBumdesLampiran, uploadBumdesProduk, uploadProdukHukum } = require('../middlewares/upload');

// Define allowed roles for BUMDes management (SPKED = Bidang 3)
const bumdesRoles = ['desa', 'dinas', 'superadmin', 'sarana_prasarana', 'pegawai', 'kepala_bidang', 'kepala_dinas', 'ketua_tim'];

// Akun desa hanya boleh masuk bila diberi hak akses "bumdes" oleh Admin Desa.
// Role lain diteruskan dan tetap disaring checkRole di masing-masing route.
router.use(auth, requireDesaPermission('bumdes'));

// PUBLIC/SHARED ROUTES (specific routes first before dynamic params)
router.get('/statistics', auth, checkRole(...bumdesRoles), bumdesController.getStatistics);
router.get('/dokumen-badan-hukum', auth, checkRole(...bumdesRoles), bumdesController.getDokumenBadanHukum);
router.get('/laporan-keuangan', auth, checkRole(...bumdesRoles), bumdesController.getLaporanKeuangan);
router.get('/dokumen-pendukung', auth, checkRole(...bumdesRoles), bumdesController.getDokumenPendukung);
router.get('/produk-hukum', auth, checkRole(...bumdesRoles), bumdesController.getProdukHukum);
router.get('/check-desa/:kode_desa', auth, checkRole(...bumdesRoles), bumdesController.checkDesaBumdes);

// DELETE ROUTES
router.delete('/delete-file', auth, checkRole(...bumdesRoles), bumdesController.deleteFile);

// DESA-SPECIFIC ROUTES
router.get('/produk-hukum-options', auth, checkRole('desa'), bumdesController.getProdukHukumForBumdes);

/**
 * Buat Perdes/SK BUM Desa langsung dari formulir BUM Desa.
 *
 * Penjaganya sengaja hak akses "bumdes" (dari router.use di atas), BUKAN
 * "produk-hukum". Itu seluruh alasan endpoint ini ada: operator BUM Desa sering
 * tidak diberi akses modul Produk Hukum oleh Admin Desa, sehingga sebelumnya ia
 * terhenti di dropdown yang kosong dan harus menitip ke petugas lain hanya untuk
 * mengunggah satu berkas. Dokumennya tetap menjadi produk hukum desa yang penuh
 * — muncul di modul Produk Hukum seperti yang diunggah lewat pintu sana.
 *
 * Berkasnya memakai uploadProdukHukum supaya mendarat di storage/produk_hukum,
 * folder yang dibaca modul Produk Hukum saat mengunduh.
 */
router.post(
  '/produk-hukum',
  auth,
  checkRole('desa'),
  uploadProdukHukum.single('file'),
  bumdesController.storeProdukHukumDesa
);

// Lampiran daftar JSON (bukti PADes, MoU kemitraan, laporan
// pertanggungjawaban). Pemeriksaan hak kelola ada di controller.
router.post('/lampiran', auth, checkRole(...bumdesRoles), uploadBumdesLampiran.single('file'), bumdesController.uploadLampiran);

// KATALOG PRODUK — etalase seluruh BUM Desa (tanpa transaksi) + kelola produk
// milik BUM Desa sendiri. Harus di atas '/:id' supaya '/produk' tidak dibaca
// sebagai id BUMDes.
router.get('/katalog-produk', auth, checkRole(...bumdesRoles), bumdesController.getKatalogProduk);
router.get('/produk', auth, checkRole(...bumdesRoles), bumdesController.getProdukBumdes);
router.post('/produk', auth, checkRole(...bumdesRoles), uploadBumdesProduk.single('foto'), bumdesController.storeProdukBumdes);
router.put('/produk/:produkId', auth, checkRole(...bumdesRoles), uploadBumdesProduk.single('foto'), bumdesController.updateProdukBumdes);
router.delete('/produk/:produkId', auth, checkRole(...bumdesRoles), bumdesController.deleteProdukBumdes);

// ADMIN ROUTES
router.get('/all', auth, checkRole('dinas', 'superadmin', 'sarana_prasarana', 'pegawai', 'kepala_bidang', 'kepala_dinas', 'ketua_tim'), bumdesController.getAllBumdes);

// DESA/ADMIN HYBRID ROUTES
// Check if user is desa (use getDesaBumdes) or admin (use getAllBumdes)
router.get('/', auth, checkRole(...bumdesRoles), (req, res, next) => {
  // If user is desa, get their bumdes only
  if (req.user.role === 'desa') {
    return bumdesController.getDesaBumdes(req, res, next);
  }
  // If admin/dinas/superadmin, get all bumdes
  return bumdesController.getAllBumdes(req, res, next);
});

router.post('/', auth, checkRole(...bumdesRoles), bumdesController.storeDesaBumdes);
router.post(
  '/upload-file',
  auth,
  checkRole(...bumdesRoles),
  uploadBumdes.single('file'),
  bumdesController.uploadDesaBumdesFile
);
router.get('/:id', auth, checkRole(...bumdesRoles), bumdesController.getBumdesById);
router.put('/:id', auth, checkRole(...bumdesRoles), bumdesController.updateDesaBumdes);
router.delete('/:id', auth, checkRole(...bumdesRoles), bumdesController.deleteDesaBumdes);

module.exports = router;
