/**
 * Kerja Sama Desa — rute sisi DESA.
 * Base path: /api/desa/kerjasama
 *
 * Penjaganya hak akses `kerjasama-desa`. Perhatikan rute unggah Perdes: ia
 * memakai penjaga yang SAMA, bukan `produk-hukum`, walau yang dibuatnya baris
 * produk hukum. Itu disengaja — operator kerja sama biasanya tidak diberi akses
 * modul Produk Hukum, dan memaksanya lewat sana berarti datanya berhenti di
 * meja orang lain. Yang dibatasi tetap sempit: satu jenis dokumen (Perdes),
 * untuk desanya sendiri, dengan tempat penetapan yang diisi server.
 */

const express = require('express');
const router = express.Router();
const controller = require('../controllers/kerjasamaDesa.controller');
const { auth, checkRole } = require('../middlewares/auth');
const { requireDesaPermission } = require('../middlewares/desaPermission');
const { uploadProdukHukum, uploadKerjasamaDesa } = require('../middlewares/upload');

router.use(auth, requireDesaPermission('kerjasama-desa'), checkRole('desa', 'superadmin'));

// Katalog bidang & jenis + kondisi legalitas desa ini. Dipanggil sekali saat halaman dibuka.
router.get('/meta', controller.getMeta);

// ── Legalitas (Perdes payung, sekali di awal) ───────────────────────────────
router.get('/legalitas/perdes-tersedia', controller.getPerdesTersedia);
router.put('/legalitas', controller.simpanLegalitas);
router.post('/legalitas/perdes', uploadProdukHukum.single('file'), controller.unggahPerdes);

// ── Kegiatan kerja sama (berulang) ──────────────────────────────────────────
router.get('/', controller.daftar);
router.post('/', controller.buat);
router.put('/:id', controller.ubah);
router.delete('/:id', controller.hapus);
router.post('/:id/dokumen', uploadKerjasamaDesa.single('file'), controller.unggahDokumen);

module.exports = router;
