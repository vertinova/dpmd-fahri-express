// Proposal Bantuan Keuangan TA 2025 — sisi DPMD/SPKED.
//
// Tidak ada endpoint verifikasi: proposal 2025 masuk langsung dari desa tanpa
// persetujuan siapa pun. DPMD hanya merekap, mengunduh, dan menghapus berkas
// yang salah unggah.
const express = require('express');
const router = express.Router();
const controller = require('../controllers/bankeuProposal2025.controller');
const { auth, checkRole } = require('../middlewares/auth');

router.use(auth);
router.use(checkRole('kepala_dinas', 'sarana_prasarana', 'pegawai', 'kepala_bidang', 'ketua_tim', 'superadmin'));

// Rekap seluruh desa (termasuk yang belum mengunggah), dikelompokkan per kecamatan
router.get('/', controller.getAllProposal);

// Hapus berkas salah unggah
router.delete('/:id', controller.adminDeleteProposal);

module.exports = router;
