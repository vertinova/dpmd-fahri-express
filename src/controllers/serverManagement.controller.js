/**
 * Manajemen Server — superadmin.
 *
 * Satu halaman untuk memantau seluruh isi server: kondisi mesin, aplikasi
 * PM2, layanan sistem, database, storage & kuota, trafik, serangan, dan log.
 * Logika pengambilan data ada di src/services/server*.service.js; controller
 * ini hanya menyusun respons, memvalidasi masukan, dan mencatat jejak audit.
 */

const net = require('net');
const logger = require('../utils/logger');
const ActivityLogger = require('../utils/activityLogger');
const store = require('../services/serverStore.service');
const metrics = require('../services/serverMetrics.service');
const alerts = require('../services/serverAlerts.service');
const security = require('../services/serverSecurity.service');
const storage = require('../services/serverStorage.service');
const apps = require('../services/serverApps.service');
const { LOG_FILES, SYSTEM_LOGS, CLEANUP_TARGETS, DEFAULT_CONFIG } = require('../config/serverManagement');

const LOG_MODULE = 'manajemen_server';

const gagal = (res, error, status = 500) => {
  if (status >= 500) logger.error(`[ServerManagement] ${error.message}`);
  return res.status(status).json({ success: false, message: error.message || String(error) });
};

const audit = (req, action, entityName, description, newValue = null) => {
  ActivityLogger.log({
    userId: BigInt(String(req.user.id)),
    userName: req.user.name,
    userRole: req.user.role,
    module: LOG_MODULE,
    action,
    entityType: 'server',
    entityName,
    description,
    newValue,
    ipAddress: ActivityLogger.getIpFromRequest(req),
    userAgent: ActivityLogger.getUserAgentFromRequest(req),
  }).catch(() => {});
};

const denganBatas = (promise, ms, cadangan) =>
  Promise.race([promise.catch(() => cadangan), new Promise((r) => setTimeout(() => r(cadangan), ms))]);

/* ─────────────────────────── Ringkasan ─────────────────────────── */

exports.overview = async (req, res) => {
  try {
    const latest = metrics.getLatest();
    const [hist, pm2, dbInfo] = await Promise.all([
      metrics.getHistory('1h'),
      denganBatas(apps.getPm2(), 4000, { available: false, processes: [] }),
      denganBatas(apps.getDatabase().then((d) => ({ connected: d.connected, latency_ms: d.latency_ms, size: d.size, connections: d.connections, version: d.version })), 4000, { connected: null }),
    ]);
    const traffic = metrics.getTraffic();
    const kuota = storage.statusKuota();
    const monitors = apps.getMonitorStatus();

    res.json({
      success: true,
      data: {
        server_time: new Date(),
        system: metrics.getSystemInfo(),
        latest,
        history: hist.points.slice(-90),
        alerts: alerts.getActive(),
        alert_history: alerts.getHistory().slice(0, 30),
        apps: {
          pm2_available: pm2.available,
          total: pm2.processes.length,
          online: pm2.processes.filter((p) => p.status === 'online').length,
          processes: pm2.processes.map((p) => ({ name: p.name, status: p.status, cpu: p.cpu, memory: p.memory, restarts: p.restarts, is_self: p.is_self })),
        },
        monitors: monitors.map((m) => ({ name: m.name, url: m.url, up: m.last?.up ?? null, ms: m.last?.ms ?? null, uptime_percent: m.uptime_percent, ssl_days_left: m.ssl?.days_left ?? null })),
        database: dbInfo,
        traffic: { total: traffic.total, rpm: traffic.rpm, p95: traffic.p95, status: traffic.status, since: traffic.since },
        storage_quota: kuota,
      },
    });
  } catch (error) {
    gagal(res, error);
  }
};

exports.history = async (req, res) => {
  try {
    res.json({ success: true, data: await metrics.getHistory(String(req.query.range || '1h')) });
  } catch (error) {
    gagal(res, error);
  }
};

exports.alerts = (req, res) => {
  res.json({ success: true, data: { active: alerts.getActive(), history: alerts.getHistory() } });
};

/* ─────────────────────────── Aplikasi ─────────────────────────── */

