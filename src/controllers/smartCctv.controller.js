/**
 * Controller Smart CCTV — lapisan HTTP.
 *
 * Tiga kelompok utama:
 *  1. Kontrak layanan AI (Bearer CCTV_SERVICE_API_KEY / X-Internal-Token).
 *  2. Kelola kamera, riwayat, statistik, playback (login + peran staf).
 *  3. Enrollment wajah.
 *
 * Logika bisnis ada di smartCctv.service.js — controller hanya menerjemahkan
 * request/response dan memvalidasi input.
 */

const prisma = require('../config/prisma');
const logger = require('../utils/logger');
const ActivityLogger = require('../utils/activityLogger');
const svc = require('../services/smartCctv.service');

const kosong = (res) => res.status(404).json({ success: false, message: 'Data tidak ditemukan' });
const gagal = (res, err, pesan = 'Terjadi kesalahan pada server') => {
  logger.error(`[SmartCCTV] ${pesan}:`, err.message);
  return res.status(500).json({ success: false, message: pesan });
};

// ───────────────────── Autentikasi layanan AI ─────────────────────

/** Bearer token = CCTV_SERVICE_API_KEY (daftar kamera & embedding wajah). */
const svcAuth = (req, res, next) => {
  const expected = process.env.CCTV_SERVICE_API_KEY;
  if (!expected) {
    return res.status(503).json({ success: false, message: 'CCTV_SERVICE_API_KEY belum dikonfigurasi' });
  }
  const token = (req.header('Authorization') || '').replace('Bearer ', '');
  if (token !== expected) {
    logger.warn('[SmartCCTV] API key layanan AI tidak cocok');
    return res.status(401).json({ success: false, message: 'Invalid API key' });
  }
  next();
};

/** Header X-Internal-Token = CCTV_INTERNAL_TOKEN (injeksi peristiwa). */
const internalAuth = (req, res, next) => {
  const expected = process.env.CCTV_INTERNAL_TOKEN;
  if (!expected) {
    return res.status(503).json({ success: false, message: 'CCTV_INTERNAL_TOKEN belum dikonfigurasi' });
  }
  const token = req.header('X-Internal-Token') || '';
  if (token !== expected) {
    logger.warn('[SmartCCTV] Token internal injeksi peristiwa tidak cocok');
    return res.status(401).json({ success: false, message: 'Invalid internal token' });
  }
  next();
};

// ─────────────────────── Kontrak layanan AI ───────────────────────

const kameraUntukAI = async (req, res) => {
  try {
    res.json(await svc.daftarKameraLayanan());
  } catch (err) {
    gagal(res, err);
  }
};

const kameraUntukAIDetail = async (req, res) => {
  try {
    const kamera = await svc.kameraDetailLayanan(req.params.id);
    if (!kamera) return res.status(404).json({ success: false, message: 'Camera not found' });
    res.json({ camera: kamera });
  } catch (err) {
    gagal(res, err);
  }
};

const embeddingUntukAI = async (req, res) => {
  try {
    res.json(await svc.daftarEmbeddingLayanan());
  } catch (err) {
    gagal(res, err);
  }
};

const terimaEmbedding = async (req, res) => {
  try {
    const embedding = Array.isArray(req.body.embedding)
      ? req.body.embedding.map(Number)
      : typeof req.body.embedding === 'string'
        ? JSON.parse(req.body.embedding).map(Number)
        : null;
    if (!embedding || !embedding.length) {
      return res.status(422).json({ success: false, message: 'embedding tidak valid' });
    }
    const ada = await svc.simpanEmbeddingDariAI(req.params.id, embedding);
    if (!ada) return res.status(404).json({ success: false, message: 'Photo not found' });
    res.json({ success: true });
  } catch (err) {
    gagal(res, err);
  }
};

const terimaRecognitionEvent = async (req, res) => {
  try {
    const { status, hasil } = await svc.simpanRecognitionEvent(req.body, req.file ? req.file.buffer : null);
    res.status(status).json(hasil);
  } catch (err) {
    gagal(res, err, 'Gagal menyimpan peristiwa pengenalan');
  }
};

const terimaEmergencyEvent = async (req, res) => {
  try {
    const { status, hasil } = await svc.simpanEmergencyEvent(req.body, req.file ? req.file.buffer : null);
    res.status(status).json(hasil);
  } catch (err) {
    gagal(res, err, 'Gagal menyimpan peristiwa darurat');
  }
};

