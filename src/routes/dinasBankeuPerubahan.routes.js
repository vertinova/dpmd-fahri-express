// Bankeu Perubahan — akses READ-ONLY untuk Dinas/OPD (mis. DLH).
// Dinas hanya boleh melihat ARSIP proposal (yang sudah sampai tahap DPMD)
// beserta STATISTIK-nya. Tidak ada aksi verifikasi/edit/hapus di sini.
//
// Semua handler dipakai ulang dari controller DPMD karena secara fungsi
// identik (query read-only yang sama). Guard authorizeDinas memastikan
// hanya role dinas_terkait / verifikator_dinas dengan dinas_id yang lolos.
const express = require('express');
const router = express.Router();
const controller = require('../controllers/bankeuPerubahanDpmd.controller');
const { auth, authorizeDinas } = require('../middlewares/auth');

router.use(auth, authorizeDinas);

// Arsip proposal (submitted_to_dpmd / sudah final di DPMD)
router.get('/proposals', controller.getProposals);

// Statistik ringkas (total, approved, pending, rejected, revision, anggaran)
router.get('/statistics', controller.getStatistics);

// Tracking lintas-tahap (opsional untuk tampilan arsip)
router.get('/tracking', controller.getTracking);

// Detail read-only per proposal: riwayat versi dokumen, ronde revisi, & log
router.get('/proposals/:id/versions', controller.getProposalVersions);
router.get('/proposals/:id/revisions', controller.getProposalRevisions);
router.get('/proposals/:proposalId/history', controller.getProposalVerificationHistory);

module.exports = router;
