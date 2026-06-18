const express = require('express');
const router = express.Router();
const controller = require('../controllers/bankeuPerubahanVerification.controller');
const { controller: beritaAcaraController } = require('../controllers/bankeuPerubahanBeritaAcara.controller');
const { auth } = require('../middlewares/auth');

// All routes require authentication (kecamatan role validated in controller)
router.use(auth);

// List proposals
router.get('/proposals', controller.getProposalsByKecamatan);

// Tracking lintas-tahap (semua proposal di wilayah kecamatan, termasuk draft di desa)
router.get('/tracking', controller.getTracking);

// Verifikasi proposal (body boleh menyertakan annotation_data saat revision/rejected)
router.patch('/proposals/:id/verify', controller.verifyProposal);
router.patch('/proposals/:id/cancel-approval', controller.cancelApproval);

// Anotasi PDF (editor Kecamatan)
router.get('/proposals/:id/annotation', controller.getAnnotation);
router.put('/proposals/:id/annotation', controller.saveAnnotationDraft);

// Riwayat versi dokumen & ronde revisi/anotasi
router.get('/proposals/:id/versions', controller.getVersions);
router.get('/proposals/:id/revisions', controller.getRevisions);

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
