const express = require('express');
const router = express.Router();
const controller = require('../controllers/bankeuPerubahanLpj.controller');
const { auth } = require('../middlewares/auth');
const { requireDesaPermission } = require('../middlewares/desaPermission');
const upload = require('../middlewares/upload');

router.use(auth);

// Akun desa hanya boleh masuk bila diberi hak akses "bankeu-perubahan" oleh Admin Desa.
router.use(requireDesaPermission('bankeu-perubahan'));

// Desa side
router.get('/', controller.getMyLpj);
router.post('/upload', upload.bankeuPerubahanLpj, controller.uploadLpj);
router.delete('/:id', controller.deleteLpj);

module.exports = router;
