/**
 * Aplikasi & layanan di server: proses PM2, unit systemd, port yang terbuka,
 * monitor uptime (HTTP + sertifikat SSL), dan kondisi database MySQL.
 *
 * Semua perintah sistem dijalankan lewat execFile (tanpa shell) dengan batas
 * waktu, dan setiap kegagalan dikembalikan sebagai "tidak tersedia" — di
 * Windows/Laragon sebagian besar memang tidak ada, dan halaman tetap harus
 * bisa dibuka.
 */

const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const tls = require('tls');
const logger = require('../utils/logger');
const prisma = require('../config/prisma');
const store = require('./serverStore.service');
const alerts = require('./serverAlerts.service');
const { SYSTEM_SERVICES } = require('../config/serverManagement');

const IS_LINUX = process.platform === 'linux';

const jalankan = (cmd, args, { timeout = 8000 } = {}) => new Promise((resolve) => {
  execFile(cmd, args, { timeout, maxBuffer: 20 * 1024 * 1024, windowsHide: true, env: { ...process.env, PATH: `${path.dirname(process.execPath)}${path.delimiter}${process.env.PATH || ''}` } }, (err, stdout, stderr) => {
    resolve({ ok: !err, stdout: String(stdout || ''), stderr: String(stderr || ''), error: err ? err.message : null });
  });
});

/* ─────────────────────────── PM2 ─────────────────────────── */

const kandidatPm2 = () => {
  const daftar = [path.join(path.dirname(process.execPath), process.platform === 'win32' ? 'pm2.cmd' : 'pm2')];
  if (IS_LINUX) daftar.push('/usr/local/bin/pm2', '/usr/bin/pm2');
  daftar.push('pm2');
  return daftar;
};

let pm2Bin = null;
const cariPm2 = async () => {
  if (pm2Bin) return pm2Bin;
  for (const k of kandidatPm2()) {
    if (k.includes(path.sep) && !fs.existsSync(k)) continue;
    const r = await jalankan(k, ['--version'], { timeout: 5000 });
    if (r.ok) { pm2Bin = k; return k; }
  }
  return null;
};

const getPm2 = async () => {
  const bin = await cariPm2();
  if (!bin) return { available: false, processes: [], note: 'PM2 tidak ditemukan di server ini (normal di lingkungan lokal).' };
  const r = await jalankan(bin, ['jlist'], { timeout: 10000 });
  if (!r.ok) return { available: false, processes: [], note: r.error };
  const awal = r.stdout.indexOf('[');
  let daftar = [];
  try { daftar = JSON.parse(r.stdout.slice(awal)); } catch { return { available: false, processes: [], note: 'Output PM2 tidak terbaca' }; }
  const proses = daftar.map((p) => {
    const env = p.pm2_env || {};
    const axm = env.axm_monitor || {};
    return {
      id: p.pm_id,
      name: p.name,
      pid: p.pid,
      status: env.status,
      cpu: p.monit?.cpu ?? 0,
      memory: p.monit?.memory ?? 0,
      uptime_since: env.pm_uptime || null,
      restarts: env.restart_time || 0,
      unstable_restarts: env.unstable_restarts || 0,
      exec_mode: env.exec_mode,
      instances: env.instances,
      node_version: env.node_version,
      version: env.version,
      script: env.pm_exec_path,
      cwd: env.pm_cwd,
      max_memory_restart: env.max_memory_restart || null,
      heap_used: axm['Used Heap Size']?.value ?? null,
      heap_percent: axm['Heap Usage']?.value ?? null,
      event_loop_p95: axm['P95 Event Loop Latency']?.value ?? null,
      is_self: p.pid === process.pid,
    };
  });
  for (const p of proses) {
    const key = `pm2:${p.name}`;
    if (p.status !== 'online') {
      alerts.raise(key, { level: 'critical', kategori: 'aplikasi', title: `Aplikasi ${p.name} ${p.status}`, message: `Proses PM2 "${p.name}" berstatus ${p.status}.` });
    } else {
      alerts.clear(key);
    }
  }
  return { available: true, version: (await jalankan(bin, ['--version'])).stdout.trim(), processes: proses };
};

const AKSI_PM2 = ['restart', 'reload', 'stop', 'start'];

