const express = require('express');
const router = express.Router();
const bankeuLpjController = require('../controllers/bankeuLpj.controller');
const { auth } = require('../middlewares/auth');
const upload = require('../middlewares/upload');

// All routes require authentication
router.use(auth);

// Get LPJ for logged-in desa
router.get('/', bankeuLpjController.getMyLpj);

// Upload or replace LPJ file
router.post('/upload', upload.bankeuLpj, bankeuLpjController.uploadLpj);

// Delete LPJ
router.delete('/:id', bankeuLpjController.deleteLpj);

module.exports = router;
