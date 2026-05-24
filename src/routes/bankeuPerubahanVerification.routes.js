const express = require('express');
const router = express.Router();
const controller = require('../controllers/bankeuPerubahanVerification.controller');
const { controller: beritaAcaraController } = require('../controllers/bankeuPerubahanBeritaAcara.controller');
const { auth } = require('../middlewares/auth');

// All routes require authentication (kecamatan role validated in controller)
router.use(auth);

// List proposals
router.get('/proposals', controller.getProposalsByKecamatan);

// Verifikasi proposal
router.patch('/proposals/:id/verify', controller.verifyProposal);
router.patch('/proposals/:id/cancel-approval', controller.cancelApproval);

// Activity log history
router.get('/proposals/:proposalId/history', controller.getProposalVerificationHistory);

// Statistik
router.get('/statistics', controller.getStatistics);

// Submit ke DPMD per desa (semua proposal approved untuk satu desa)
router.post('/desa/:desaId/submit-to-dpmd', controller.submitToDpmd);
router.post('/desa/:desaId/submit-review', controller.submitReview);

// Generate Berita Acara per proposal (body: proposalId, kegiatanId, optionalItems, tanggal)
router.post('/desa/:desaId/berita-acara', beritaAcaraController.generateBeritaAcara);

// Generate Surat Pengantar Kecamatan per proposal
router.post('/proposals/:proposalId/surat-pengantar', beritaAcaraController.generateSuratPengantar);

module.exports = router;