const pm2Action = async (nama, aksi) => {
  if (!AKSI_PM2.includes(aksi)) throw new Error('Aksi tidak dikenal');
  if (!/^[\w.-]{1,100}$/.test(nama)) throw new Error('Nama proses tidak valid');
  const bin = await cariPm2();
  if (!bin) throw new Error('PM2 tidak tersedia di server ini');
  const { processes } = await getPm2();
  const target = processes.find((p) => p.name === nama);
  if (!target) throw new Error(`Proses "${nama}" tidak ditemukan`);
  if (target.is_self && aksi === 'stop') {
    throw new Error('Backend ini tidak boleh dihentikan dari dalam dirinya sendiri — halaman ini akan ikut mati dan tidak bisa menyalakannya lagi.');
  }
  if (target.is_self) {
    // Balas dulu ke peramban, baru restart diri sendiri.
    setTimeout(() => { execFile(bin, [aksi, nama], { windowsHide: true }, () => {}); }, 1500).unref();
    return { scheduled: true, message: `Backend akan di-${aksi} dalam 1–2 detik. Halaman akan tersambung kembali otomatis.` };
  }
  const r = await jalankan(bin, [aksi, nama], { timeout: 30000 });
  if (!r.ok) throw new Error(r.stderr || r.error);
  return { scheduled: false, message: `Proses ${nama} berhasil di-${aksi}.` };
};

const pm2Logs = async (nama, baris = 150) => {
  const { processes } = await getPm2();
  const target = processes.find((p) => p.name === nama);
  if (!target) throw new Error('Proses tidak ditemukan');
  const home = process.env.PM2_HOME || path.join(process.env.HOME || '/root', '.pm2');
  const hasil = {};
  for (const jenis of ['out', 'error']) {
    const berkas = path.join(home, 'logs', `${nama}-${jenis}.log`);
    hasil[jenis] = await ekor(berkas, baris);
  }
  return hasil;
};

/** Ambil N baris terakhir berkas tanpa membaca seluruhnya. */
const ekor = async (berkas, baris = 200) => {
  try {
    const st = await fs.promises.stat(berkas);
    const panjang = Math.min(st.size, Math.max(64 * 1024, baris * 600));
    const fh = await fs.promises.open(berkas, 'r');
    try {
      const buf = Buffer.alloc(panjang);
      await fh.read(buf, 0, panjang, st.size - panjang);
      const semua = buf.toString('utf8').split('\n');
      if (panjang < st.size) semua.shift(); // baris pertama kemungkinan terpotong
      return { path: berkas, size: st.size, modified: st.mtime, lines: semua.filter(Boolean).slice(-baris) };
    } finally {
      await fh.close();
    }
  } catch (error) {
    return { path: berkas, size: 0, lines: [], error: error.code === 'ENOENT' ? 'Berkas tidak ada' : error.message };
  }
};

/* ─────────────────────────── systemd ─────────────────────────── */

const getServices = async () => {
  if (!IS_LINUX) return { available: false, services: [], note: 'Pemeriksaan systemd hanya di server Linux.' };
  const r = await jalankan('systemctl', [
    'show', ...SYSTEM_SERVICES.map((s) => s.unit), '--no-pager',
    '--property=Id,LoadState,ActiveState,SubState,ActiveEnterTimestamp,MainPID,MemoryCurrent,Description,UnitFileState,TriggeredBy',
  ]);
  if (!r.stdout) return { available: false, services: [], note: r.error || 'systemctl tidak tersedia' };
  const blok = r.stdout.trim().split(/\n\s*\n/);
  const layanan = [];
  blok.forEach((b, idx) => {
    const o = {};
    for (const baris of b.split('\n')) {
      const i = baris.indexOf('=');
      if (i > 0) o[baris.slice(0, i)] = baris.slice(i + 1);
    }
    if (o.LoadState !== 'loaded') return;
    const def = SYSTEM_SERVICES.find((s) => `${s.unit}.service` === o.Id || s.unit === o.Id) || SYSTEM_SERVICES[idx] || {};
    const mem = Number(o.MemoryCurrent);
    layanan.push({
      unit: o.Id,
      label: def.label || o.Description,
      description: o.Description,
      active: o.ActiveState,
      sub: o.SubState,
      since: o.ActiveEnterTimestamp || null,
      pid: Number(o.MainPID) || null,
      memory: Number.isFinite(mem) && mem < 1e15 ? mem : null,
      enabled: !['disabled', 'masked'].includes(o.UnitFileState),
      socket: /\.socket\b/.test(o.TriggeredBy || ''),
    });
  });
  // Layanan yang dinyalakan socket (mis. ssh.service lewat ssh.socket) wajar
  // inactive selama tidak ada koneksi. systemd lama tidak mengisi TriggeredBy,
  // jadi status <unit>.socket dicek langsung (satu baris per unit, urut).
  const cekSocket = layanan.filter((x) => x.active !== 'active' && !x.socket);
  if (cekSocket.length) {
    const rs = await jalankan('systemctl', ['is-active', ...cekSocket.map((x) => x.unit.replace(/\.service$/, '.socket'))]);
    rs.stdout.trim().split('\n').forEach((st, i) => {
      if (st.trim() === 'active' && cekSocket[i]) cekSocket[i].socket = true;
    });
  }

  for (const s of layanan) {
    const key = `svc:${s.unit}`;
    // Hanya layanan yang memang di-enable yang dianggap mati: unit yang sengaja
    // dinonaktifkan (mis. SSH di container yang diakses lewat `pct`) atau yang
    // diaktifkan socket wajar berstatus inactive.
    const semestinyaJalan = s.enabled && !s.socket;
    if (semestinyaJalan && s.active !== 'active' && !['ufw.service', 'fail2ban.service'].includes(s.unit)) {
      alerts.raise(key, { level: 'critical', kategori: 'layanan', title: `Layanan ${s.label} mati`, message: `${s.unit} berstatus ${s.active}/${s.sub}.` });
    } else {
      alerts.clear(key);
    }
  }
  return { available: true, services: layanan };
};

