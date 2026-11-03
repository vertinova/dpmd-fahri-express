/**
 * Layanan Smart CCTV — jantung modul pengawasan kamera terpadu.
 *
 * Peran:
 *  1. Kontrak layanan AI (Facial-recognition-cctv): daftar kamera & embedding
 *     wajah dilayani di sini (path kompatibel dengan dashboard Laravel lama),
 *     peristiwa deteksi (wajah/jatuh) diterima, disimpan, lalu disebarkan.
 *  2. Pengelolaan kamera: CRUD + sinkron stream ke go2rtc + start/stop thread AI.
 *  3. Riwayat, pengakuan peristiwa, statistik, playback DVR, enrollment wajah.
 *
 * Setiap peristiwa baru: socket `cctv_alert` → Web Push → (opsional) mirror
 * ke dashboard Laravel paralel yang berfungsi sebagai pembanding.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const axios = require('axios');
const prisma = require('../config/prisma');
const logger = require('../utils/logger');
const { encrypt, decrypt } = require('../utils/cctvSecret');
const go2rtc = require('./go2rtc.service');
const { emitCctvAlert } = require('../socket/cctv.socket');
const pushNotification = require('./pushNotification.service');

const AKAR = path.join(__dirname, '../..');
const DIR_EVENT = path.join(AKAR, 'storage/uploads/cctv/events');
const DIR_FOTO = path.join(AKAR, 'storage/uploads/cctv/faces');

const STAFF_ROLES = [
  'superadmin',
  'kepala_dinas',
  'sekretaris_dinas',
  'kepala_bidang',
  'ketua_tim',
  'bendahara',
  'pegawai'
];

const JENIS_DIKENAL = ['known', 'unknown', 'fall', 'fall_warning', 'immobility', 'other'];
const STATUS_DIKENAL = ['active', 'acknowledged', 'resolved'];

const aiBase = () => (process.env.PYTHON_AI_URL || 'http://127.0.0.1:8001').replace(/\/+$/, '');
const mirrorBase = () => (process.env.CCTV_MIRROR_LARAVEL_URL || '').replace(/\/+$/, '');

const serialize = (value) => {
  if (value === null || value === undefined) return value;
  if (typeof value === 'bigint') return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(serialize);
  if (typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, serialize(v)]));
  }
  return value;
};

const angka = (v, fb = null) => {
  if (v === undefined || v === null || v === '') return fb;
  const n = Number(v);
  return Number.isFinite(n) ? n : fb;
};

const tanggal = (v) => {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
};

// ───────────────────────────── Kredensial RTSP ─────────────────────────────

/**
 * URL kamera tempelan sering sudah membawa `rtsp://user:pass@host/...`.
 * Pisahkan kredensialnya ke kolom terpisah supaya bisa dienkripsi dan URL
 * yang tersimpan tetap bersih.
 */
const pisahKredensial = (url, username, password) => {
  let urlBersih = String(url || '').trim();
  let user = username ? String(username).trim() : null;
  let pass = password !== undefined && password !== null ? String(password) : null;

  const cocok = urlBersih.match(/^(rtsp:\/\/)([^@/\s]+)@(.+)$/);
  if (cocok && !user) {
    const isi = cocok[2];
    const titik = isi.indexOf(':');
    if (titik >= 0) {
      user = isi.slice(0, titik);
      pass = isi.slice(titik + 1);
    } else {
      user = isi;
    }
    urlBersih = `rtsp://${cocok[3]}`;
  }
  if (pass === '') pass = null;
  return { urlBersih, username: user, password: pass };
};

