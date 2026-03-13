/**
 * Bidang Routes
 */

const express = require('express');
const router = express.Router();
const prisma = require('../config/prisma');
const { auth } = require('../middlewares/auth');
const bidangController = require('../controllers/bidang.controller');
const { checkBidangAccess } = require('../middlewares/bidangAccess');

// Get all bidang
router.get('/', auth, async (req, res) => {
  try {
    const bidangs = await prisma.bidangs.findMany({
      orderBy: {
        nama: 'asc'
      }
    });

    // Convert BigInt to Number for JSON serialization
    const serializedBidangs = bidangs.map(b => ({
      id: Number(b.id),
      nama: b.nama,
      created_at: b.created_at,
      updated_at: b.updated_at
    }));

    res.json({
      success: true,
      message: 'Bidangs retrieved successfully',
      data: serializedBidangs
    });
  } catch (error) {
    console.error('Error fetching bidangs:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch bidangs',
      error: error.message
    });
  }
});

// Get bidang by ID
router.get('/:id', auth, async (req, res) => {
  try {
    const { id } = req.params;

    const bidang = await prisma.bidangs.findUnique({
      where: { id: BigInt(id) }
    });

    if (!bidang) {
      return res.status(404).json({
        success: false,
        message: 'Bidang not found'
      });
    }

    res.json({
      success: true,
      message: 'Bidang retrieved successfully',
      data: bidang
    });
  } catch (error) {
    console.error('Error fetching bidang:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch bidang',
      error: error.message
    });
  }
});

/**
 * @route   GET /api/bidang/:bidangId/dashboard
 * @desc    Get dashboard data for specific bidang (stats + activity logs)
 * @access  Private (pegawai/kepala_bidang for their bidang, kepala_dinas/superadmin for all)
 */
router.get(
  '/:bidangId/dashboard',
  auth,
  checkBidangAccess,
  (req, res) => bidangController.getDashboard(req, res)
);

/**
 * @route   GET /api/bidang/:bidangId/activity-logs
 * @desc    Get activity logs for specific bidang with filters
 * @access  Private (pegawai/kepala_bidang for their bidang, kepala_dinas/superadmin for all)
 */
router.get(
  '/:bidangId/activity-logs',
  auth,
  checkBidangAccess,
  (req, res) => bidangController.getActivityLogs(req, res)
);

/**
 * @route   GET /api/bidang/:bidangId/pegawai
 * @desc    Get list of pegawai for specific bidang
 * @access  Private (pegawai/kepala_bidang for their bidang, kepala_dinas/superadmin for all)
 */
router.get(
  '/:bidangId/pegawai',
  auth,
  checkBidangAccess,
  (req, res) => bidangController.getPegawai(req, res)
);


module.exports = router;