const getPorts = async () => {
  if (!IS_LINUX) return { available: false, ports: [] };
  const r = await jalankan('ss', ['-tlnpH']);
  if (!r.ok) return { available: false, ports: [], note: r.error };
  const ports = [];
  for (const baris of r.stdout.split('\n')) {
    const k = baris.trim().split(/\s+/);
    if (k.length < 4) continue;
    const lokal = k[3];
    const idx = lokal.lastIndexOf(':');
    const alamat = lokal.slice(0, idx);
    const port = Number(lokal.slice(idx + 1));
    const proses = (baris.match(/users:\(\("([^"]+)"/) || [])[1] || null;
    const publik = !/^(127\.|\[::1\]|localhost)/.test(alamat);
    if (!ports.some((p) => p.port === port && p.address === alamat)) ports.push({ port, address: alamat, process: proses, public: publik });
  }
  return { available: true, ports: ports.sort((a, b) => a.port - b.port) };
};

/* ─────────────────────── Monitor uptime & SSL ─────────────────────── */

const riwayatMonitor = new Map(); // url → [{ t, up, ms, status }]
const sertifikat = new Map(); // host → { valid_to, issuer, days_left, checked }

const defaultMonitors = () => {
  const port = process.env.PORT || 3001;
  const daftar = [{ name: 'Backend API (lokal)', url: `http://127.0.0.1:${port}/health` }];
  // Bukan FRONTEND_URL: di .env produksi nilainya masih dpmdbogorkab.id, domain
  // lama yang sejak 23 Juli 2026 hanya melayani halaman "domain pindah"
  // (lihat nginx-dpmdbogorkab.conf) — memantaunya memberi alarm palsu.
  const frontend = process.env.MONITOR_WEBSITE_URL || (process.env.NODE_ENV === 'production' ? 'https://dpmd.bogorkab.go.id' : null);
  if (frontend) daftar.push({ name: 'Website DPMD', url: frontend });
  if (IS_LINUX) daftar.push({ name: 'Webhook Deploy', url: 'http://127.0.0.1:9000/webhook/status' });
  return daftar;
};

const getMonitors = () => {
  const cfg = store.getConfigSync();
  return Array.isArray(cfg.monitors) && cfg.monitors.length ? cfg.monitors : defaultMonitors();
};

const cekUrl = (url) => new Promise((resolve) => {
  let u;
  try { u = new URL(url); } catch { resolve({ up: false, ms: 0, status: 0, error: 'URL tidak valid' }); return; }
  const lib = u.protocol === 'https:' ? https : http;
  const mulai = Date.now();
  const req = lib.request(u, { method: 'GET', timeout: 8000, headers: { 'User-Agent': 'DPMD-ServerMonitor/1.0' } }, (res) => {
    res.resume();
    res.on('end', () => resolve({ up: res.statusCode < 500, ms: Date.now() - mulai, status: res.statusCode }));
  });
  req.on('timeout', () => { req.destroy(new Error('Timeout 8 detik')); });
  req.on('error', (e) => resolve({ up: false, ms: Date.now() - mulai, status: 0, error: e.message }));
  req.end();
});

const cekSertifikat = (host) => new Promise((resolve) => {
  const sock = tls.connect({ host, port: 443, servername: host, timeout: 8000, rejectUnauthorized: false }, () => {
    const c = sock.getPeerCertificate();
    sock.end();
    if (!c || !c.valid_to) { resolve(null); return; }
    const berakhir = new Date(c.valid_to);
    resolve({
      host,
      valid_from: new Date(c.valid_from),
      valid_to: berakhir,
      days_left: Math.floor((berakhir - Date.now()) / 86400000),
      issuer: c.issuer?.O || c.issuer?.CN || '-',
      subject: c.subject?.CN || host,
      authorized: sock.authorized,
    });
  });
  sock.on('error', () => resolve(null));
  sock.on('timeout', () => { sock.destroy(); resolve(null); });
});

const jalankanMonitor = async () => {
  const daftar = getMonitors();
  await Promise.all(daftar.map(async (m) => {
    const hasil = await cekUrl(m.url);
    const r = riwayatMonitor.get(m.url) || [];
    r.push({ t: Date.now(), ...hasil });
    if (r.length > 1440) r.shift(); // 24 jam @1 menit
    riwayatMonitor.set(m.url, r);

    const key = `monitor:${m.url}`;
    const gagalBeruntun = r.slice(-2).every((x) => !x.up) && r.length >= 2;
    if (gagalBeruntun) {
      alerts.raise(key, { level: 'critical', kategori: 'uptime', title: `${m.name} tidak bisa diakses`, message: `${m.url} gagal dicek 2x berturut-turut (${hasil.error || `HTTP ${hasil.status}`}).` });
    } else if (hasil.up) {
      alerts.clear(key);
    }

    try {
      const u = new URL(m.url);
      if (u.protocol === 'https:') {
        const lama = sertifikat.get(u.hostname);
        if (!lama || Date.now() - lama.checked > 6 * 3600000) {
          const c = await cekSertifikat(u.hostname);
          if (c) {
            sertifikat.set(u.hostname, { ...c, checked: Date.now() });
            const kunci = `ssl:${u.hostname}`;
            if (c.days_left <= 14) {
              alerts.raise(kunci, { level: c.days_left <= 3 ? 'critical' : 'warning', kategori: 'ssl', title: 'Sertifikat SSL segera habis', message: `SSL ${u.hostname} berakhir dalam ${c.days_left} hari (${c.valid_to.toISOString().slice(0, 10)}).` });
            } else {
              alerts.clear(kunci);
            }
          }
        }
      }
    } catch { /* abaikan */ }
  }));
};

const getMonitorStatus = () => getMonitors().map((m) => {
  const r = riwayatMonitor.get(m.url) || [];
  const akhir = r[r.length - 1] || null;
  const naik = r.filter((x) => x.up).length;
  const ms = r.filter((x) => x.up).map((x) => x.ms);
  let host = null;
  try { host = new URL(m.url).hostname; } catch { /* abaikan */ }
  return {
    ...m,
    last: akhir,
    uptime_percent: r.length ? Math.round((naik / r.length) * 10000) / 100 : null,
    avg_ms: ms.length ? Math.round(ms.reduce((a, b) => a + b, 0) / ms.length) : null,
    checks: r.length,
    history: r.slice(-60).map((x) => ({ t: x.t, up: x.up, ms: x.ms })),
    ssl: host ? sertifikat.get(host) || null : null,
  };
});

/* ─────────────────────────── Database ─────────────────────────── */

const getDatabase = async () => {
  const mulai = Date.now();
  try {
    await prisma.$queryRawUnsafe('SELECT 1');
  } catch (error) {
    alerts.raise('db:down', { level: 'critical', kategori: 'database', title: 'Database tidak terhubung', message: error.message.slice(0, 200) });
    return { connected: false, error: error.message };
  }
  const latency = Date.now() - mulai;
  alerts.clear('db:down');

  const aman = async (sql) => { try { return await store.query(sql); } catch { return []; } };
  const [versi, status, variabel, tabel, proses] = await Promise.all([
    aman('SELECT VERSION() AS v, DATABASE() AS db'),
    aman(`SHOW GLOBAL STATUS WHERE Variable_name IN ('Uptime','Threads_connected','Threads_running','Questions','Slow_queries','Aborted_connects','Aborted_clients','Connections','Bytes_received','Bytes_sent','Max_used_connections','Innodb_buffer_pool_read_requests','Innodb_buffer_pool_reads','Innodb_row_lock_waits','Com_select','Com_insert','Com_update','Com_delete','Open_tables')`),
    aman(`SHOW VARIABLES WHERE Variable_name IN ('max_connections','innodb_buffer_pool_size','long_query_time','slow_query_log','version_comment','character_set_server','time_zone','wait_timeout')`),
    aman(`SELECT TABLE_NAME AS name, ENGINE AS engine, TABLE_ROWS AS row_estimate,
                 DATA_LENGTH AS data_size, INDEX_LENGTH AS index_size, DATA_FREE AS free_size,
                 (DATA_LENGTH + INDEX_LENGTH) AS total_size, UPDATE_TIME AS updated_at, CREATE_TIME AS created_at
            FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() ORDER BY total_size DESC`),
    aman('SELECT ID AS id, USER AS user, HOST AS host, DB AS db, COMMAND AS command, TIME AS time, STATE AS state, LEFT(INFO, 300) AS info FROM information_schema.PROCESSLIST ORDER BY TIME DESC LIMIT 50'),
  ]);

  const st = Object.fromEntries(status.map((r) => [r.Variable_name, Number(r.Value)]));
  const vr = Object.fromEntries(variabel.map((r) => [r.Variable_name, r.Value]));
  const total = tabel.reduce((t, x) => t + Number(x.total_size || 0), 0);
  const baris = tabel.reduce((t, x) => t + Number(x.row_estimate || 0), 0);
  const hitRate = st.Innodb_buffer_pool_read_requests
    ? Math.round((1 - (st.Innodb_buffer_pool_reads || 0) / st.Innodb_buffer_pool_read_requests) * 10000) / 100
    : null;

  return {
    connected: true,
    latency_ms: latency,
    version: versi[0]?.v || '-',
    name: versi[0]?.db || '-',
    uptime: st.Uptime || 0,
    connections: {
      current: st.Threads_connected || 0,
      running: st.Threads_running || 0,
      max: Number(vr.max_connections) || null,
      max_used: st.Max_used_connections || 0,
      total: st.Connections || 0,
      aborted: (st.Aborted_connects || 0) + (st.Aborted_clients || 0),
    },
    queries: {
      total: st.Questions || 0,
      qps: st.Uptime ? Math.round(((st.Questions || 0) / st.Uptime) * 100) / 100 : 0,
      slow: st.Slow_queries || 0,
      select: st.Com_select || 0,
      insert: st.Com_insert || 0,
      update: st.Com_update || 0,
      delete: st.Com_delete || 0,
      row_lock_waits: st.Innodb_row_lock_waits || 0,
    },
    traffic: { received: st.Bytes_received || 0, sent: st.Bytes_sent || 0 },
    buffer_pool: { size: Number(vr.innodb_buffer_pool_size) || null, hit_rate: hitRate },
    variables: vr,
    size: { total, tables: tabel.length, rows: baris },
    tables: tabel.map((t) => ({
      ...t,
      data_size: Number(t.data_size || 0),
      index_size: Number(t.index_size || 0),
      free_size: Number(t.free_size || 0),
      total_size: Number(t.total_size || 0),
      row_estimate: Number(t.row_estimate || 0),
    })),
    processes: proses,
  };
};

let started = false;
const start = () => {
  if (started) return;
  started = true;
  setTimeout(() => jalankanMonitor().catch(() => {}), 20000).unref();
  setInterval(() => jalankanMonitor().catch((e) => logger.warn(`[ServerApps] monitor: ${e.message}`)), 60000).unref();
  // Status PM2/systemd/DB juga diperiksa di latar supaya peringatan muncul
  // walau halaman tidak sedang dibuka.
  setInterval(() => {
    getPm2().catch(() => {});
    getServices().catch(() => {});
  }, 2 * 60000).unref();
};

module.exports = {
  start,
  getPm2,
  pm2Action,
  pm2Logs,
  getServices,
  getPorts,
  getMonitorStatus,
  jalankanMonitor,
  cekUrl,
  getDatabase,
  ekor,
};