exports.apps = async (req, res) => {
  try {
    const [pm2, services, ports] = await Promise.all([apps.getPm2(), apps.getServices(), apps.getPorts()]);
    res.json({ success: true, data: { pm2, services, ports, monitors: apps.getMonitorStatus() } });
  } catch (error) {
    gagal(res, error);
  }
};

exports.pm2Action = async (req, res) => {
  const { name, action } = req.params;
  try {
    const hasil = await apps.pm2Action(name, action);
    audit(req, 'update', name, `PM2 ${action} "${name}" dari Manajemen Server`);
    res.json({ success: true, ...hasil });
  } catch (error) {
    gagal(res, error, 400);
  }
};

exports.pm2Logs = async (req, res) => {
  try {
    const lines = Math.min(1000, Number(req.query.lines) || 200);
    res.json({ success: true, data: await apps.pm2Logs(req.params.name, lines) });
  } catch (error) {
    gagal(res, error, 400);
  }
};

exports.checkMonitors = async (req, res) => {
  try {
    await apps.jalankanMonitor();
    res.json({ success: true, data: apps.getMonitorStatus() });
  } catch (error) {
    gagal(res, error);
  }
};

exports.saveMonitors = async (req, res) => {
  try {
    const masukan = Array.isArray(req.body?.monitors) ? req.body.monitors : null;
    if (!masukan) return gagal(res, new Error('Daftar monitor tidak valid'), 400);
    if (masukan.length > 30) return gagal(res, new Error('Maksimal 30 monitor'), 400);
    const bersih = [];
    for (const m of masukan) {
      const nama = String(m?.name || '').trim().slice(0, 80);
      const url = String(m?.url || '').trim();
      let u;
      try { u = new URL(url); } catch { return gagal(res, new Error(`URL tidak valid: ${url}`), 400); }
      if (!['http:', 'https:'].includes(u.protocol)) return gagal(res, new Error('Hanya URL http/https'), 400);
      bersih.push({ name: nama || u.hostname, url: u.toString() });
    }
    await store.saveConfig({ monitors: bersih }, req.user.id);
    audit(req, 'update', 'monitor', `Memperbarui ${bersih.length} monitor uptime`, bersih);
    apps.jalankanMonitor().catch(() => {});
    res.json({ success: true, data: bersih, message: 'Monitor disimpan' });
  } catch (error) {
    gagal(res, error);
  }
};

/* ─────────────────────────── Database ─────────────────────────── */

exports.database = async (req, res) => {
  try {
    res.json({ success: true, data: await apps.getDatabase() });
  } catch (error) {
    gagal(res, error);
  }
};

/* ─────────────────────────── Storage ─────────────────────────── */

exports.storage = async (req, res) => {
  try {
    const segar = req.query.refresh === '1';
    res.json({ success: true, data: await storage.getStorage({ segar }) });
  } catch (error) {
    gagal(res, error);
  }
};

exports.cleanupPreview = async (req, res) => {
  try {
    res.json({ success: true, data: await storage.previewCleanup() });
  } catch (error) {
    gagal(res, error);
  }
};

exports.cleanup = async (req, res) => {
  try {
    const target = String(req.body?.target || '');
    if (!CLEANUP_TARGETS[target]) return gagal(res, new Error('Target pembersihan tidak dikenal'), 400);
    const hasil = await storage.cleanup(target);
    audit(req, 'delete', target, `Membersihkan ${hasil.label}: ${hasil.files} berkas, ${Math.round(hasil.freed / 1048576)} MB`);
    res.json({ success: true, data: hasil });
  } catch (error) {
    gagal(res, error);
  }
};

/* ─────────────────────────── Keamanan ─────────────────────────── */

exports.securitySummary = async (req, res) => {
  try {
    res.json({ success: true, data: await security.getSummary(String(req.query.range || '24h')) });
  } catch (error) {
    gagal(res, error);
  }
};

exports.securityEvents = async (req, res) => {
  try {
    const { page, limit, type, severity, ip, source, q, range } = req.query;
    res.json({ success: true, ...(await security.listEvents({ page, limit, type, severity, ip, source, q, range })) });
  } catch (error) {
    gagal(res, error);
  }
};

