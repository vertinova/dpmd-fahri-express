/**
 * Rute Smart CCTV.
 *
 * Tiga kelompok yang harus tetap urut:
 * 1. `/face-recognition/*` & `/internal/*` — kontrak layanan AI
 *    (Facial-recognition-cctv), dijaga API key / token internal, TANPA login.
 *    Path-nya sengaja dibuat sama persis dengan dashboard Laravel lama supaya
 *    layanan AI cukup mengganti LARAVEL_API_URL tanpa mengubah kode.
 * 2. Kamera, riwayat, statistik, playback — login + staf DPMD + izin Smart CCTV.
 * 3. Wajah (enrollment) — login + staf DPMD + izin "wajah".
 * 4. Akses — superadmin menentukan siapa memakai bagian mana (lihat cctvAccess.js).
 *
 * Semua rute berawalan statis didepankan sebelum rute parameter.
 */

const express = require('express');
const rateLimit = require('express-rate-limit');
const router = express.Router();
const { auth, checkRole } = require('../middlewares/auth');
const { uploadCctvEvent, uploadCctvFoto } = require('../middlewares/upload');
const ctrl = require('../controllers/smartCctv.controller');
const akses = require('../controllers/cctvAkses.controller');
const { butuhCctv } = require('../middlewares/cctvAccess');

const STAFF_ROLES = [
  'superadmin',
  'kepala_dinas',
  'sekretaris_dinas',
  'kepala_bidang',
  'ketua_tim',
  'bendahara',
  'pegawai'
];

// Injeksi peristiwa dari layanan AI: batasi per-IP agar token yang bocor tidak
// bisa dipakai membanjiri database. 600/5 menit jauh di atas laju wajar
// (kamera × interval deteksi) tetapi menutup serangan liar.
const ingestLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 600,
  keyGenerator: (req) => `cctv-ingest:${req.ip}`,
  message: { success: false, message: 'Terlalu banyak kiriman peristiwa CCTV' },
  standardHeaders: true,
  legacyHeaders: false
});

// ───────────── Kelompok 1: kontrak layanan AI (tanpa login) ─────────────

// Pemeriksa token media untuk nginx auth_request (/go2rtc/api/*). Sengaja
// tanpa auth: yang diperiksa token di URL aslinya, bukan sesi login.
router.get('/media-izin', ctrl.izinMedia);

router.get('/face-recognition/cameras', ctrl.svcAuth, (req, res) => ctrl.kameraUntukAI(req, res));
router.get('/face-recognition/cameras/:id', ctrl.svcAuth, (req, res) => ctrl.kameraUntukAIDetail(req, res));
router.get('/face-recognition/face-embeddings', ctrl.svcAuth, (req, res) => ctrl.embeddingUntukAI(req, res));
router.put('/face-recognition/employee-photos/:id/embedding', ctrl.svcAuth, (req, res) => ctrl.terimaEmbedding(req, res));
router.post(
  '/face-recognition/detection-logs',
  ctrl.svcAuth,
  ingestLimiter,
  (req, res) => ctrl.terimaDetectionLog(req, res)
);
router.post(
  '/internal/recognition-events',
  ctrl.internalAuth,
  ingestLimiter,
  uploadCctvEvent.single('snapshot'),
  (req, res) => ctrl.terimaRecognitionEvent(req, res)
);
router.post(
  '/internal/emergency-events',
  ctrl.internalAuth,
  ingestLimiter,
  uploadCctvEvent.single('snapshot'),
  (req, res) => ctrl.terimaEmergencyEvent(req, res)
);

// ───────────── Kelompok 2: kamera (staf DPMD) ─────────────

const staf = checkRole(...STAFF_ROLES);

