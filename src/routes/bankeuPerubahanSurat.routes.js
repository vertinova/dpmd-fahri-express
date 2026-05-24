const express = require('express');
const router = express.Router();
const controller = require('../controllers/bankeuPerubahanSurat.controller');
const { auth } = require('../middlewares/auth');
const upload = require('../middlewares/upload');

router.use(auth);

// Desa side
router.get('/', controller.getMySurat);
router.post('/upload', upload.bankeuPerubahanSurat, controller.uploadSurat);
router.post('/submit', controller.submitSurat);
router.delete('/:jenis', controller.deleteSurat);

module.exports = router;