exports.clearEvents = async (req, res) => {
  try {
    await security.hapusSemuaKejadian();
    audit(req, 'delete', 'security_events', 'Menghapus seluruh jejak kejadian keamanan');
    res.json({ success: true, message: 'Jejak kejadian keamanan dihapus' });
  } catch (error) {
    gagal(res, error);
  }
};

exports.blocklist = async (req, res) => {
  try {
    res.json({ success: true, data: await security.listBlocklist() });
  } catch (error) {
    gagal(res, error);
  }
};

exports.blockIp = async (req, res) => {
  try {
    const ip = security.bersihkanIp(req.body?.ip);
    if (!net.isIP(ip)) return gagal(res, new Error('Alamat IP tidak valid'), 400);
    if (ip === security.bersihkanIp(req.ip)) {
      return gagal(res, new Error('Tidak bisa memblokir IP Anda sendiri — Anda akan terkunci dari aplikasi.'), 400);
    }
    if (security.diWhitelist(ip)) return gagal(res, new Error('IP ini ada di whitelist. Hapus dari whitelist dulu.'), 400);
    const menit = req.body?.minutes ? Math.max(1, Math.min(525600, Number(req.body.minutes))) : null;
    const alasan = String(req.body?.reason || 'Diblokir manual oleh superadmin').slice(0, 500);
    const hasil = await security.blockIp({ ip, reason: alasan, minutes: menit, by: req.user.name || req.user.email });
    audit(req, 'create', ip, `Memblokir IP ${ip}${menit ? ` selama ${menit} menit` : ' permanen'}: ${alasan}`);
    res.json({ success: true, data: hasil, message: `IP ${ip} diblokir` });
  } catch (error) {
    gagal(res, error);
  }
};

exports.unblockIp = async (req, res) => {
  try {
    const ip = security.bersihkanIp(req.params.ip);
    await security.unblockIp(ip);
    audit(req, 'delete', ip, `Membuka blokir IP ${ip}`);
    res.json({ success: true, message: `Blokir IP ${ip} dibuka` });
  } catch (error) {
    gagal(res, error);
  }
};

/* ─────────────────────────── Trafik ─────────────────────────── */

exports.traffic = (req, res) => {
  res.json({ success: true, data: metrics.getTraffic() });
};

exports.resetTraffic = (req, res) => {
  metrics.resetTraffic();
  audit(req, 'update', 'traffic', 'Mereset statistik trafik');
  res.json({ success: true, message: 'Statistik trafik direset' });
};

/* ─────────────────────────── Log ─────────────────────────── */

const SUMBER_LOG = {
  error: { label: 'Error aplikasi', path: LOG_FILES.error },
  combined: { label: 'Semua log aplikasi', path: LOG_FILES.combined },
  deploy: { label: 'Riwayat deploy (webhook)', path: '/var/www/webhook/webhook.log' },
  nginx_error: { label: 'Error nginx', path: SYSTEM_LOGS.nginx_error },
  nginx_access: { label: 'Akses nginx', path: SYSTEM_LOGS.nginx_access },
  auth: { label: 'Auth/SSH sistem', path: SYSTEM_LOGS.auth },
};

exports.logSources = (req, res) => {
  res.json({ success: true, data: Object.entries(SUMBER_LOG).map(([key, v]) => ({ key, label: v.label })) });
};

exports.logs = async (req, res) => {
  try {
    const sumber = String(req.query.source || 'error');
    const lines = Math.min(2000, Math.max(20, Number(req.query.lines) || 300));
    const q = String(req.query.q || '').toLowerCase();
    const level = String(req.query.level || '');
    const def = SUMBER_LOG[sumber];
    if (!def) return gagal(res, new Error('Sumber log tidak dikenal'), 400);

    // Ambil lebih banyak saat menyaring supaya hasil saringan tetap berisi.
    const hasil = await apps.ekor(def.path, q || level ? lines * 5 : lines);
    let baris = hasil.lines.map((teks) => {
      try {
        const j = JSON.parse(teks);
        return { raw: teks, level: j.level || null, time: j.timestamp || null, message: typeof j.message === 'string' ? j.message : JSON.stringify(j.message) };
      } catch {
        const lv = /\berror\b|\bERR\b|\bfail/i.test(teks) ? 'error' : /\bwarn/i.test(teks) ? 'warn' : null;
        return { raw: teks, level: lv, time: null, message: teks };
      }
    });
    if (level) baris = baris.filter((b) => b.level === level);
    if (q) baris = baris.filter((b) => b.raw.toLowerCase().includes(q));
    res.json({
      success: true,
      data: { source: sumber, label: def.label, path: def.path, size: hasil.size, modified: hasil.modified, error: hasil.error || null, lines: baris.slice(-lines) },
    });
  } catch (error) {
    gagal(res, error);
  }
};

