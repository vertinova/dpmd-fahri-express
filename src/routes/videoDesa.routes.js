/**
 * Rute Video Desa.
 *
 * Empat kelompok yang harus tetap terpisah:
 * 1. `/publik/:token/*` — satu tautan untuk semua desa, TANPA login. `:token`
 *                         adalah token tautan tunggal (dikelola Sekretariat).
 * 2. `/putar/:id`       — tanpa header Authorization (elemen <video> & tautan
 *                         unduhan); izinnya tanda tangan `?t=` berumur pendek.
 * 3. `/tautan`          — kelola tautan tunggal (Sekretariat/pimpinan).
 * 4. Sisanya            — kegiatan & verifikasi per bidang, wajib login.
 *
 * Semua rute berawalan tetap harus lebih dulu daripada `/:id`.
 */

const express = require('express');
const router = express.Router();
const { auth } = require('../middlewares/auth');
const { checkBidangAccess } = require('../middlewares/bidangAccess');
const ctrl = require('../controllers/videoDesa.controller');

// Body potongan berupa byte mentah; batasnya sedikit di atas ukuran potongan.
const bodyPotongan = express.raw({
  type: 'application/octet-stream',
  limit: ctrl.UKURAN_POTONGAN + 1024 * 1024,
});

// ---------- Publik (tanpa login) ----------
router.get('/publik/:token', (req, res) => ctrl.publik(req, res));
router.get('/publik/:token/desa/:desaId', (req, res) => ctrl.statusDesa(req, res));
router.post('/publik/:token/unggah', (req, res) => ctrl.mulaiUnggah(req, res));
router.get('/publik/:token/unggah/:uploadId', (req, res) => ctrl.statusUnggah(req, res));
router.put('/publik/:token/unggah/:uploadId/:indeks', bodyPotongan, (req, res) => ctrl.potongan(req, res));
router.post('/publik/:token/unggah/:uploadId/selesai', (req, res) => ctrl.selesaiUnggah(req, res));
router.delete('/publik/:token/unggah/:uploadId', (req, res) => ctrl.batalUnggah(req, res));

// ---------- Putar/unduh (tautan bertanda tangan) ----------
router.get('/putar/:id', (req, res) => ctrl.putar(req, res));

// ---------- Tautan tunggal ----------
router.get('/tautan', auth, (req, res) => ctrl.lihatTautan(req, res));
router.post('/tautan', auth, (req, res) => ctrl.buatTautan(req, res));
router.patch('/tautan', auth, (req, res) => ctrl.ubahTautan(req, res));

// ---------- Kegiatan per bidang ----------
router.get('/bidang/:bidangId', auth, checkBidangAccess, (req, res) => ctrl.daftar(req, res));
router.post('/bidang/:bidangId', auth, checkBidangAccess, (req, res) => ctrl.buat(req, res));

// ---------- Verifikasi kiriman ----------
router.patch('/kiriman/:id', auth, (req, res) => ctrl.tinjau(req, res));
router.delete('/kiriman/:id', auth, (req, res) => ctrl.hapusKiriman(req, res));
router.get('/kiriman/:id/tautan', auth, (req, res) => ctrl.tautanPutar(req, res));

// ---------- Satu kegiatan ----------
router.get('/:id', auth, (req, res) => ctrl.detail(req, res));
router.patch('/:id', auth, (req, res) => ctrl.ubah(req, res));
router.delete('/:id', auth, (req, res) => ctrl.hapus(req, res));

module.exports = router;
