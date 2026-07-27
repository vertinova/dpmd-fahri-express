const express = require('express');
const router = express.Router();
const bumdesController = require('../controllers/bumdes.controller');
const { auth, checkRole } = require('../middlewares/auth');
const { requireDesaPermission } = require('../middlewares/desaPermission');
const { uploadBumdes } = require('../middlewares/upload');

// Define allowed roles for BUMDes management (SPKED = Bidang 3)
const bumdesRoles = ['desa', 'dinas', 'superadmin', 'sarana_prasarana', 'pegawai', 'kepala_bidang', 'kepala_dinas', 'ketua_tim'];

// Akun desa hanya boleh masuk bila diberi hak akses "bumdes" oleh Admin Desa.
// Role lain diteruskan dan tetap disaring checkRole di masing-masing route.
router.use(auth, requireDesaPermission('bumdes'));

// PUBLIC/SHARED ROUTES (specific routes first before dynamic params)
router.get('/statistics', auth, checkRole(...bumdesRoles), bumdesController.getStatistics);
router.get('/dokumen-badan-hukum', auth, checkRole(...bumdesRoles), bumdesController.getDokumenBadanHukum);
router.get('/laporan-keuangan', auth, checkRole(...bumdesRoles), bumdesController.getLaporanKeuangan);
router.get('/produk-hukum', auth, checkRole(...bumdesRoles), bumdesController.getProdukHukum);
router.get('/check-desa/:kode_desa', auth, checkRole(...bumdesRoles), bumdesController.checkDesaBumdes);

// DELETE ROUTES
router.delete('/delete-file', auth, checkRole(...bumdesRoles), bumdesController.deleteFile);

// DESA-SPECIFIC ROUTES
router.get('/produk-hukum-options', auth, checkRole('desa'), bumdesController.getProdukHukumForBumdes);

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
