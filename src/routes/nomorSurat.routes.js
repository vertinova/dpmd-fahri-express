const express = require('express');
const router = express.Router();
const nomorSuratController = require('../controllers/nomorSurat.controller');
const { auth } = require('../middlewares/auth');

/**
 * @route GET /api/nomor-surat/klasifikasi
 * @desc  Get classification codes (searchable)
 */
router.get('/klasifikasi', auth, nomorSuratController.getKlasifikasi);

/**
 * @route GET /api/nomor-surat/requests
 * @desc  List all nomor surat requests
 */
router.get('/requests', auth, nomorSuratController.getRequests);

/**
 * @route GET /api/nomor-surat/statistik
 * @desc  Statistics for nomor surat
 */
router.get('/statistik', auth, nomorSuratController.getStatistik);

/**
 * @route POST /api/nomor-surat/request
 * @desc  Create a new nomor surat request
 */
router.post('/request', auth, nomorSuratController.createRequest);

/**
 * @route DELETE /api/nomor-surat/:id
 * @desc  Delete a nomor surat request
 */
router.delete('/:id', auth, nomorSuratController.deleteRequest);

module.exports = router;