router.get('/kamera', auth, staf, butuhCctv('lihat', 'peringatan', 'kamera'), (req, res) => ctrl.daftarKamera(req, res));
router.post('/kamera', auth, staf, butuhCctv('kamera'), (req, res) => ctrl.buatKamera(req, res));
router.get('/kamera/stream-url/:id', auth, staf, butuhCctv('lihat'), (req, res) => ctrl.urlStream(req, res));
router.get('/kamera/:id', auth, staf, butuhCctv('lihat', 'kamera'), (req, res) => ctrl.detailKamera(req, res));
router.patch('/kamera/:id', auth, staf, butuhCctv('kamera'), (req, res) => ctrl.ubahKamera(req, res));
router.delete('/kamera/:id', auth, staf, butuhCctv('kamera'), (req, res) => ctrl.hapusKamera(req, res));
router.post('/kamera/:id/toggle', auth, staf, butuhCctv('kamera'), (req, res) => ctrl.toggleKamera(req, res));
router.post('/kamera/:id/test', auth, staf, butuhCctv('kamera'), (req, res) => ctrl.testKoneksi(req, res));

// ───────────── Kelompok 2: riwayat, statistik, playback (staf DPMD) ─────────────

router.get('/stats', auth, staf, butuhCctv('peringatan'), (req, res) => ctrl.statistik(req, res));

router.get('/events', auth, staf, butuhCctv('peringatan'), (req, res) => ctrl.daftarPeristiwa(req, res));
router.post('/events/ack-all', auth, staf, butuhCctv('peringatan'), (req, res) => ctrl.akuiSemua(req, res));
router.get('/events/:id', auth, staf, butuhCctv('peringatan'), (req, res) => ctrl.detailPeristiwa(req, res));
router.get('/events/:id/snapshot', auth, staf, butuhCctv('peringatan'), (req, res) => ctrl.snapshotPeristiwa(req, res));
router.patch('/events/:id/ack', auth, staf, butuhCctv('peringatan'), (req, res) => ctrl.acknowledgePeristiwa(req, res));
router.patch('/events/:id/resolve', auth, staf, butuhCctv('peringatan'), (req, res) => ctrl.resolvePeristiwa(req, res));

router.post('/playback/session', auth, staf, butuhCctv('lihat'), (req, res) => ctrl.putar(req, res));
router.post('/playback/session/:sid/seek', auth, staf, butuhCctv('lihat'), (req, res) => ctrl.seek(req, res));
router.post('/playback/session/:sid/stop', auth, staf, butuhCctv('lihat'), (req, res) => ctrl.stop(req, res));
router.get('/playback/availability', auth, staf, butuhCctv('lihat'), (req, res) => ctrl.ketersediaan(req, res));

// ───────────── Kelompok 4: hak akses (superadmin) ─────────────
// /akses/saya & /akses/riwayat didepankan sebelum /akses/:userId.

const superadmin = checkRole('superadmin');
router.get('/akses/saya', auth, staf, akses.saya);
router.get('/akses/riwayat', auth, superadmin, akses.riwayat);
router.get('/akses', auth, superadmin, akses.daftar);
router.put('/akses', auth, superadmin, akses.aturMassal);
router.put('/akses/:userId', auth, superadmin, akses.atur);

// ───────────── Kelompok 3: wajah (staf DPMD) ─────────────

router.get('/faces', auth, staf, butuhCctv('wajah'), (req, res) => ctrl.daftarWajah(req, res));
router.post('/faces', auth, staf, butuhCctv('wajah'), uploadCctvFoto.single('foto'), (req, res) => ctrl.buatWajah(req, res));
router.patch('/faces/:id', auth, staf, butuhCctv('wajah'), (req, res) => ctrl.ubahWajah(req, res));
router.delete('/faces/:id', auth, staf, butuhCctv('wajah'), (req, res) => ctrl.hapusWajah(req, res));
router.post('/faces/:id/photos', auth, staf, butuhCctv('wajah'), uploadCctvFoto.single('foto'), (req, res) => ctrl.tambahFotoWajah(req, res));
router.post('/faces/:id/recompute-embeddings', auth, staf, butuhCctv('wajah'), (req, res) => ctrl.recomputeWajah(req, res));

module.exports = router;
