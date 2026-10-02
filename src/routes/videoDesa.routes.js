/**
 * Rute Video Desa.
 *
 * Tiga kelompok yang harus tetap terpisah:
 * 1. `/publik/:token/*` — unggahan desa lewat tautan yang dibagikan, TANPA login.
 * 2. `/putar/:id`       — tanpa header Authorization (dipakai elemen <video> dan
 *                         tautan unduhan); izinnya tanda tangan `?t=` berumur pendek.
 * 3. Sisanya            — pengelolaan bidang, wajib login.
 *
 * Urutan pendaftaran penting: semua rute berawalan tetap (`/publik`, `/bidang`,
 * `/kiriman`, `/putar`) harus lebih dulu daripada `/:id`.
 */

const express = require('express');
const router = express.Router();
const { auth } = require('../middlewares/auth');
const { checkBidangAccess } = require('../middlewares/bidangAccess');
const ctrl = require('../controllers/videoDesa.controller');

// Body potongan unggahan berupa byte mentah. Batasnya sedikit di atas ukuran
// potongan supaya potongan yang sah tidak pernah ditolak parser.
const bodyPotongan = express.raw({
  type: 'application/octet-stream',
  limit: ctrl.UKURAN_POTONGAN + 1024 * 1024,
});

// ---------- Publik (tanpa login) ----------
router.get('/publik/:token', (req, res) => ctrl.publik(req, res));
router.post('/publik/:token/unggah', (req, res) => ctrl.mulaiUnggah(req, res));
router.get('/publik/:token/unggah/:uploadId', (req, res) => ctrl.statusUnggah(req, res));
router.put('/publik/:token/unggah/:uploadId/:indeks', bodyPotongan, (req, res) => ctrl.potongan(req, res));
router.post('/publik/:token/unggah/:uploadId/selesai', (req, res) => ctrl.selesaiUnggah(req, res));
router.delete('/publik/:token/unggah/:uploadId', (req, res) => ctrl.batalUnggah(req, res));

// ---------- Putar/unduh (tautan bertanda tangan) ----------
router.get('/putar/:id', (req, res) => ctrl.putar(req, res));

// ---------- Pengelolaan per bidang ----------
router.get('/bidang/:bidangId', auth, checkBidangAccess, (req, res) => ctrl.daftar(req, res));
router.post('/bidang/:bidangId', auth, checkBidangAccess, (req, res) => ctrl.buat(req, res));

// ---------- Kiriman ----------
router.patch('/kiriman/:id', auth, (req, res) => ctrl.tinjau(req, res));
router.delete('/kiriman/:id', auth, (req, res) => ctrl.hapusKiriman(req, res));
router.get('/kiriman/:id/tautan', auth, (req, res) => ctrl.tautan(req, res));

// ---------- Satu permintaan ----------
router.get('/:id', auth, (req, res) => ctrl.detail(req, res));
router.patch('/:id', auth, (req, res) => ctrl.ubah(req, res));
router.delete('/:id', auth, (req, res) => ctrl.hapus(req, res));

module.exports = router;
