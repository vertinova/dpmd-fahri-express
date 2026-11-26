const express = require('express');
const absensiController = require('../controllers/absensi.controller');
const attendanceAwardService = require('../services/attendanceAward.service');
const { auth, checkAbsensiAdmin, requireSuperadmin } = require('../middlewares/auth');

/**
 * Absensi Routes — satu mesin, dua kelompok.
 *   'pegawai'        -> /api/absensi            (Sekretariat mengelola)
 *   'perangkat_desa' -> /api/absensi-perangkat  (Bidang Pemerintahan Desa mengelola)
 * Kelompok dibaca controller dari req.kelompokAbsensi.
 */
module.exports = (kelompok) => {
const router = express.Router();
const perangkat = kelompok === 'perangkat_desa';

router.use((req, res, next) => {
  req.kelompokAbsensi = kelompok;
  next();
});

// Kelompok perangkat desa: rute swalayan hanya untuk akun perangkat_desa.
const hanyaPerangkat = (req, res, next) => {
  if (req.user?.role !== 'perangkat_desa') {
    return res.status(403).json({ success: false, message: 'Hanya untuk akun perangkat desa' });
  }
  next();
};
const swalayan = perangkat ? [auth, hanyaPerangkat] : [auth];

// Pegawai routes (self-service)
router.get('/check-eligible', ...swalayan, absensiController.checkEligible);
router.get('/today', ...swalayan, absensiController.getToday);
router.get('/history', ...swalayan, absensiController.getHistory);
router.post('/clock-in', ...swalayan, absensiController.clockIn);
router.post('/clock-out', ...swalayan, absensiController.clockOut);
router.post('/izin', ...swalayan, absensiController.submitIzin);
router.post('/register-device', ...swalayan, absensiController.registerDevice);
router.get('/success-messages', ...swalayan, absensiController.getSuccessMessages);
if (!perangkat) {
router.delete('/remove-device', auth, absensiController.removeDevice);
router.get('/leaderboard', auth, absensiController.getLeaderboard);
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
}

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

// Khusus perangkat desa: desa yang belum punya titik kantor & reset akun.
// Didaftarkan sebelum '/admin/:id' agar tidak tertangkap sebagai id absensi.
if (perangkat) {
router.get('/admin/desa-tanpa-koordinat', auth, checkAbsensiAdmin, absensiController.getDesaTanpaKoordinat);
router.post('/admin/reset-akun/:userId', auth, checkAbsensiAdmin, absensiController.resetAkunPerangkat);
}

// Titik lokasi khusus absen reguler — khusus superadmin.
// Didaftarkan sebelum '/admin/:id' agar tidak tertangkap sebagai id absensi.
if (!perangkat) {
router.get('/admin/lokasi-khusus', auth, checkAbsensiAdmin, requireSuperadmin, absensiController.getLokasiKhusus);
router.post('/admin/lokasi-khusus', auth, checkAbsensiAdmin, requireSuperadmin, absensiController.createLokasiKhusus);
router.put('/admin/lokasi-khusus/:id', auth, checkAbsensiAdmin, requireSuperadmin, absensiController.updateLokasiKhusus);
router.delete('/admin/lokasi-khusus/:id', auth, checkAbsensiAdmin, requireSuperadmin, absensiController.deleteLokasiKhusus);
}
router.put('/admin/set-device/:userId', auth, checkAbsensiAdmin, absensiController.adminSetDevice);
router.post('/admin/manual', auth, checkAbsensiAdmin, absensiController.adminCreateAbsensi);
router.put('/admin/:id', auth, checkAbsensiAdmin, requireSuperadmin, absensiController.adminUpdateAbsensi);
router.delete('/admin/:id', auth, checkAbsensiAdmin, requireSuperadmin, absensiController.adminDeleteAbsensi);
router.get('/admin/success-messages', auth, checkAbsensiAdmin, absensiController.getAdminSuccessMessages);
router.put('/admin/success-messages/:type', auth, checkAbsensiAdmin, absensiController.updateSuccessMessage);
router.get('/admin/reminder-templates', auth, checkAbsensiAdmin, absensiController.getReminderTemplates);
router.put('/admin/reminder-templates/:type', auth, checkAbsensiAdmin, absensiController.updateReminderTemplate);
router.post('/admin/test-reminder/:type', auth, checkAbsensiAdmin, absensiController.testReminderNotification);
if (!perangkat) {
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

}

return router;
};
