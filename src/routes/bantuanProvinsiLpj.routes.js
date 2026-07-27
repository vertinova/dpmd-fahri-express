const express = require('express');
const router = express.Router();
const bantuanProvinsiLpjController = require('../controllers/bantuanProvinsiLpj.controller');
const { auth } = require('../middlewares/auth');
const { requireDesaPermission } = require('../middlewares/desaPermission');
const upload = require('../middlewares/upload');

router.use(auth);

// Akun desa hanya boleh masuk bila diberi hak akses "bantuan-provinsi-lpj" oleh Admin Desa.
router.use(requireDesaPermission('bantuan-provinsi-lpj'));

router.get('/', bantuanProvinsiLpjController.getMyLpj);
router.post('/upload', upload.bantuanProvinsiLpj, bantuanProvinsiLpjController.uploadLpj);
router.delete('/:id', bantuanProvinsiLpjController.deleteLpj);

module.exports = router;
