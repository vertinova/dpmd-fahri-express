/**
 * Rute Formulir.
 *
 * Dua kelompok yang harus tetap terpisah:
 * 1. `/publik/*` — dilayani ke internet terbuka, tanpa `auth`. Memakai
 *    `authOpsional` supaya pengisi yang kebetulan sudah login tetap dikenali.
 * 2. Sisanya — pengelolaan, wajib login. Rute yang menyebut :bidangId dijaga
 *    `checkBidangAccess`; rute yang menyebut :id memeriksa kepemilikan bidang di
 *    controller karena id formulir tidak menyiratkan bidang mana pun.
 *
 * Urutan pendaftaran penting: `/publik/:token` harus lebih dulu daripada
 * `/:id`, kalau tidak "publik" akan ditangkap sebagai id formulir.
 */

const express = require('express');
const router = express.Router();
const { auth } = require('../middlewares/auth');
const { checkBidangAccess } = require('../middlewares/bidangAccess');
const { uploadFormulir, authOpsional } = require('../middlewares/formulirUpload');
const formulirController = require('../controllers/formulir.controller');

// ---------- Publik (tanpa login) ----------
router.get('/publik/:token', authOpsional, (req, res) => formulirController.publik(req, res));
router.post(
  '/publik/:token/kirim',
  authOpsional,
  // .any(): nama field lampirannya dinamis ("berkas_<id pertanyaan>"), jadi
  // daftar field tetap tidak bisa dipakai di sini.
  uploadFormulir.any(),
  (req, res) => formulirController.kirim(req, res)
);

// ---------- Pengelolaan per bidang ----------
router.get('/bidang/:bidangId', auth, checkBidangAccess, (req, res) => formulirController.daftar(req, res));
router.post('/bidang/:bidangId', auth, checkBidangAccess, (req, res) => formulirController.buat(req, res));

// ---------- Lampiran & respons ----------
router.get('/berkas/:id/unduh', auth, (req, res) => formulirController.unduhBerkas(req, res));
router.delete('/respons/:responsId', auth, (req, res) => formulirController.hapusRespons(req, res));

// ---------- Satu formulir ----------
router.get('/:id', auth, (req, res) => formulirController.detail(req, res));
router.patch('/:id', auth, (req, res) => formulirController.ubah(req, res));
router.delete('/:id', auth, (req, res) => formulirController.hapus(req, res));
router.put('/:id/pertanyaan', auth, (req, res) => formulirController.simpanPertanyaan(req, res));
router.post('/:id/duplikat', auth, (req, res) => formulirController.duplikat(req, res));
router.get('/:id/respons', auth, (req, res) => formulirController.daftarRespons(req, res));
router.get('/:id/ringkasan', auth, (req, res) => formulirController.ringkasan(req, res));
router.get('/:id/ekspor', auth, (req, res) => formulirController.ekspor(req, res));

module.exports = router;
