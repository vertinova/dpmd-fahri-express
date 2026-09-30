/**
 * Peringatan Manajemen Server.
 *
 * Peringatan "aktif" hidup selama kondisinya masih terjadi (CPU tinggi, disk
 * hampir penuh, layanan mati, ada serangan) dan hilang sendiri ketika pulih.
 * Setiap peringatan yang baru muncul ikut dicatat di riwayat dan — bila
 * diaktifkan — dikirim sebagai push notification ke semua superadmin.
 */

const logger = require('../utils/logger');
const store = require('./serverStore.service');

const aktif = new Map(); // key → { key, level, title, message, since, value }
const riwayat = []; // 200 terakhir
const terakhirDikirim = new Map(); // key → ms, supaya push tidak membanjir
const JEDA_PUSH_MS = 30 * 60 * 1000;

// Kondisi metrik harus bertahan beberapa sampel sebelum jadi peringatan,
// supaya lonjakan sesaat (mis. saat backup berjalan) tidak memicu alarm.
const hitunganBeruntun = new Map();
const SAMPEL_BERUNTUN = 3;

const kirimPush = async (peringatan) => {
  const cfg = store.getConfigSync();
  if (!cfg.alerts.push_notification) return;
  const terakhir = terakhirDikirim.get(peringatan.key) || 0;
  if (Date.now() - terakhir < JEDA_PUSH_MS) return;
  terakhirDikirim.set(peringatan.key, Date.now());
  try {
    const push = require('./pushNotification.service');
    await push.sendToRoles(['superadmin'], {
      title: `${peringatan.level === 'critical' ? '🚨' : '⚠️'} Server: ${peringatan.title}`,
      body: peringatan.message,
      data: { type: 'server_alert', url: '/superadmin/server' },
    });
  } catch (error) {
    logger.warn(`[ServerAlerts] Push gagal: ${error.message}`);
  }
};

const raise = (key, { level = 'warning', title, message, value = null, kategori = 'sistem' }) => {
  const ada = aktif.get(key);
  if (ada) {
    ada.message = message;
    ada.value = value;
    ada.level = level;
    return ada;
  }
  const baru = { key, level, title, message, value, kategori, since: new Date() };
  aktif.set(key, baru);
  riwayat.unshift({ ...baru, status: 'muncul', at: new Date() });
  if (riwayat.length > 200) riwayat.pop();
  logger.warn(`[ServerAlerts] ${level.toUpperCase()} ${title}: ${message}`);
  kirimPush(baru);
  return baru;
};

const clear = (key) => {
  const ada = aktif.get(key);
  if (!ada) return;
  aktif.delete(key);
  riwayat.unshift({ ...ada, status: 'pulih', at: new Date() });
  if (riwayat.length > 200) riwayat.pop();
};

const periksa = (key, kondisi, detail) => {
  if (kondisi) {
    const n = (hitunganBeruntun.get(key) || 0) + 1;
    hitunganBeruntun.set(key, n);
    if (n >= SAMPEL_BERUNTUN) raise(key, detail);
  } else {
    hitunganBeruntun.set(key, 0);
    clear(key);
  }
};

const evaluasiMetrik = (m) => {
  const a = store.getConfigSync().alerts;
  periksa('cpu', m.cpu >= a.cpu_percent, {
    level: m.cpu >= 97 ? 'critical' : 'warning',
    title: 'CPU tinggi',
    message: `Pemakaian CPU ${m.cpu}% (ambang ${a.cpu_percent}%). Aplikasi bisa terasa lambat.`,
    value: m.cpu,
  });
  periksa('memory', m.memory.percent >= a.memory_percent, {
    level: m.memory.percent >= 97 ? 'critical' : 'warning',
    title: 'RAM hampir penuh',
    message: `Pemakaian RAM ${m.memory.percent}% (ambang ${a.memory_percent}%). Risiko proses dimatikan sistem (OOM).`,
    value: m.memory.percent,
  });
  if (m.disk) {
    periksa('disk', m.disk.percent >= a.disk_percent, {
      level: m.disk.percent >= 95 ? 'critical' : 'warning',
      title: 'Disk hampir penuh',
      message: `Disk terpakai ${m.disk.percent}% (ambang ${a.disk_percent}%). Unggahan & database bisa gagal bila penuh.`,
      value: m.disk.percent,
    });
  }
  periksa('event_loop', m.event_loop.p99 >= a.event_loop_ms, {
    level: 'warning',
    title: 'Aplikasi tersendat',
    message: `Event loop Node tertahan ${m.event_loop.p99} ms (ambang ${a.event_loop_ms} ms). Ada proses berat yang memblokir.`,
    value: m.event_loop.p99,
  });
  const total = m.requests.count;
  const rasio = total >= 20 ? (m.requests.errors / total) * 100 : 0;
  periksa('error_rate', rasio >= a.error_rate_percent, {
    level: rasio >= 25 ? 'critical' : 'warning',
    title: 'Banyak error server',
    message: `${Math.round(rasio)}% request berakhir error 5xx dalam 10 detik terakhir.`,
    value: Math.round(rasio),
  });
};

module.exports = {
  raise,
  clear,
  evaluasiMetrik,
  getActive: () => {
    const urutan = { critical: 0, warning: 1, info: 2 };
    return [...aktif.values()].sort((x, y) => (urutan[x.level] ?? 3) - (urutan[y.level] ?? 3));
  },
  getHistory: () => riwayat,
};
