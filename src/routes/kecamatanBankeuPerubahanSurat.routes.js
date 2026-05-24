const express = require('express');
const router = express.Router();
const controller = require('../controllers/bankeuPerubahanSurat.controller');
const { auth } = require('../middlewares/auth');

router.use(auth);

// Kecamatan review surat
router.get('/', controller.listForKecamatan);
router.patch('/:id/review', controller.reviewSurat);

module.exports = router;
