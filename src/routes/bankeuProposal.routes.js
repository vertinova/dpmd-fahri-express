const express = require('express');
const router = express.Router();
const bankeuProposalController = require('../controllers/bankeuProposal.controller');
const { auth } = require('../middlewares/auth');
const { requireDesaPermission } = require('../middlewares/desaPermission');
const upload = require('../middlewares/upload');

// All routes require authentication (desa role will be validated in controller)
router.use(auth);

// Akun desa hanya boleh masuk bila diberi hak akses "bankeu" oleh Admin Desa.
router.use(requireDesaPermission('bankeu'));

// Get master kegiatan
router.get('/master-kegiatan', bankeuProposalController.getMasterKegiatan);

// Get proposals for logged-in desa
router.get('/proposals', bankeuProposalController.getProposalsByDesa);

// Upload new proposal
router.post('/proposals', upload.bankeuProposal, bankeuProposalController.uploadProposal);

// Update existing proposal (for revision)
router.patch('/proposals/:id', upload.bankeuProposal, bankeuProposalController.updateProposal);

// Replace file in existing proposal (before submission)
router.patch('/proposals/:id/replace-file', upload.bankeuProposal, bankeuProposalController.replaceFile);

// Edit proposal before submission (belum dikirim ke kecamatan/dinas)
router.put('/proposals/:id/edit', upload.bankeuProposal, bankeuProposalController.editProposal);

// Upload surat pengantar or surat permohonan
router.post('/proposals/:id/upload-surat', upload.bankeuProposal, bankeuProposalController.uploadSurat);

// Submit all proposals to dinas terkait - FIRST TIME SUBMISSION (NEW FLOW 2026-01-30)
router.post('/submit-to-dinas-terkait', bankeuProposalController.submitToDinasTerkait);

// Resubmit proposals after revision - UPLOAD ULANG (NEW FLOW 2026-01-30)
router.post('/resubmit', bankeuProposalController.resubmitProposal);

// OLD ROUTES - Deprecated but kept for backward compatibility
router.post('/submit-to-dinas', bankeuProposalController.submitToDinasTerkait); // Fallback
router.post('/submit-to-kecamatan', bankeuProposalController.submitToDinasTerkait); // Redirect to new flow

// Delete proposal
router.delete('/proposals/:id', bankeuProposalController.deleteProposal);

module.exports = router;
