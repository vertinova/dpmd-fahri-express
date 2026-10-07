/**
 * Ekspor BUM Desa — data lengkap (.xlsx) dan arsip berkas (.zip).
 * Base path: /api/bumdes/ekspor
 *
 * Rute ini TIDAK ikut bumdes.routes.js dengan sengaja. Di sana ada
 * `router.use(auth, requireDesaPermission('bumdes'))` yang berlaku untuk semua
 * jalur, sementara jalur unduhan di sini justru harus bisa dibuka tanpa header
 * Authorization (lihat verifikasiTiket).
 *
 * Kewenangan: ekspor ini mengeluarkan SELURUH kolom dan SELURUH berkas BUM Desa
 * se-kabupaten dalam satu unduhan, jadi hanya untuk pemegang data BUM Desa —
 * bidang SPKED (bidang 3), dinas, dan superadmin. Akun desa tidak diikutkan:
 * desa mengurus satu BUM Desa dan sudah melihat seluruh berkasnya di halamannya
 * sendiri.
 */

const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const eksporController = require('../controllers/bumdesEkspor.controller');
const { auth, checkRole } = require('../middlewares/auth');
const logger = require('../utils/logger');

const JWT_SECRET = process.env.JWT_SECRET;

const ROLE_EKSPOR = ['pegawai', 'kepala_bidang', 'kepala_dinas', 'ketua_tim', 'sekretaris_dinas', 'dinas', 'superadmin', 'sarana_prasarana'];
const BIDANG_SPKED = 3;

/**
 * Peran berbasis bidang (pegawai, kepala_bidang, ...) ada di semua bidang.
 * Yang boleh mengekspor data BUM Desa hanya bidang SPKED — tanpa penjaga ini,
 * pegawai bidang mana pun bisa menarik seluruh berkas BUM Desa.
 */
const hanyaSpkedAtauAdmin = (req, res, next) => {
  const peran = req.user?.role;
  // kepala_dinas & sekretaris_dinas tidak punya bidang_id tapi membawahi
  // seluruh bidang, dan sudah melihat seluruh data ini di Core Dashboard.
  if (['dinas', 'superadmin', 'sarana_prasarana', 'kepala_dinas', 'sekretaris_dinas'].includes(peran)) return next();
  if (Number(req.user?.bidang_id) === BIDANG_SPKED) return next();
  return res.status(403).json({
    success: false,
    message: 'Ekspor data BUM Desa hanya untuk Bidang SPKED dan administrator',
  });
};

/**
 * Penjaga jalur unduhan.
 *
 * Jalur ini dibuka lewat navigasi peramban supaya berkasnya ditulis langsung ke
 * disk dengan bilah progres — dan navigasi tidak bisa membawa header
 * Authorization. Penggantinya tiket berumur dua menit yang diterbitkan endpoint
 * ber-Authorization di bawah.
 */
const verifikasiTiket = (req, res, next) => {
  const tiket = String(req.query.tiket || '');
  if (!tiket) {
    return res.status(401).json({ success: false, message: 'Tiket unduhan tidak ada' });
  }

  let isi;
  try {
    isi = jwt.verify(tiket, JWT_SECRET);
  } catch (error) {
    const kedaluwarsa = error.name === 'TokenExpiredError';
    logger.warn(`❌ Tiket ekspor BUM Desa ditolak (${error.name}) dari IP ${req.ip}`);
    return res.status(401).json({
      success: false,
      code: kedaluwarsa ? 'TIKET_KEDALUWARSA' : 'TIKET_TIDAK_SAH',
      message: kedaluwarsa
        ? 'Tiket unduhan sudah kedaluwarsa. Tekan tombol unduh lagi.'
        : 'Tiket unduhan tidak sah.',
    });
  }

  if (isi.tipe !== 'bumdes-ekspor') {
    return res.status(401).json({ success: false, message: 'Tiket ini bukan untuk ekspor BUM Desa' });
  }
  // Tiket untuk "data" tidak boleh dipakai menarik seluruh berkas, dan sebaliknya.
  if (isi.jenis !== req.params.jenis) {
    logger.warn(`❌ Tiket ekspor BUM Desa jenis "${isi.jenis}" dipakai untuk "${req.params.jenis}"`);
    return res.status(403).json({
      success: false,
      message: 'Tiket ini tidak berlaku untuk jenis ekspor yang diminta',
    });
  }

  // Cakupan barisnya diambil dari TIKET, lalu query-nya ditimpa. Kalau dibaca
  // dari query, tiket untuk lima BUM Desa bisa dipakai menarik seluruh 416.
  req.query.ids = isi.ids || '';

  // Controller memakai req.user hanya untuk jejak audit; isinya dari tiket,
  // karena tiketnya cuma berumur dua menit.
  req.user = { id: isi.uid, name: isi.nama, email: isi.email || isi.nama, role: isi.peran, bidang_id: isi.bidang };
  return next();
};

router.get('/ringkasan', auth, checkRole(...ROLE_EKSPOR), hanyaSpkedAtauAdmin, eksporController.ringkasan);
router.post('/tiket', auth, checkRole(...ROLE_EKSPOR), hanyaSpkedAtauAdmin, eksporController.buatTiket);
router.get('/unduh/:jenis', verifikasiTiket, eksporController.unduh);

module.exports = router;
