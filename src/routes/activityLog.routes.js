/**
 * Activity Logs Routes
 * Global activity logs untuk Superadmin
 */

const express = require('express');
const router = express.Router();
const { auth, requireSuperadmin } = require('../middlewares/auth');
const activityLogController = require('../controllers/activityLog.controller');

/**
 * @route   GET /api/activity-logs
 * @desc    Get all activity logs (untuk Superadmin)
 * @access  Private (Superadmin only)
 * @query   limit, module, action, search, bidang_id
 */
router.get(
  '/',
  auth,
  requireSuperadmin,
  (req, res) => activityLogController.getAllActivityLogs(req, res)
);

/**
 * @route   GET /api/activity-logs/stats
 * @desc    Get activity log statistics
 * @access  Private (Superadmin only)
 */
router.get(
  '/stats',
  auth,
  requireSuperadmin,
  (req, res) => activityLogController.getStats(req, res)
);

/**
 * @route   GET /api/activity-logs/module-stats
 * @desc    Get per-module activity breakdown
 * @access  Private (Superadmin only)
 */
router.get(
  '/module-stats',
  auth,
  requireSuperadmin,
  (req, res) => activityLogController.getModuleStats(req, res)
);

module.exports = router;
