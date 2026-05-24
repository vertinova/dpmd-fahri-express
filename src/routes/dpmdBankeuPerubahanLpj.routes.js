const express = require('express');
const router = express.Router();
const controller = require('../controllers/bankeuPerubahanLpj.controller');
const { auth } = require('../middlewares/auth');

router.use(auth);

// DPMD monitoring
router.get('/', controller.listForDpmd);
router.patch('/:id/verify', controller.verifyLpj);
router.get('/statistics', controller.getStatistics);

module.exports = router;
