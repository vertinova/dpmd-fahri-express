const express = require('express');
const router = express.Router();
const { controller } = require('../controllers/bankeuPerubahanBeritaAcara.controller');
const { auth } = require('../middlewares/auth');

router.use(auth);

// Validate tim & quisioner kelengkapan sebelum generate BA
router.get('/validate/:desaId/:proposalId', controller.validate);

module.exports = router;
