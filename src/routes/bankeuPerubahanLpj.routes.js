const express = require('express');
const router = express.Router();
const controller = require('../controllers/bankeuPerubahanLpj.controller');
const { auth } = require('../middlewares/auth');
const upload = require('../middlewares/upload');

router.use(auth);

// Desa side
router.get('/', controller.getMyLpj);
router.post('/upload', upload.bankeuPerubahanLpj, controller.uploadLpj);
router.delete('/:id', controller.deleteLpj);

module.exports = router;