/* ─────────────────────────── Pengaturan ─────────────────────────── */

const angka = (v, min, max, cadangan) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return cadangan;
  return Math.min(max, Math.max(min, n));
};

exports.getConfig = async (req, res) => {
  try {
    res.json({ success: true, data: { config: await store.getConfig({ segar: true }), defaults: DEFAULT_CONFIG, your_ip: security.bersihkanIp(req.ip) } });
  } catch (error) {
    gagal(res, error);
  }
};

exports.saveConfig = async (req, res) => {
  try {
    const m = req.body || {};
    const kini = await store.getConfig({ segar: true });
    const d = DEFAULT_CONFIG;
    const baru = {
      alerts: {
        cpu_percent: angka(m.alerts?.cpu_percent, 10, 100, kini.alerts.cpu_percent),
        memory_percent: angka(m.alerts?.memory_percent, 10, 100, kini.alerts.memory_percent),
        disk_percent: angka(m.alerts?.disk_percent, 10, 100, kini.alerts.disk_percent),
        event_loop_ms: angka(m.alerts?.event_loop_ms, 20, 10000, kini.alerts.event_loop_ms),
        error_rate_percent: angka(m.alerts?.error_rate_percent, 1, 100, kini.alerts.error_rate_percent),
        push_notification: m.alerts?.push_notification ?? kini.alerts.push_notification,
      },
      storage: {
        quota_gb: angka(m.storage?.quota_gb, 0, 100000, kini.storage.quota_gb),
        warn_percent: angka(m.storage?.warn_percent, 10, 100, kini.storage.warn_percent),
        enforce: m.storage?.enforce ?? kini.storage.enforce,
        max_upload_mb: angka(m.storage?.max_upload_mb, 0, 10000, kini.storage.max_upload_mb),
        temp_max_age_hours: angka(m.storage?.temp_max_age_hours, 1, 8760, kini.storage.temp_max_age_hours),
      },
      security: {
        detection: m.security?.detection ?? kini.security.detection,
        waf_mode: m.security?.waf_mode ?? kini.security.waf_mode,
        auto_block: m.security?.auto_block ?? kini.security.auto_block,
        auto_block_score: angka(m.security?.auto_block_score, 5, 1000, kini.security.auto_block_score),
        auto_block_window_minutes: angka(m.security?.auto_block_window_minutes, 1, 1440, kini.security.auto_block_window_minutes),
        auto_block_duration_minutes: angka(m.security?.auto_block_duration_minutes, 1, 525600, kini.security.auto_block_duration_minutes),
        retention_days: angka(m.security?.retention_days, 1, 365, kini.security.retention_days),
        scan_system_logs: m.security?.scan_system_logs ?? kini.security.scan_system_logs,
        whitelist: Array.isArray(m.security?.whitelist)
          ? [...new Set(m.security.whitelist.map((w) => String(w).trim()).filter(Boolean))].slice(0, 200)
          : kini.security.whitelist || d.security.whitelist,
      },
    };
    for (const grup of ['alerts', 'storage', 'security']) {
      for (const [k, v] of Object.entries(baru[grup])) {
        if (typeof d[grup][k] === 'boolean') baru[grup][k] = v === true || v === 'true';
      }
    }
    const tersimpan = await store.saveConfig(baru, req.user.id);
    storage.periksaKuota();
    audit(req, 'update', 'konfigurasi', 'Memperbarui pengaturan Manajemen Server', baru);
    res.json({ success: true, data: tersimpan, message: 'Pengaturan disimpan' });
  } catch (error) {
    gagal(res, error);
  }
};

