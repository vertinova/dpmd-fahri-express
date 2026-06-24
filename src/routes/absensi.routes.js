const express = require('express');
const router = express.Router();
const absensiController = require('../controllers/absensi.controller');
const attendanceAwardService = require('../services/attendanceAward.service');
const { auth, checkAbsensiAdmin, requireSuperadmin } = require('../middlewares/auth');

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
router.get('/weekly-awards/latest', auth, async (req, res) => {
  try {
    const award = await attendanceAwardService.getLatest();
    res.json({ success: true, data: award });
  } catch (error) {
    console.error('[Attendance Award] Failed to get latest award:', error);
    res.status(500).json({
      success: false,
      message: 'Gagal mengambil penghargaan absensi mingguan',
    });
  }
});

// Admin routes: superadmin + bidang Sekretariat
// Edit/delete rekap harian records: superadmin only
router.get('/admin/dashboard-hari-ini', auth, checkAbsensiAdmin, absensiController.getDashboardHariIni);
router.get('/admin/rekap-pegawai', auth, checkAbsensiAdmin, absensiController.getRekapPegawai);
router.get('/admin/history/:userId', auth, checkAbsensiAdmin, absensiController.getHistoryPerUser);
router.get('/admin/rekap', auth, checkAbsensiAdmin, absensiController.getRekapAdmin);
router.get('/admin/pegawai-absensi', auth, checkAbsensiAdmin, absensiController.getPegawaiAbsensi);
router.get('/admin/presensi-kosong', auth, checkAbsensiAdmin, absensiController.getMissingAttendance);
router.get('/admin/settings', auth, checkAbsensiAdmin, absensiController.getSettings);
router.put('/admin/settings', auth, checkAbsensiAdmin, absensiController.updateSettings);
router.put('/admin/set-device/:userId', auth, checkAbsensiAdmin, absensiController.adminSetDevice);
router.post('/admin/manual', auth, checkAbsensiAdmin, absensiController.adminCreateAbsensi);
router.put('/admin/:id', auth, checkAbsensiAdmin, requireSuperadmin, absensiController.adminUpdateAbsensi);
router.delete('/admin/:id', auth, checkAbsensiAdmin, requireSuperadmin, absensiController.adminDeleteAbsensi);
router.get('/admin/success-messages', auth, checkAbsensiAdmin, absensiController.getAdminSuccessMessages);
router.put('/admin/success-messages/:type', auth, checkAbsensiAdmin, absensiController.updateSuccessMessage);
router.get('/admin/reminder-templates', auth, checkAbsensiAdmin, absensiController.getReminderTemplates);
router.put('/admin/reminder-templates/:type', auth, checkAbsensiAdmin, absensiController.updateReminderTemplate);
router.post('/admin/test-reminder/:type', auth, checkAbsensiAdmin, absensiController.testReminderNotification);
router.post('/admin/weekly-awards/announce', auth, checkAbsensiAdmin, async (req, res) => {
  try {
    const result = await attendanceAwardService.announceWeeklyAwards();
    const serializableResult = {
      ...result,
      award: result.award ? { ...result.award, id: Number(result.award.id) } : null,
    };
    res.json({ success: true, data: serializableResult });
  } catch (error) {
    console.error('[Attendance Award] Failed to announce award:', error);
    res.status(500).json({
      success: false,
      message: 'Gagal mengumumkan penghargaan absensi mingguan',
    });
  }
});

module.exports = router;
