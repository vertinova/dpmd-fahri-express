const express = require('express');
const router = express.Router();
const deviceCheckerController = require('../controllers/deviceChecker.controller');
const { auth } = require('../middlewares/auth');

// POST /api/devices — menerima data device dari aplikasi Laptop-checker (tanpa auth)
router.post('/', deviceCheckerController.createDevice.bind(deviceCheckerController));

// GET /api/devices — daftar semua device (memerlukan auth)
router.get('/', auth, deviceCheckerController.getAllDevices.bind(deviceCheckerController));

// GET /api/devices/stats — statistik per department (memerlukan auth)
router.get('/stats', auth, deviceCheckerController.getDeviceStats.bind(deviceCheckerController));

// GET /api/devices/:deviceId — detail satu device (memerlukan auth)
router.get('/:deviceId', auth, deviceCheckerController.getDeviceById.bind(deviceCheckerController));

module.exports = router;