/* ─────────────────────── Proxmox (semua aplikasi) ─────────────────────── */

const proxmox = require('../services/serverProxmox.service');

const gagalPve = (res, error) => gagal(res, error, error.status && error.status < 500 ? error.status : error.status === 503 ? 503 : 502);

exports.pveStatus = async (req, res) => {
  const info = proxmox.getConfigInfo();
  if (!info.configured) return res.json({ success: true, data: { ...info, connected: false } });
  try {
    const versi = await proxmox.testConnection();
    res.json({ success: true, data: { ...info, connected: true, ...versi } });
  } catch (error) {
    res.json({ success: true, data: { ...info, connected: false, error: error.message } });
  }
};

exports.pveOverview = async (req, res) => {
  try {
    res.json({ success: true, data: await proxmox.getOverview() });
  } catch (error) {
    gagalPve(res, error);
  }
};

exports.pveGuest = async (req, res) => {
  try {
    res.json({ success: true, data: await proxmox.getGuest(req.params.vmid) });
  } catch (error) {
    gagalPve(res, error);
  }
};

exports.pveRrd = async (req, res) => {
  try {
    res.json({ success: true, data: await proxmox.getRrd(req.params.vmid, String(req.query.timeframe || 'hour')) });
  } catch (error) {
    gagalPve(res, error);
  }
};

exports.pveTasks = async (req, res) => {
  try {
    res.json({ success: true, data: await proxmox.getTasks() });
  } catch (error) {
    gagalPve(res, error);
  }
};

/**
 * Aksi berisiko (mematikan, reboot, menambah disk) wajib menyertakan nama
 * aplikasi yang diketik ulang superadmin — mencegah salah klik pada baris
 * yang bersebelahan, misalnya mematikan Gate alih-alih aplikasi uji.
 */
const cekKonfirmasi = async (req) => {
  const detail = await proxmox.getGuest(req.params.vmid);
  if (String(req.body?.confirm_name || '').trim() !== String(detail.name)) {
    throw Object.assign(new Error(`Ketik nama aplikasi "${detail.name}" untuk konfirmasi.`), { status: 400 });
  }
  return detail;
};

exports.pvePower = async (req, res) => {
  try {
    const aksi = req.params.action;
    if (aksi !== 'start') await cekKonfirmasi(req);
    const hasil = await proxmox.powerAction(req.params.vmid, aksi);
    audit(req, 'update', hasil.guest.name, `Proxmox ${aksi} ${hasil.guest.type} ${hasil.guest.vmid} (${hasil.guest.name})`);
    res.json({ success: true, message: `Perintah ${aksi} dikirim ke ${hasil.guest.name}.`, data: { upid: hasil.upid } });
  } catch (error) {
    gagalPve(res, error);
  }
};

exports.pveResize = async (req, res) => {
  try {
    await cekKonfirmasi(req);
    const hasil = await proxmox.resizeDisk(req.params.vmid, String(req.body?.disk || ''), req.body?.add_gb);
    audit(req, 'update', hasil.guest.name, `Menambah disk ${hasil.disk} ${hasil.guest.name} sebesar ${hasil.added_gb} GB (sebelumnya ${hasil.old_size})`);
    res.json({ success: true, message: `Disk ${hasil.disk} ${hasil.guest.name} ditambah ${hasil.added_gb} GB.`, data: hasil });
  } catch (error) {
    gagalPve(res, error);
  }
};

exports.pveResources = async (req, res) => {
  try {
    await cekKonfirmasi(req);
    const { memory_mb, swap_mb, cores } = req.body || {};
    const hasil = await proxmox.updateResources(req.params.vmid, { memory_mb, swap_mb, cores });
    audit(req, 'update', hasil.guest.name, `Mengubah sumber daya ${hasil.guest.name}: ${JSON.stringify(hasil.changes)}`, hasil.changes);
    res.json({
      success: true,
      message: `Sumber daya ${hasil.guest.name} diperbarui.${hasil.needs_reboot ? ' VM perlu di-reboot agar sebagian perubahan berlaku.' : ''}`,
      data: hasil,
    });
  } catch (error) {
    gagalPve(res, error);
  }
};
