const express = require('express');
const router = express.Router();
const absensiController = require('../controllers/absensi.controller');
const { auth, checkAbsensiAdmin } = require('../middlewares/auth');

/**
 * Absensi Pegawai Routes
 * Base path: /api/absensi
 */

// Pegawai routes (self-service)
router.get('/check-eligible', auth, absensiController.checkEligible);
router.get('/today', auth, absensiController.getToday);
router.get('/history', auth, absensiController.getHistory);
router.post('/clock-in', auth, absensiController.clockIn);
router.post('/clock-out', auth, absensiController.clockOut);
router.post('/izin', auth, absensiController.submitIzin);
router.post('/register-device', auth, absensiController.registerDevice);
router.delete('/remove-device', auth, absensiController.removeDevice);
router.get('/success-messages', auth, absensiController.getSuccessMessages);

// Admin routes (superadmin + bidang Sekretariat)
router.get('/admin/dashboard-hari-ini', auth, checkAbsensiAdmin, absensiController.getDashboardHariIni);
router.get('/admin/rekap-pegawai', auth, checkAbsensiAdmin, absensiController.getRekapPegawai);
router.get('/admin/history/:userId', auth, checkAbsensiAdmin, absensiController.getHistoryPerUser);
router.get('/admin/rekap', auth, checkAbsensiAdmin, absensiController.getRekapAdmin);
router.get('/admin/pegawai-absensi', auth, checkAbsensiAdmin, absensiController.getPegawaiAbsensi);
router.get('/admin/settings', auth, checkAbsensiAdmin, absensiController.getSettings);
router.put('/admin/settings', auth, checkAbsensiAdmin, absensiController.updateSettings);
router.put('/admin/set-device/:userId', auth, checkAbsensiAdmin, absensiController.adminSetDevice);
router.put('/admin/:id', auth, checkAbsensiAdmin, absensiController.adminUpdateAbsensi);
router.delete('/admin/:id', auth, checkAbsensiAdmin, absensiController.adminDeleteAbsensi);
router.get('/admin/success-messages', auth, checkAbsensiAdmin, absensiController.getAdminSuccessMessages);
router.put('/admin/success-messages/:type', auth, checkAbsensiAdmin, absensiController.updateSuccessMessage);

module.exports = router;
