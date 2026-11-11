const express = require('express');
const router = express.Router();
const bankeuLpjController = require('../controllers/bankeuLpj.controller');
const { auth } = require('../middlewares/auth');
const { requireDesaPermission } = require('../middlewares/desaPermission');
const upload = require('../middlewares/upload');

// All routes require authentication
router.use(auth);

// Akun desa hanya boleh masuk bila diberi hak akses "bankeu" oleh Admin Desa.
router.use(requireDesaPermission('bankeu'));

// Get LPJ for logged-in desa
router.get('/', bankeuLpjController.getMyLpj);

// Link video wajib LPJ (TA 2026+)
router.get('/video', bankeuLpjController.getVideo);
router.put('/video', bankeuLpjController.simpanVideo);

// Upload or replace LPJ file
router.post('/upload', upload.bankeuLpj, bankeuLpjController.uploadLpj);

// Bukti STS pengembalian dana (opsional)
router.get('/sts', bankeuLpjController.getSts);
router.post('/sts', upload.bankeuSts, bankeuLpjController.uploadSts);
router.delete('/sts/:id', bankeuLpjController.deleteSts);

// Delete LPJ
router.delete('/:id', bankeuLpjController.deleteLpj);

module.exports = router;
