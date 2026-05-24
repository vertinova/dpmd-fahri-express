// Public routes for Bankeu Perubahan transparency (NO AUTH)
const express = require('express');
const router = express.Router();
const controller = require('../controllers/bankeuPerubahanPublic.controller');

router.get('/tracking-summary', controller.getTrackingSummary);
router.get('/available-years', controller.getAvailableYears);

module.exports = router;
