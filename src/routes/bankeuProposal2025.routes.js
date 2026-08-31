// Proposal Bantuan Keuangan TA 2025 — sisi DESA.
//
// Hak aksesnya menumpang izin "bankeu" yang sama dengan halaman Bantuan
// Keuangan, jadi akun desa yang sudah diberi menu itu oleh Admin Desa langsung
// bisa mengunggah proposal — tidak perlu izin baru dan tidak ada akun terpisah.
const express = require('express');
const router = express.Router();
const controller = require('../controllers/bankeuProposal2025.controller');
const { auth } = require('../middlewares/auth');
const { requireDesaPermission } = require('../middlewares/desaPermission');
const upload = require('../middlewares/upload');

router.use(auth);
router.use(requireDesaPermission('bankeu'));

// Daftar berkas proposal milik desa yang login
router.get('/', controller.getMyProposal);

// Unggah berkas proposal (boleh beberapa sekaligus)
router.post('/upload', upload.bankeuProposal2025, controller.uploadProposal);

// Hapus berkas milik sendiri
router.delete('/:id', controller.deleteProposal);

module.exports = router;
