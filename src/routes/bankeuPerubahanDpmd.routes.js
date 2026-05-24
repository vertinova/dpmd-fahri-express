const express = require('express');
const router = express.Router();
const controller = require('../controllers/bankeuPerubahanDpmd.controller');
const { auth } = require('../middlewares/auth');

// All routes require authentication
router.use(auth);

// List proposals submitted to DPMD
router.get('/proposals', controller.getProposals);

// Verifikasi final
router.patch('/proposals/:id/verify', controller.verifyProposal);

// Activity log history
router.get('/proposals/:proposalId/history', controller.getProposalVerificationHistory);

// Statistik
router.get('/statistics', controller.getStatistics);

module.exports = router;