const terimaDetectionLog = async (req, res) => {
  try {
    const { status, hasil } = await svc.simpanDetectionLog(req.body);
    res.status(status).json(hasil);
  } catch (err) {
    gagal(res, err, 'Gagal menyimpan log deteksi');
  }
};

// ───────────────────────────── Kamera ─────────────────────────────

/** Kredensial RTSP tidak pernah ikut ke respons browser. */
const tanpaPassword = (kamera) => {
  if (!kamera) return kamera;
  const { password_enc, ...lain } = kamera;
  return lain;
};

const catatKamera = (user, aksi, keterangan, kamera, lama = null) =>
  ActivityLogger.log({
    userId: user.id,
    userName: user.name,
    userRole: user.role,
    bidangId: user.bidang_id ? Number(user.bidang_id) : null,
    module: 'smart-cctv',
    action: aksi,
    entityType: 'cctv_cameras',
    entityId: kamera ? kamera.id : null,
    entityName: kamera ? kamera.name : null,
    description: keterangan,
    oldValue: lama,
    ipAddress: null,
    userAgent: null
  });

const daftarKamera = async (req, res) => {
  try {
    const daftar = await svc.daftarKamera();
    res.json({ success: true, data: daftar.map(tanpaPassword) });
  } catch (err) {
    gagal(res, err);
  }
};

const detailKamera = async (req, res) => {
  try {
    const kamera = await svc.cariKamera(req.params.id);
    if (!kamera) return kosong(res);
    res.json({ success: true, data: tanpaPassword(svc.serialize(kamera)) });
  } catch (err) {
    gagal(res, err);
  }
};

const buatKamera = async (req, res) => {
  try {
    const input = req.body || {};
    if (!input.name || !String(input.name).trim()) {
      return res.status(422).json({ success: false, message: 'Nama kamera wajib diisi' });
    }
    if (!input.rtsp_url || !String(input.rtsp_url).trim()) {
      return res.status(422).json({ success: false, message: 'URL RTSP wajib diisi' });
    }
    const kamera = await svc.buatKamera(input, req.user);
    await catatKamera(req.user, 'create', `Menambah kamera CCTV "${kamera.name}"`, kamera);
    res.status(201).json({ success: true, data: tanpaPassword(kamera) });
  } catch (err) {
    gagal(res, err, 'Gagal menambah kamera');
  }
};

const ubahKamera = async (req, res) => {
  try {
    const kamera = await svc.ubahKamera(req.params.id, req.body || {}, req.user);
    if (!kamera) return kosong(res);
    await catatKamera(req.user, 'update', `Memperbarui kamera CCTV "${kamera.name}"`, kamera);
    res.json({ success: true, data: tanpaPassword(kamera) });
  } catch (err) {
    gagal(res, err, 'Gagal memperbarui kamera');
  }
};

const hapusKamera = async (req, res) => {
  try {
    const kamera = await svc.cariKamera(req.params.id);
    if (!kamera) return kosong(res);
    await svc.hapusKamera(req.params.id);
    await catatKamera(req.user, 'delete', `Menghapus kamera CCTV "${kamera.name}"`, kamera, {
      name: kamera.name,
      rtsp_url: kamera.rtsp_url
    });
    res.json({ success: true, message: 'Kamera dihapus' });
  } catch (err) {
    gagal(res, err, 'Gagal menghapus kamera');
  }
};

const toggleKamera = async (req, res) => {
  try {
    const kamera = await svc.cariKamera(req.params.id);
    if (!kamera) return kosong(res);
    const aktif = req.body ? req.body.aktif !== false : true;
    const diperbarui = await svc.toggleKamera(req.params.id, aktif);
    await catatKamera(
      req.user,
      'toggle_status',
      `${aktif ? 'Mengaktifkan' : 'Menonaktifkan'} kamera CCTV "${kamera.name}"`,
      diperbarui
    );
    res.json({ success: true, data: tanpaPassword(diperbarui) });
  } catch (err) {
    gagal(res, err, 'Gagal mengubah status kamera');
  }
};

const testKoneksi = async (req, res) => {
  try {
    const kamera = await svc.cariKamera(req.params.id);
    if (!kamera) return kosong(res);
    const hasil = await svc.testKoneksi(kamera);
    res.json({ success: hasil.ok, data: hasil.data || null, message: hasil.pesan || (hasil.ok ? null : hasil.error) });
  } catch (err) {
    gagal(res, err, 'Gagal menguji koneksi');
  }
};

