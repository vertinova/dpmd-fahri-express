const express = require('express');
const router = express.Router();
const locationController = require('../controllers/location.controller');
const { auth, checkRole } = require('../middlewares/auth');
const { PERAN_INTERNAL_DPMD } = require('../config/peranDpmd');

// Define roles yang bisa akses location data (hampir semua role authenticated):
// seluruh pegawai DPMD, akun wilayah/dinas, dan pseudo-role bidang.
const locationRoles = [
	...PERAN_INTERNAL_DPMD,
	'desa', 'kecamatan', 'dinas',
	'sarana_prasarana', 'kekayaan_keuangan', 'pemberdayaan_masyarakat', 'pemerintahan_desa',
];

// Get all kecamatans
router.get('/kecamatans', auth, checkRole(...locationRoles), locationController.getKecamatans);

// Get all desas
router.get('/desas', auth, checkRole(...locationRoles), locationController.getDesas);

// Get single desa by ID
router.get('/desas/:id', auth, checkRole(...locationRoles), locationController.getDesaById);

// Get desas by kecamatan
router.get('/desas/kecamatan/:kecamatanId', auth, checkRole(...locationRoles), locationController.getDesasByKecamatan);

module.exports = router;
