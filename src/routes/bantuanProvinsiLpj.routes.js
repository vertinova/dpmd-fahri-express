const express = require('express');
const router = express.Router();
const bantuanProvinsiLpjController = require('../controllers/bantuanProvinsiLpj.controller');
const { auth } = require('../middlewares/auth');
const upload = require('../middlewares/upload');

router.use(auth);

router.get('/', bantuanProvinsiLpjController.getMyLpj);
router.post('/upload', upload.bantuanProvinsiLpj, bantuanProvinsiLpjController.uploadLpj);
router.delete('/:id', bantuanProvinsiLpjController.deleteLpj);

module.exports = router;
