const express = require('express');
const router = express.Router();
const controller = require('../controllers/bankeuPerubahanProposal.controller');
const { auth } = require('../middlewares/auth');
const upload = require('../middlewares/upload');

// All routes require authentication (desa role validated in controller)
router.use(auth);

// Master kegiatan (reuse bankeu_master_kegiatan existing - read-only)
router.get('/master-kegiatan', controller.getMasterKegiatan);

// Proposal CRUD
router.get('/proposals', controller.getProposalsByDesa);
router.post('/proposals', upload.bankeuPerubahanProposal, controller.uploadProposal);
router.patch('/proposals/:id', upload.bankeuPerubahanProposal, controller.updateProposal);
router.patch('/proposals/:id/replace-file', upload.bankeuPerubahanProposal, controller.replaceFile);
router.put('/proposals/:id/edit', upload.bankeuPerubahanProposal, controller.editProposal);
router.delete('/proposals/:id', controller.deleteProposal);

// Submission ke kecamatan (skip Dinas - flow perubahan)
router.post('/submit-to-kecamatan', controller.submitToKecamatan);
router.post('/resubmit', controller.resubmitProposal);

module.exports = router;