const urlStream = async (req, res) => {
  try {
    const kamera = await svc.cariKamera(req.params.id);
    if (!kamera) return kosong(res);
    res.json({
      success: true,
      data: {
        webrtc_url: kamera.go2rtc_src ? `/go2rtc/api/webrtc?src=${encodeURIComponent(kamera.go2rtc_src)}` : null,
        mjpeg_url: `/ai/cameras/${kamera.id}/stream`,
        snapshot_url: `/ai/cameras/${kamera.id}/snapshot?t=${Date.now()}`,
        go2rtc_src: kamera.go2rtc_src
      }
    });
  } catch (err) {
    gagal(res, err);
  }
};

// ───────────────────────── Riwayat & statistik ─────────────────────────

const daftarPeristiwa = async (req, res) => {
  try {
    res.json({ success: true, data: await svc.daftarPeristiwa(req.query) });
  } catch (err) {
    gagal(res, err);
  }
};

const detailPeristiwa = async (req, res) => {
  try {
    const item = await svc.detailPeristiwa(req.params.id);
    if (!item) return kosong(res);
    res.json({ success: true, data: item });
  } catch (err) {
    gagal(res, err);
  }
};

const snapshotPeristiwa = async (req, res) => {
  try {
    const item = await svc.detailPeristiwa(req.params.id);
    const file = svc.pathSnapshot(item);
    if (!file) return kosong(res);
    res.type('image/jpeg');
    res.sendFile(file);
  } catch (err) {
    gagal(res, err);
  }
};

const acknowledgePeristiwa = async (req, res) => {
  try {
    const item = await svc.ubahStatusPeristiwa(req.params.id, 'acknowledged', req.user);
    if (!item) return kosong(res);
    res.json({ success: true, data: item });
  } catch (err) {
    gagal(res, err, 'Gagal mengakui peristiwa');
  }
};

const resolvePeristiwa = async (req, res) => {
  try {
    const item = await svc.ubahStatusPeristiwa(req.params.id, 'resolved', req.user);
    if (!item) return kosong(res);
    res.json({ success: true, data: item });
  } catch (err) {
    gagal(res, err, 'Gagal menyelesaikan peristiwa');
  }
};

const akuiSemua = async (req, res) => {
  try {
    const count = await svc.akuiSemua(req.user);
    res.json({ success: true, data: { count } });
  } catch (err) {
    gagal(res, err, 'Gagal mengakui semua peristiwa');
  }
};

const statistik = async (req, res) => {
  try {
    res.json({ success: true, data: await svc.statistik() });
  } catch (err) {
    gagal(res, err);
  }
};

// ───────────────────────────── Playback ─────────────────────────────

// Kegagalan proxy AI membawa bodi FastAPI `{ detail: { message } }` atau
// `{ detail: 'teks' }` — diratakan jadi `message` agar konsisten dengan
// endpoint lain (klien cukup membaca `data.message`).
const responGagalAI = (res, hasil) => {
  const d = hasil.data || {};
  const detail = d.detail;
  const pesan =
    (detail && typeof detail === "object" && detail.message) ||
    (typeof detail === "string" && detail && detail) ||
    d.message ||
    "Layanan AI tidak terjangkau";
  return res
    .status(hasil.status || 503)
    .json({ success: false, message: pesan, ...(detail && typeof detail === "object" ? { detail } : {}) });
};

const putar = async (req, res) => {
  try {
    const hasil = await svc.putarPlayback(req.body || {});
    if (!hasil.ok) return responGagalAI(res, hasil);
    res.json({ success: true, data: hasil.data });
  } catch (err) {
    gagal(res, err, "Gagal memulai playback");
  }
};

const seek = async (req, res) => {
  try {
    const hasil = await svc.seekPlayback(req.params.sid, req.body || {});
    if (!hasil.ok) return responGagalAI(res, hasil);
    res.json({ success: true, data: hasil.data });
  } catch (err) {
    gagal(res, err, "Gagal memindahkan playback");
  }
};

const stop = async (req, res) => {
  try {
    const hasil = await svc.stopPlayback(req.params.sid);
    if (!hasil.ok) return responGagalAI(res, hasil);
    res.json({ success: true, data: hasil.data });
  } catch (err) {
    gagal(res, err, "Gagal menghentikan playback");
  }
};

