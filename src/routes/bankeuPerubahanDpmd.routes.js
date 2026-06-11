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

// Batalkan persetujuan DPMD (salah pencet) -> kembali ke "Menunggu DPMD"
router.patch('/proposals/:id/cancel-approval', controller.cancelApproval);

// Riwayat versi dokumen & ronde revisi/anotasi
router.get('/proposals/:id/versions', controller.getProposalVersions);
router.get('/proposals/:id/revisions', controller.getProposalRevisions);

// Activity log history
router.get('/proposals/:proposalId/history', controller.getProposalVerificationHistory);

// Statistik
router.get('/statistics', controller.getStatistics);

// Tracking lintas-tahap (semua proposal, utk tab Tracking & Partisipasi SPKED)
router.get('/tracking', controller.getTracking);

module.exports = router;
