const express = require('express');
const router = express.Router();
const db = require('../config/database');
const publicDashboardController = require('../controllers/publicDashboard.controller');

/**
 * @route   GET /api/public/stats
 * @desc    Get public statistics (Kecamatan, Desa, Kelurahan counts)
 * @access  Public
 */
router.get('/stats', async (req, res) => {
  try {
    const [results] = await db.query(`
      SELECT 
        (SELECT COUNT(*) FROM kecamatans) as kecamatan,
        (SELECT COUNT(*) FROM desas WHERE status_pemerintahan = 'desa') as desa,
        (SELECT COUNT(*) FROM desas WHERE status_pemerintahan = 'kelurahan') as kelurahan
    `);

    res.status(200).json({
      success: true,
      data: results[0] || { kecamatan: 0, desa: 0, kelurahan: 0 }
    });
  } catch (error) {
    console.error('Error fetching public stats:', error);
    res.status(500).json({
      success: false,
      message: 'Gagal mengambil statistik',
      error: error.message
    });
  }
});

/**
 * @route   GET /api/public/hero-gallery
 * @desc    Get active hero gallery images for public display
 * @access  Public
 */
router.get('/hero-gallery', async (req, res) => {
  try {
    const [galleries] = await db.query(
      'SELECT id, title, image_path, `order` as display_order FROM hero_galleries WHERE is_active = 1 ORDER BY `order` ASC'
    );

    res.status(200).json({
      success: true,
      data: galleries
    });
  } catch (error) {
    console.error('Error fetching public hero gallery:', error);
    res.status(500).json({
      success: false,
      message: 'Gagal mengambil galeri hero',
      error: error.message
    });
  }
});

/**
 * @route   GET /api/public/landing-stats
 * @desc    Beberapa angka agregat aman untuk landing page publik (tanpa API key)
 * @access  Public
 */
router.get('/landing-stats', async (req, res) => {
  try {
    const [results] = await db.query(`
      SELECT
        (SELECT COUNT(*) FROM desas WHERE status_pemerintahan = 'desa') AS total_desa,
        (SELECT COUNT(*) FROM bumdes WHERE status = 'aktif') AS bumdes_aktif,
        (
          (SELECT COUNT(*) FROM rws) +
          (SELECT COUNT(*) FROM rts) +
          (SELECT COUNT(*) FROM lpms) +
          (SELECT COUNT(*) FROM pkks) +
          (SELECT COUNT(*) FROM posyandus) +
          (SELECT COUNT(*) FROM karang_tarunas) +
          (SELECT COUNT(*) FROM satlinmas) +
          (SELECT COUNT(*) FROM lembaga_lainnyas)
        ) AS total_kelembagaan
    `);

    const row = results[0] || {};
    res.status(200).json({
      success: true,
      data: {
        total_desa: Number(row.total_desa) || 0,
        bumdes_aktif: Number(row.bumdes_aktif) || 0,
        total_kelembagaan: Number(row.total_kelembagaan) || 0
      }
    });
  } catch (error) {
    console.error('Error fetching landing stats:', error);
    res.status(500).json({
      success: false,
      message: 'Gagal mengambil statistik landing',
      error: error.message
    });
  }
});

/**
 * @route   GET /api/public/core-dashboard
 * @route   GET /api/public/dashboard
 * @desc    Get tidy public Core Dashboard aggregate data
 * @access  Protected by CORE_DASHBOARD_API_KEY header
 */
router.get(['/core-dashboard', '/dashboard'], publicDashboardController.getCoreDashboard);

module.exports = router;
