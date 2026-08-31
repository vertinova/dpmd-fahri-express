// Bankeu Perubahan — halaman dinas PELIHAT (BPKAD & Inspektorat).
//
// Semua rute di sini READ-ONLY: tidak ada POST/PATCH/PUT/DELETE sama sekali,
// sehingga akun pelihat tidak punya jalan untuk memverifikasi atau mengubah
// proposal, dokumen, maupun data lain. Guard authorizeDinasPelihat memastikan
// hanya akun dinas yang kodenya terdaftar sebagai pelihat yang bisa masuk.
const express = require('express');
const router = express.Router();
const controller = require('../controllers/dinasPelihatBankeuPerubahan.controller');
const { auth, authorizeDinasPelihat } = require('../middlewares/auth');

router.use(auth, authorizeDinasPelihat);

// Daftar proposal yang sudah final di DPMD (disetujui/ditolak)
router.get('/proposals', controller.getProposals);

// Tracking lintas-tahap, dibatasi ke proposal final yang sama
router.get('/tracking', controller.getTracking);

// Detail per proposal: riwayat versi dokumen, ronde revisi, & log verifikasi
router.get('/proposals/:id/versions', controller.ensureFinalProposal, controller.getProposalVersions);
router.get('/proposals/:id/revisions', controller.ensureFinalProposal, controller.getProposalRevisions);
router.get('/proposals/:proposalId/history', controller.ensureFinalProposal, controller.getProposalVerificationHistory);

module.exports = router;