/** URL efektif = URL bersih + kredensial terdekripsi (untuk go2rtc & AI). */
const urlEfektif = (kamera) => {
  const dasar = kamera.rtsp_url_main || kamera.rtsp_url;
  const user = kamera.username;
  const pass = kamera.password_enc ? decrypt(kamera.password_enc) : null;
  if (!user) return dasar;
  const isi = pass ? `${encodeURIComponent(user)}:${encodeURIComponent(pass)}` : encodeURIComponent(user);
  return String(dasar).replace(/^rtsp:\/\//, `rtsp://${isi}@`);
};

// ─────────────────────── Panggilan ke layanan AI ───────────────────────

const panggilAI = async (urutan, body, timeout = 8000) => {
  try {
    const { data } = await axios.post(`${aiBase()}${urutan}`, body, { timeout });
    return { ok: true, data };
  } catch (err) {
    logger.warn(`[SmartCCTV] Panggilan AI ${urutan} gagal: ${err.message}`);
    return { ok: false, error: err.message };
  }
};

const kabariAIStart = (id) => panggilAI(`/cameras/${id}/start`, {}, 4000);
const kabariAIStop = (id) => panggilAI(`/cameras/${id}/stop`, {}, 4000);

/** Test koneksi RTSP lewat layanan AI (ffmpeg probe). */
const testKoneksi = async (kamera) => {
  const body = {
    rtsp_url: urlEfektif(kamera),
    username: kamera.username || undefined,
    password: kamera.password_enc ? decrypt(kamera.password_enc) : undefined
  };
  const hasil = await panggilAI('/test-rtsp', body, 25000);
  if (!hasil.ok) return { ok: false, pesan: 'Layanan AI tidak terjangkau', detail: hasil.error };
  return { ok: true, data: hasil.data };
};

// ───────────────────────────── Kamera: query ─────────────────────────────

const daftarKamera = async () => {
  const kamera = await prisma.cctv_cameras.findMany({
    orderBy: [{ status: 'asc' }, { name: 'asc' }],
    include: { _count: { select: { events: true } } }
  });
  return serialize(kamera);
};

const cariKamera = (id) =>
  prisma.cctv_cameras.findUnique({ where: { id: BigInt(id) } });

// ───────────────────── Kamera: kontrak layanan AI ─────────────────────

/**
 * GET /face-recognition/cameras — daftar ringkas untuk thread AI.
 * rtsp_url sudah memuat kredensial (seperti perilaku dashboard lama) karena
 * endpoint ini dijaga CCTV_SERVICE_API_KEY.
 */
const daftarKameraLayanan = async () => {
  const kamera = await prisma.cctv_cameras.findMany({
    where: { status: { not: 'inactive' } },
    orderBy: { id: 'asc' }
  });
  const cameras = kamera.map((k) => ({
    id: Number(k.id),
    name: k.name,
    rtsp_url: urlEfektif(k),
    location: k.lokasi || '',
    status: k.status,
    recognition_enabled: k.recognition_enabled
  }));
  return { cameras };
};

/** GET /face-recognition/cameras/:id — baris lengkap (dipakai saat start thread). */
const kameraDetailLayanan = async (id) => {
  const k = await cariKamera(id);
  if (!k) return null;
  return {
    id: Number(k.id),
    name: k.name,
    rtsp_url: urlEfektif(k),
    rtsp_url_main: k.rtsp_url_main ? urlEfektif({ ...k, rtsp_url_main: null }) : null,
    username: k.username,
    password: k.password_enc ? decrypt(k.password_enc) : null,
    location: k.lokasi || '',
    status: k.status,
    recognition_enabled: k.recognition_enabled,
    reconnect_interval: 5
  };
};

/**
 * GET /face-recognition/face-embeddings — wajah + embedding untuk matrix match.
 * Bentuk daftar sama dengan dashboard lama supaya layanan AI tanpa perubahan.
 */
const daftarEmbeddingLayanan = async () => {
  const wajah = await prisma.cctv_faces.findMany({
    include: { embeddings: { orderBy: { id: 'asc' } } },
    orderBy: { id: 'asc' }
  });
  return {
    employees: wajah.map((w) => ({
      id: Number(w.id),
      employee_code: w.kode_pegawai || String(w.id),
      name: w.nama,
      department: w.departemen || '',
      embeddings: w.embeddings.map((e) => ({
        id: Number(e.id),
        image_path: e.image_path,
        embedding: e.embedding
      }))
    }))
  };
};

/** PUT /face-recognition/employee-photos/:id/embedding */
const simpanEmbeddingDariAI = async (embeddingId, embedding) => {
  const baris = await prisma.cctv_face_embeddings.findUnique({
    where: { id: BigInt(embeddingId) }
  });
  if (!baris) return false;
  await prisma.cctv_face_embeddings.update({
    where: { id: baris.id },
    data: { embedding }
  });
  return true;
};

// ───────────────────────── Simpan snapshot ─────────────────────────

const tulisSnapshot = (buffer, uuid, prefix) => {
  if (!buffer || !buffer.length) return null;
  try {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    const dir = path.join(DIR_EVENT, String(y), m, d);
    fs.mkdirSync(dir, { recursive: true });
    const nama = `${prefix}_${uuid}.jpg`;
    fs.writeFileSync(path.join(dir, nama), buffer);
    return `storage/uploads/cctv/events/${y}/${m}/${d}/${nama}`.replace(/\\/g, '/');
  } catch (err) {
    logger.error(`[SmartCCTV] Gagal menyimpan snapshot: ${err.message}`);
    return null;
  }
};

// ─────────────────────── Sebar peristiwa (socket+push+mirror) ───────────────────────

const sebarPeristiwa = async (peristiwa, kamera) => {
  // 1. Socket — grid kamera & toast staf langsung ter-update.
  try {
    emitCctvAlert({
      id: Number(peristiwa.id),
      camera_id: Number(peristiwa.camera_id),
      camera_name: kamera ? kamera.name : null,
      lokasi: kamera ? kamera.lokasi : null,
      type: peristiwa.type,
      severity: peristiwa.severity,
      nama: peristiwa.nama,
      confidence: peristiwa.confidence,
      snapshot_url: `/api/smart-cctv/events/${peristiwa.id}/snapshot`,
      occurred_at: peristiwa.occurred_at
    });
  } catch (err) {
    logger.warn(`[SmartCCTV] Gagal broadcast cctv_alert: ${err.message}`);
  }

  // 2. Web Push — hanya peristiwa yang butuh perhatian (bukan wajah dikenal).
  if (peristiwa.severity !== 'info') {
    try {
      const label =
        peristiwa.type === 'fall' ? 'Terkdeteksi JATUH'
        : peristiwa.type === 'fall_warning' ? 'Peringatan jatuh'
        : peristiwa.type === 'unknown' ? 'Wajah tidak dikenal'
        : 'Peristiwa CCTV';
      await pushNotification.sendToRoles(STAFF_ROLES, {
        title: `Smart CCTV — ${label}`,
        body: `${kamera ? kamera.name : 'Kamera'}${peristiwa.nama ? ` · ${peristiwa.nama}` : ''} · ${new Date(peristiwa.occurred_at).toLocaleString('id-ID')}`,
        path: `cctv/history?event=${peristiwa.id}`
      });
    } catch (err) {
      logger.warn(`[SmartCCTV] Gagal mengirim push: ${err.message}`);
    }
  }
};

/**
 * Mirror ke dashboard Laravel paralel (pembanding). Fire-and-forget:
 * kegagalan mirror tidak pernah menggagalkan ingest di sini.
 */
const mirrorMultipart = (urutan, fields, buffer, namaBerkas, headerToken) => {
  const dasar = mirrorBase();
  if (!dasar || !process.env.CCTV_MIRROR_LARAVEL_TOKEN) return;
  try {
    const fd = new FormData();
    for (const [k, v] of Object.entries(fields)) {
      if (v === undefined || v === null) continue;
      if (Array.isArray(v)) v.forEach((x) => fd.append(`${k}[]`, String(x)));
      else fd.append(k, String(v));
    }
    if (buffer && buffer.length) {
      fd.append('snapshot', new Blob([buffer], { type: 'image/jpeg' }), namaBerkas);
    }
    axios
      .post(`${dasar}${urutan}`, fd, {
        headers: { 'X-Internal-Token': process.env.CCTV_MIRROR_LARAVEL_TOKEN },
        timeout: 5000
      })
      .catch((err) => logger.debug(`[SmartCCTV] Mirror ${urutan} gagal: ${err.message}`));
  } catch (err) {
    logger.debug(`[SmartCCTV] Mirror ${urutan} error: ${err.message}`);
  }
};

// ───────────────────────── Ingestion peristiwa ─────────────────────────

const uuidTetap = (teks) => crypto.createHash('md5').update(teks).digest('hex').slice(0, 32);

const cekDuplikat = async (uuid) => {
  const ada = await prisma.cctv_events.findUnique({ where: { event_uuid: uuid } });
  return ada ? serialize(ada) : null;
};

const sebarSetelahSimpan = async (peristiwa, cameraId) => {
  const kamera = await cariKamera(cameraId).catch(() => null);
  await sebarPeristiwa(peristiwa, kamera);
  return serialize(peristiwa);
};

/** POST /internal/recognition-events (multipart, idempoten pada event_uuid). */
const simpanRecognitionEvent = async (fields, buffer) => {
  const uuid = fields.event_uuid ? String(fields.event_uuid).slice(0, 64) : uuidTetap(JSON.stringify(fields));
  const lama = await cekDuplikat(uuid);
  if (lama) return { status: 200, hasil: { success: true, duplicate: true, log: lama } };

  const cameraId = angka(fields.camera_id);
  if (!cameraId) return { status: 422, hasil: { success: false, message: 'camera_id wajib diisi' } };
  const kamera = await cariKamera(cameraId);
  if (!kamera) return { status: 422, hasil: { success: false, message: 'Kamera tidak ditemukan' } };

  const jenis = JENIS_DIKENAL.includes(fields.type) ? fields.type : 'other';
  const faceId = angka(fields.employee_id);
  let wajah = null;
  if (faceId) wajah = await prisma.cctv_faces.findUnique({ where: { id: BigInt(faceId) } }).catch(() => null);

  const snapshot = tulisSnapshot(buffer, uuid, 'wajah');
  const data = {
    event_uuid: uuid,
    camera_id: kamera.id,
    type: jenis,
    severity: jenis === 'unknown' ? 'warning' : 'info',
    face_id: wajah ? wajah.id : null,
    nama: wajah ? wajah.nama : null,
    similarity: angka(fields.similarity),
    confidence: angka(fields.confidence),
    bbox: Array.isArray(fields.bbox) ? fields.bbox.map(Number).filter((n) => Number.isFinite(n))
        : fields['bbox[]'] ? [].concat(fields['bbox[]']).map(Number).filter((n) => Number.isFinite(n))
        : null,
    track_id: fields.track_id ? String(fields.track_id).slice(0, 100) : null,
    snapshot_path: snapshot,
    occurred_at: tanggal(fields.occurred_at) || new Date()
  };

  const peristiwa = await prisma.cctv_events.create({ data });
  mirrorMultipart('/internal/recognition-events', fields, buffer, 'face.jpg');
  const hasil = await sebarSetelahSimpan(peristiwa, kamera.id);
  return { status: 201, hasil: { success: true, log: hasil } };
};

/** POST /internal/emergency-events (fall/immobility/other, idempoten). */
const simpanEmergencyEvent = async (fields, buffer) => {
  const uuid = fields.event_uuid ? String(fields.event_uuid).slice(0, 64) : uuidTetap(JSON.stringify(fields));
  const lama = await cekDuplikat(uuid);
  if (lama) return { status: 200, hasil: { success: true, duplicate: true, log: lama } };

  const cameraId = angka(fields.camera_id);
  if (!cameraId) return { status: 422, hasil: { success: false, message: 'camera_id wajib diisi' } };
  const kamera = await cariKamera(cameraId);
  if (!kamera) return { status: 422, hasil: { success: false, message: 'Kamera tidak ditemukan' } };

  // `fall_warning` tidak ada di enum dashboard lama (fall|immobility|other);
  // di sini kita simpan utuh, mirror-nya diturunkan ke `other`.
  const jenis = JENIS_DIKENAL.includes(fields.type) ? fields.type : 'other';
  const severity =
    fields.severity === 'critical' || fields.severity === 'warning'
      ? fields.severity
      : jenis === 'fall' || jenis === 'immobility'
        ? 'critical'
        : jenis === 'fall_warning'
          ? 'warning'
          : 'info';

  const snapshot = tulisSnapshot(buffer, uuid, 'darurat');
  const data = {
    event_uuid: uuid,
    camera_id: kamera.id,
    type: jenis,
    severity,
    confidence: angka(fields.confidence),
    bbox: Array.isArray(fields.bbox) ? fields.bbox.map(Number).filter((n) => Number.isFinite(n))
        : fields['bbox[]'] ? [].concat(fields['bbox[]']).map(Number).filter((n) => Number.isFinite(n))
        : null,
    track_id: fields.track_id ? String(fields.track_id).slice(0, 100) : null,
    snapshot_path: snapshot,
    metadata: {
      fallen_duration: angka(fields.fallen_duration),
      body_angle: angka(fields.body_angle)
    },
    occurred_at: tanggal(fields.occurred_at) || new Date()
  };

  const peristiwa = await prisma.cctv_events.create({ data });

  const fieldsMirror = { ...fields, type: jenis === 'fall_warning' ? 'other' : jenis };
  mirrorMultipart('/internal/emergency-events', fieldsMirror, buffer, 'emergency.jpg');
  const hasil = await sebarSetelahSimpan(peristiwa, kamera.id);
  return { status: 201, hasil: { success: true, log: hasil } };
};

/**
 * POST /face-recognition/detection-logs (JSON, jalur lama).
 * Tidak membawa berkas snapshot — path aslinya di mesin AI disimpan di metadata.
 */
const simpanDetectionLog = async (payload) => {
  const cameraId = angka(payload.camera_id);
  if (!cameraId) return { status: 422, hasil: { success: false, message: 'camera_id wajib diisi' } };
  const kamera = await cariKamera(cameraId);
  if (!kamera) return { status: 422, hasil: { success: false, message: 'Kamera tidak ditemukan' } };

  const dikenal = payload.status === 'recognized';
  const uuid = uuidTetap(
    `${cameraId}|${payload.timestamp || ''}|${payload.employee_id || ''}|${payload.status || ''}`
  );
  const lama = await cekDuplikat(uuid);
  if (lama) return { status: 200, hasil: { success: true, duplicate: true, log: lama } };

  const faceId = angka(payload.employee_id);
  let wajah = null;
  if (faceId) wajah = await prisma.cctv_faces.findUnique({ where: { id: BigInt(faceId) } }).catch(() => null);

  const peristiwa = await prisma.cctv_events.create({
    data: {
      event_uuid: uuid,
      camera_id: kamera.id,
      type: dikenal ? 'known' : 'unknown',
      severity: dikenal ? 'info' : 'warning',
      face_id: wajah ? wajah.id : null,
      nama: wajah ? wajah.nama : payload.employee_name || null,
      confidence: angka(payload.confidence),
      snapshot_path: null,
      metadata: { snapshot_path: payload.snapshot_path || null },
      occurred_at: tanggal(payload.timestamp) || new Date()
    }
  });

  const dasar = mirrorBase();
  if (dasar && process.env.CCTV_MIRROR_LARAVEL_TOKEN) {
    axios
      .post(`${dasar}/face-recognition/detection-logs`, payload, {
        headers: {
          Authorization: `Bearer ${process.env.CCTV_MIRROR_LARAVEL_TOKEN}`,
          'Content-Type': 'application/json'
        },
        timeout: 5000
      })
      .catch((err) => logger.debug(`[SmartCCTV] Mirror detection-logs gagal: ${err.message}`));
  }

  const hasil = await sebarSetelahSimpan(peristiwa, kamera.id);
  return { status: 201, hasil: { success: true, log: hasil } };
};

// ───────────────────────── Riwayat & pengakuan ─────────────────────────

const daftarPeristiwa = async (q) => {
  const where = {};
  if (q.camera_id) where.camera_id = BigInt(q.camera_id);
  if (q.type) {
    const jenis = String(q.type).split(',').map((s) => s.trim()).filter((s) => JENIS_DIKENAL.includes(s));
    if (jenis.length) where.type = { in: jenis };
  }
  if (q.status && STATUS_DIKENAL.includes(q.status)) where.status = q.status;
  if (q.severity) where.severity = q.severity;
  if (q.nama) where.nama = { contains: String(q.nama) };
  const dari = tanggal(q.dari);
  const sampai = tanggal(q.sampai);
  if (dari || sampai) {
    where.occurred_at = {};
    if (dari) where.occurred_at.gte = dari;
    if (sampai) {
      // Sampai = akhir hari itu bila hanya tanggal polos dikirim.
      const batas = new Date(sampai);
      if (/^\d{4}-\d{2}-\d{2}$/.test(String(q.sampai))) batas.setHours(23, 59, 59, 999);
      where.occurred_at.lte = batas;
    }
  }

  const page = Math.max(1, parseInt(q.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(q.limit, 10) || 20));
  const [items, total] = await Promise.all([
    prisma.cctv_events.findMany({
      where,
      orderBy: { occurred_at: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
      include: { camera: { select: { id: true, name: true, lokasi: true } } }
    }),
    prisma.cctv_events.count({ where })
  ]);
  return { items: serialize(items), total, page, limit };
};

const detailPeristiwa = async (id) => {
  const item = await prisma.cctv_events.findUnique({
    where: { id: BigInt(id) },
    include: { camera: { select: { id: true, name: true, lokasi: true } } }
  });
  return item ? serialize(item) : null;
};

const pathSnapshot = (peristiwa) => {
  if (!peristiwa || !peristiwa.snapshot_path) return null;
  const absolut = path.join(AKAR, peristiwa.snapshot_path);
  // Jangan keluar dari direktori storage.
  if (!absolut.startsWith(path.join(AKAR, 'storage'))) return null;
  return fs.existsSync(absolut) ? absolut : null;
};

const ubahStatusPeristiwa = async (id, status, user) => {
  const peristiwa = await prisma.cctv_events.findUnique({ where: { id: BigInt(id) } });
  if (!peristiwa) return null;
  const diperbarui = await prisma.cctv_events.update({
    where: { id: peristiwa.id },
    data: {
      status,
      acknowledged_by: status === 'active' ? null : BigInt(user.id),
      acknowledged_at: status === 'active' ? null : new Date()
    },
    include: { camera: { select: { id: true, name: true, lokasi: true } } }
  });
  return serialize(diperbarui);
};

const akuiSemua = async (user) => {
  const { count } = await prisma.cctv_events.updateMany({
    where: { status: 'active' },
    data: {
      status: 'acknowledged',
      acknowledged_by: BigInt(user.id),
      acknowledged_at: new Date()
    }
  });
  return count;
};

// ───────────────────────────── Statistik ─────────────────────────────

const statistik = async () => {
  const batas = new Date();
  batas.setDate(batas.getDate() - 30);

  const [perStatus, perTipe, totalPeristiwa, aktif, kritis, terbaru] = await Promise.all([
    prisma.cctv_cameras.groupBy({ by: ['status'], _count: { _all: true } }),
    prisma.cctv_events.groupBy({
      by: ['type'],
      where: { occurred_at: { gte: batas } },
      _count: { _all: true }
    }),
    prisma.cctv_events.count({ where: { occurred_at: { gte: batas } } }),
    prisma.cctv_events.count({ where: { status: 'active' } }),
    prisma.cctv_events.count({ where: { severity: 'critical', status: 'active' } }),
    prisma.cctv_events.findMany({
      take: 6,
      orderBy: { occurred_at: 'desc' },
      include: { camera: { select: { id: true, name: true, lokasi: true } } }
    })
  ]);

  const kamera = { total: 0, active: 0, inactive: 0, maintenance: 0, offline: 0 };
  perStatus.forEach((r) => {
    kamera[r.status] = r._count._all;
    kamera.total += r._count._all;
  });

  const semua = await prisma.cctv_events.findMany({
    where: { occurred_at: { gte: batas } },
    select: { occurred_at: true, camera_id: true, camera: { select: { name: true, lokasi: true } } }
  });
  const harian = {};
  const perKamera = {};
  semua.forEach((e) => {
    const tgl = e.occurred_at.toISOString().slice(0, 10);
    harian[tgl] = (harian[tgl] || 0) + 1;
    const kunci = `${e.camera_id}|${e.camera ? e.camera.name : ''}`;
    perKamera[kunci] = perKamera[kunci] || {
      id: Number(e.camera_id),
      nama: e.camera ? e.camera.name : 'Kamera',
      lokasi: e.camera ? e.camera.lokasi : null,
      jumlah: 0
    };
    perKamera[kunci].jumlah += 1;
  });

  // rentang 30 hari penuh supaya sumbu grafik tidak melompat
  const grafik = [];
  for (let i = 30; i >= 1; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const tgl = d.toISOString().slice(0, 10);
    grafik.push({ tanggal: tgl, jumlah: harian[tgl] || 0 });
  }

  return {
    kamera,
    peristiwa: {
      total30Hari: totalPeristiwa,
      aktif,
      kritis,
      perTipe: perTipe.map((r) => ({ type: r.type, jumlah: r._count._all }))
    },
    grafik,
    topKamera: Object.values(perKamera)
      .sort((a, b) => b.jumlah - a.jumlah)
      .slice(0, 5),
    terbaru: serialize(terbaru)
  };
};

// ───────────────────────── Kamera: CRUD + go2rtc ─────────────────────────

const buatKamera = async (input, user) => {
  const { urlBersih, username, password } = pisahKredensial(input.rtsp_url, input.username, input.password);
  const kamera = await prisma.cctv_cameras.create({
    data: {
      name: String(input.name).trim(),
      lokasi: input.lokasi ? String(input.lokasi).trim() : null,
      rtsp_url: urlBersih,
      rtsp_url_main: input.rtsp_url_main ? String(input.rtsp_url_main).trim() : null,
      rtsp_url_sub: input.rtsp_url_sub ? String(input.rtsp_url_sub).trim() : null,
      username,
      password_enc: encrypt(password),
      desa_id: input.desa_id ? BigInt(input.desa_id) : null,
      kecamatan_id: input.kecamatan_id ? BigInt(input.kecamatan_id) : null,
      status: input.recognition_enabled === false ? 'inactive' : 'active',
      recognition_enabled: input.recognition_enabled !== false,
      fall_detection_enabled: input.fall_detection_enabled !== false,
      created_by: BigInt(user.id)
    }
  });

  // Daftarkan stream ke go2rtc + bangunkan thread AI (best-effort).
  const src = `dpmd_${kamera.id}`;
  await go2rtc.tambahStream(src, urlEfektif(kamera));
  const tersimpan = await prisma.cctv_cameras.update({
    where: { id: kamera.id },
    data: { go2rtc_src: src }
  });
  if (tersimpan.status === 'active') await kabariAIStart(Number(kamera.id));
  return serialize(tersimpan);
};

const ubahKamera = async (id, input, user) => {
  const lama = await cariKamera(id);
  if (!lama) return null;

  const data = {};
  if (input.name) data.name = String(input.name).trim();
  if (input.lokasi !== undefined) data.lokasi = input.lokasi ? String(input.lokasi).trim() : null;
  if (input.desa_id !== undefined) data.desa_id = input.desa_id ? BigInt(input.desa_id) : null;
  if (input.kecamatan_id !== undefined) data.kecamatan_id = input.kecamatan_id ? BigInt(input.kecamatan_id) : null;
  if (input.recognition_enabled !== undefined) data.recognition_enabled = !!input.recognition_enabled;
  if (input.fall_detection_enabled !== undefined) data.fall_detection_enabled = !!input.fall_detection_enabled;
  if (input.status && ['active', 'inactive', 'maintenance', 'offline'].includes(input.status)) {
    data.status = input.status;
  }

  let urlBerubah = false;
  if (input.rtsp_url) {
    const { urlBersih, username, password } = pisahKredensial(input.rtsp_url, input.username, input.password);
    data.rtsp_url = urlBersih;
    data.username = username;
    data.password_enc = encrypt(password);
    urlBerubah = true;
  } else if (input.password !== undefined && input.password !== null && input.password !== '') {
    data.password_enc = encrypt(input.password);
    urlBerubah = true;
  }

  const diperbarui = await prisma.cctv_cameras.update({
    where: { id: lama.id },
    data
  });

  if (urlBerubah || !diperbarui.go2rtc_src) {
    const src = diperbarui.go2rtc_src || `dpmd_${diperbarui.id}`;
    if (urlBerubah) await go2rtc.hapusStream(src);
    await go2rtc.tambahStream(src, urlEfektif(diperbarui));
    if (!diperbarui.go2rtc_src) {
      await prisma.cctv_cameras.update({ where: { id: diperbarui.id }, data: { go2rtc_src: src } });
    }
  }
  // Thread AI membaca ulang URL dari API saat restart — restartkan bila aktif.
  if (urlBerubah && diperbarui.status === 'active') {
    await kabariAIStop(Number(diperbarui.id));
    await kabariAIStart(Number(diperbarui.id));
  }
  return serialize(diperbarui);
};

const hapusKamera = async (id) => {
  const kamera = await cariKamera(id);
  if (!kamera) return false;
  if (kamera.go2rtc_src) await go2rtc.hapusStream(kamera.go2rtc_src);
  await kabariAIStop(Number(kamera.id));
  await prisma.cctv_cameras.delete({ where: { id: kamera.id } });
  return true;
};

const toggleKamera = async (id, aktif) => {
  const kamera = await cariKamera(id);
  if (!kamera) return null;
  const status = aktif ? 'active' : 'inactive';
  const diperbarui = await prisma.cctv_cameras.update({ where: { id: kamera.id }, data: { status } });
  if (aktif) await kabariAIStart(Number(kamera.id));
  else await kabariAIStop(Number(kamera.id));
  return serialize(diperbarui);
};

// ───────────────────────────── Playback DVR ─────────────────────────────

/**
 * Playback DVR Hikvision diproses layanan AI (ffmpeg → HLS).
 * Awalan "/ai" ditambahkan DI SINI (satu-satunya tempat) agar browser
 * same-origin lewat proxy. Frontend memakai stream_url apa adanya — JANGAN
 * menambah "/ai" lagi di sisi klien (menyebabkan /ai/ai/... → 404).
 */
const putarPlayback = async (body) => {
  try {
    const { data } = await axios.post(`${aiBase()}/api/v1/playback/session`, body, { timeout: 30000 });
    if (data && data.stream_url) data.stream_url = `/ai${data.stream_url}`;
    return { ok: true, data };
  } catch (err) {
    const pesan = err.response && err.response.data ? err.response.data : { message: err.message };
    return { ok: false, status: err.response ? err.response.status : 503, data: pesan };
  }
};

const seekPlayback = async (sid, body) => {
  try {
    const { data } = await axios.post(`${aiBase()}/api/v1/playback/session/${encodeURIComponent(sid)}/seek`, body, {
      timeout: 30000
    });
    if (data && data.stream_url) data.stream_url = `/ai${data.stream_url}`;
    return { ok: true, data };
  } catch (err) {
    const pesan = err.response && err.response.data ? err.response.data : { message: err.message };
    return { ok: false, status: err.response ? err.response.status : 503, data: pesan };
  }
};

const stopPlayback = async (sid) => {
  try {
    const { data } = await axios.post(`${aiBase()}/api/v1/playback/session/${encodeURIComponent(sid)}/stop`, {}, {
      timeout: 10000
    });
    return { ok: true, data };
  } catch (err) {
    const pesan = err.response && err.response.data ? err.response.data : { message: err.message };
    return { ok: false, status: err.response ? err.response.status : 503, data: pesan };
  }
};

const ketersediaanPlayback = async (cameraId, tanggalStr) => {
  try {
    const { data } = await axios.get(`${aiBase()}/api/v1/playback/availability`, {
      params: { camera_id: cameraId, date: tanggalStr },
      timeout: 15000
    });
    return { ok: true, data };
  } catch (err) {
    const pesan = err.response && err.response.data ? err.response.data : { message: err.message };
    return { ok: false, status: err.response ? err.response.status : 503, data: pesan };
  }
};

// ───────────────────────────── Wajah (enrollment) ─────────────────────────────

const simpanFotoWajah = (buffer) => {
  fs.mkdirSync(DIR_FOTO, { recursive: true });
  const nama = `${Date.now()}_${crypto.randomBytes(4).toString('hex')}.jpg`;
  fs.writeFileSync(path.join(DIR_FOTO, nama), buffer);
  return `storage/uploads/cctv/faces/${nama}`.replace(/\\/g, '/');
};

/** Mintakan embedding ke layanan AI (POST /extract-embedding). */
const ekstrakEmbedding = async (buffer) => {
  const hasil = await panggilAI(
    '/extract-embedding',
    { image_base64: buffer.toString('base64') },
    30000
  );
  if (!hasil.ok) return null;
  const d = hasil.data;
  if (Array.isArray(d)) return d;
  if (Array.isArray(d.embedding)) return d.embedding;
  if (Array.isArray(d.embeddings) && d.embeddings.length) return d.embeddings[0];
  if (Array.isArray(d.features)) return d.features;
  return null;
};

const daftarWajah = async () => {
  const wajah = await prisma.cctv_faces.findMany({
    orderBy: { nama: 'asc' },
    include: { _count: { select: { embeddings: true, events: true } } }
  });
  return serialize(wajah);
};

const buatWajah = async (input, fotoBuffer) => {
  const wajah = await prisma.cctv_faces.create({
    data: {
      nama: String(input.nama).trim(),
      kode_pegawai: input.kode_pegawai ? String(input.kode_pegawai).trim() : null,
      departemen: input.departemen ? String(input.departemen).trim() : null,
      created_by: input.user_id ? BigInt(input.user_id) : null
    }
  });

  if (fotoBuffer && fotoBuffer.length) {
    const fotoPath = simpanFotoWajah(fotoBuffer);
    const embedding = await ekstrakEmbedding(fotoBuffer);
    if (embedding) {
      await prisma.cctv_face_embeddings.create({
        data: { face_id: wajah.id, image_path: fotoPath, embedding }
      });
    }
    await prisma.cctv_faces.update({ where: { id: wajah.id }, data: { foto_path: fotoPath } });
  }
  return serialize(await prisma.cctv_faces.findUnique({
    where: { id: wajah.id },
    include: { _count: { select: { embeddings: true, events: true } } }
  }));
};

const tambahFotoWajah = async (faceId, fotoBuffer) => {
  const wajah = await prisma.cctv_faces.findUnique({ where: { id: BigInt(faceId) } });
  if (!wajah) return null;
  const fotoPath = simpanFotoWajah(fotoBuffer);
  const embedding = await ekstrakEmbedding(fotoBuffer);
  if (!embedding) return { error: 'Layanan AI tidak dapat mengekstrak embedding dari foto tersebut' };
  await prisma.cctv_face_embeddings.create({
    data: { face_id: wajah.id, image_path: fotoPath, embedding }
  });
  return { ok: true };
};

const ubahWajah = async (faceId, input) => {
  const wajah = await prisma.cctv_faces.findUnique({ where: { id: BigInt(faceId) } });
  if (!wajah) return null;
  const data = {};
  if (input.nama) data.nama = String(input.nama).trim();
  if (input.kode_pegawai !== undefined) data.kode_pegawai = input.kode_pegawai || null;
  if (input.departemen !== undefined) data.departemen = input.departemen || null;
  return serialize(await prisma.cctv_faces.update({ where: { id: wajah.id }, data }));
};

const hapusWajah = async (faceId) => {
  const wajah = await prisma.cctv_faces.findUnique({ where: { id: BigInt(faceId) } });
  if (!wajah) return false;
  await prisma.cctv_faces.delete({ where: { id: wajah.id } });
  return true;
};

/** Hitung ulang seluruh embedding satu wajah dari fotonya lewat layanan AI. */
const recomputeWajah = async (faceId) => {
  const wajah = await prisma.cctv_faces.findUnique({
    where: { id: BigInt(faceId) },
    include: { embeddings: true }
  });
  if (!wajah) return null;
  let berhasil = 0;
  for (const e of wajah.embeddings) {
    const absolut = path.join(AKAR, e.image_path);
    if (!fs.existsSync(absolut)) continue;
    const embedding = await ekstrakEmbedding(fs.readFileSync(absolut));
    if (embedding) {
      await prisma.cctv_face_embeddings.update({ where: { id: e.id }, data: { embedding } });
      berhasil += 1;
    }
  }
  return { total: wajah.embeddings.length, berhasil };
};

module.exports = {
  STAFF_ROLES,
  serialize,
  pisahKredensial,
  urlEfektif,
  daftarKamera,
  cariKamera,
  daftarKameraLayanan,
  kameraDetailLayanan,
  daftarEmbeddingLayanan,
  simpanEmbeddingDariAI,
  testKoneksi,
  simpanRecognitionEvent,
  simpanEmergencyEvent,
  simpanDetectionLog,
  daftarPeristiwa,
  detailPeristiwa,
  pathSnapshot,
  ubahStatusPeristiwa,
  akuiSemua,
  statistik,
  buatKamera,
  ubahKamera,
  hapusKamera,
  toggleKamera,
  putarPlayback,
  seekPlayback,
  stopPlayback,
  ketersediaanPlayback,
  daftarWajah,
  buatWajah,
  tambahFotoWajah,
  ubahWajah,
  hapusWajah,
  recomputeWajah
};
