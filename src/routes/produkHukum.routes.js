/**
 * Produk Hukum Routes
 * Handles all routes related to legal documents (Peraturan Desa, Perkades, SK Kades)
 */

const express = require('express');
const router = express.Router();
const produkHukumController = require('../controllers/produkHukum.controller');
const { auth } = require('../middlewares/auth');
const { uploadProdukHukum } = require('../middlewares/upload');
const desaContextMiddleware = require('../middlewares/desaContext.middleware');

/**
 * @route   GET /api/produk-hukum
 * @desc    Get all produk hukum for authenticated desa with pagination
 * @access  Private (Desa/Admin)
 * @query   page - Page number (default: 1)
 * @query   search - Search by judul (optional)
 * @query   all - Get all without pagination (optional)
 * @query   desa_id - For admin users only (required for admin)
 */
router.get('/', auth, desaContextMiddleware, (req, res) => produkHukumController.index(req, res));

/**
 * @route   POST /api/produk-hukum
 * @desc    Create new produk hukum with PDF file upload
 * @access  Private (Desa)
 * @body    judul, nomor, tahun, jenis, singkatan_jenis, tempat_penetapan, tanggal_penetapan
 * @file    file - PDF file (required, max 10MB)
 */
router.post('/', auth, uploadProdukHukum.single('file'), (req, res) => produkHukumController.store(req, res));

/**
 * @route   GET /api/produk-hukum/:id
 * @desc    Get single produk hukum by ID
 * @access  Public
 * @params  id - UUID of produk hukum
 */
router.get('/:id', (req, res) => produkHukumController.show(req, res));

/**
 * @route   PUT /api/produk-hukum/:id
 * @desc    Update existing produk hukum (optional file replacement)
 * @access  Private (Desa)
 * @params  id - UUID of produk hukum
 * @body    judul, nomor, tahun, jenis, singkatan_jenis, tempat_penetapan, tanggal_penetapan
 * @file    file - PDF file (optional, max 10MB)
 */
router.put('/:id', auth, uploadProdukHukum.single('file'), (req, res) => produkHukumController.update(req, res));

/**
 * @route   DELETE /api/produk-hukum/:id
 * @desc    Delete produk hukum and associated file
 * @access  Private (Desa)
 * @params  id - UUID of produk hukum
 */
router.delete('/:id', auth, (req, res) => produkHukumController.destroy(req, res));

/**
 * @route   PUT /api/produk-hukum/:id/status
 * @desc    Update status_peraturan (berlaku/dicabut)
 * @access  Private (Desa)
 * @params  id - UUID of produk hukum
 * @body    status_peraturan - 'berlaku' or 'dicabut'
 */
router.put('/:id/status', auth, (req, res) => produkHukumController.updateStatus(req, res));

/**
 * @route   GET /api/produk-hukum/:id/related
 * @desc    Get related kelembagaan and pengurus for a produk hukum
 * @access  Private
 * @params  id - UUID of produk hukum
 */
router.get('/:id/related', auth, (req, res) => produkHukumController.getRelated(req, res));

/**
 * @route   GET /api/produk-hukum/:id/download
 * @desc    Download PDF file of produk hukum
 * @access  Private (requires authentication)
 * @params  id - UUID of produk hukum
 */
router.get('/:id/download', auth, (req, res) => produkHukumController.download(req, res));

module.exports = router;