const ketersediaan = async (req, res) => {
  try {
    const hasil = await svc.ketersediaanPlayback(req.query.camera_id, req.query.date);
    if (!hasil.ok) return responGagalAI(res, hasil);
    res.json({ success: true, data: hasil.data });
  } catch (err) {
    gagal(res, err, "Gagal memeriksa ketersediaan rekaman");
  }
};

// ───────────────────────────── Wajah ─────────────────────────────

const daftarWajah = async (req, res) => {
  try {
    res.json({ success: true, data: await svc.daftarWajah() });
  } catch (err) {
    gagal(res, err);
  }
};

const buatWajah = async (req, res) => {
  try {
    if (!req.body || !req.body.nama || !String(req.body.nama).trim()) {
      return res.status(422).json({ success: false, message: 'Nama wajah wajib diisi' });
    }
    const wajah = await svc.buatWajah(
      { ...req.body, user_id: req.user.id },
      req.file ? req.file.buffer : null
    );
    await ActivityLogger.log({
      userId: req.user.id,
      userName: req.user.name,
      userRole: req.user.role,
      module: 'smart-cctv',
      action: 'create',
      entityType: 'cctv_faces',
      entityId: wajah.id,
      entityName: wajah.nama,
      description: `Menambahkan wajah "${wajah.nama}" untuk pengenalan CCTV`
    });
    res.status(201).json({ success: true, data: wajah });
  } catch (err) {
    gagal(res, err, 'Gagal menambah wajah');
  }
};

const ubahWajah = async (req, res) => {
  try {
    const wajah = await svc.ubahWajah(req.params.id, req.body || {});
    if (!wajah) return kosong(res);
    res.json({ success: true, data: wajah });
  } catch (err) {
    gagal(res, err, 'Gagal memperbarui wajah');
  }
};

const hapusWajah = async (req, res) => {
  try {
    const ada = await prisma.cctv_faces.findUnique({ where: { id: BigInt(req.params.id) } });
    if (!ada) return kosong(res);
    await svc.hapusWajah(req.params.id);
    await ActivityLogger.log({
      userId: req.user.id,
      userName: req.user.name,
      userRole: req.user.role,
      module: 'smart-cctv',
      action: 'delete',
      entityType: 'cctv_faces',
      entityId: ada.id,
      entityName: ada.nama,
      description: `Menghapus wajah "${ada.nama}" dari pengenalan CCTV`
    });
    res.json({ success: true, message: 'Wajah dihapus' });
  } catch (err) {
    gagal(res, err, 'Gagal menghapus wajah');
  }
};

const tambahFotoWajah = async (req, res) => {
  try {
    if (!req.file) return res.status(422).json({ success: false, message: 'Foto wajah wajib diunggah' });
    const hasil = await svc.tambahFotoWajah(req.params.id, req.file.buffer);
    if (!hasil) return kosong(res);
    if (hasil.error) return res.status(422).json({ success: false, message: hasil.error });
    res.status(201).json({ success: true, message: 'Foto & embedding tersimpan' });
  } catch (err) {
    gagal(res, err, 'Gagal menambahkan foto wajah');
  }
};

const recomputeWajah = async (req, res) => {
  try {
    const hasil = await svc.recomputeWajah(req.params.id);
    if (!hasil) return kosong(res);
    res.json({ success: true, data: hasil });
  } catch (err) {
    gagal(res, err, 'Gagal menghitung ulang embedding');
  }
};

module.exports = {
  svcAuth,
  internalAuth,
  kameraUntukAI,
  kameraUntukAIDetail,
  embeddingUntukAI,
  terimaEmbedding,
  terimaRecognitionEvent,
  terimaEmergencyEvent,
  terimaDetectionLog,
  daftarKamera,
  detailKamera,
  buatKamera,
  ubahKamera,
  hapusKamera,
  toggleKamera,
  testKoneksi,
  urlStream,
  daftarPeristiwa,
  detailPeristiwa,
  snapshotPeristiwa,
  acknowledgePeristiwa,
  resolvePeristiwa,
  akuiSemua,
  statistik,
  putar,
  seek,
  stop,
  ketersediaan,
  daftarWajah,
  buatWajah,
  ubahWajah,
  hapusWajah,
  tambahFotoWajah,
  recomputeWajah
};
