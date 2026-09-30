/**
 * Pemantau kondisi server untuk halaman Manajemen Server.
 *
 * Mengambil sampel setiap 10 detik: CPU, RAM, swap, disk, jaringan, beban,
 * event loop Node, memori proses, dan trafik HTTP. Sampel satu jam terakhir
 * disimpan di memori; rata-rata per 5 menit ditulis ke server_metric_snapshots
 * supaya grafik 24 jam / 7 hari / 30 hari tetap ada setelah aplikasi restart.
 *
 * Di Linux angka dibaca dari /proc (di container LXC berlxcfs nilainya sudah
 * milik container, bukan host). Di Windows (pengembangan lokal) jatuh ke
 * modul `os` — cukup untuk mencoba halaman, tidak untuk dipercaya.
 */

const os = require('os');
const fs = require('fs');
const fsp = require('fs/promises');
const { monitorEventLoopDelay } = require('perf_hooks');
const logger = require('../utils/logger');
const store = require('./serverStore.service');
const { BACKEND_ROOT } = require('../config/serverManagement');

const IS_LINUX = process.platform === 'linux';
const SAMPLE_MS = 10 * 1000;
const HISTORY_POINTS = 360; // 1 jam @10 detik
const SNAPSHOT_MS = 5 * 60 * 1000;
const SNAPSHOT_RETENTION_DAYS = 30;

const history = [];
let latest = null;
let prevCpu = null;
let prevNet = null;
let prevProcCpu = process.cpuUsage();
let prevProcAt = process.hrtime.bigint();
let started = false;
const startedAt = new Date();

// Histogram mencatat jarak antar-tick termasuk resolusinya sendiri, jadi
// resolusi dikurangkan agar yang tersisa hanya keterlambatan sebenarnya.
const LOOP_RES_MS = 20;
const eventLoop = monitorEventLoopDelay({ resolution: LOOP_RES_MS });
eventLoop.enable();

/* ───────────────────────── Trafik HTTP ───────────────────────── */

const MAX_MAP = 3000;
const traffic = {
  since: new Date(),
  total: 0,
  bytes: 0,
  status: {}, // '2xx' → n, dan kode persis
  routes: new Map(),
  ips: new Map(),
  durations: [], // ring 2000 terakhir
  minutes: [], // { t, count, e4, e5, ms } 60 menit
  pending: { count: 0, e4: 0, e5: 0, ms: 0 }, // untuk sampel 10 detik berjalan
  snapshot: { count: 0, e5: 0, ms: 0 }, // untuk snapshot 5 menit
};

const normalisasiPath = (url) => {
  const p = String(url || '').split('?')[0];
  return p
    .split('/')
    .map((seg) => {
      if (!seg) return seg;
      if (/^\d+$/.test(seg)) return ':id';
      if (/^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(seg)) return ':uuid';
      if (/^[0-9a-f]{16,}$/i.test(seg)) return ':hash';
      if (seg.length > 40) return ':val';
      if (/\.(jpe?g|png|webp|gif|pdf|docx?|xlsx?|zip|mp4|svg)$/i.test(seg)) return ':file';
      return seg;
    })
    .join('/')
    .slice(0, 160);
};

const pangkasMap = (map) => {
  if (map.size <= MAX_MAP) return;
  for (const [k, v] of map) {
    if (v.count <= 2) map.delete(k);
    if (map.size <= MAX_MAP * 0.8) break;
  }
};

const menitSekarang = () => {
  const t = Math.floor(Date.now() / 60000) * 60000;
  let akhir = traffic.minutes[traffic.minutes.length - 1];
  if (!akhir || akhir.t !== t) {
    akhir = { t, count: 0, e4: 0, e5: 0, ms: 0 };
    traffic.minutes.push(akhir);
    if (traffic.minutes.length > 60) traffic.minutes.shift();
  }
  return akhir;
};

/** Dipanggil middleware untuk setiap request yang selesai. */
const recordRequest = ({ method, url, status, ms, bytes, ip }) => {
  traffic.total += 1;
  traffic.bytes += bytes || 0;
  const kelas = `${Math.floor(status / 100)}xx`;
  traffic.status[kelas] = (traffic.status[kelas] || 0) + 1;
  traffic.status[status] = (traffic.status[status] || 0) + 1;

  const e4 = status >= 400 && status < 500 ? 1 : 0;
  const e5 = status >= 500 ? 1 : 0;

  const menit = menitSekarang();
  menit.count += 1; menit.e4 += e4; menit.e5 += e5; menit.ms += ms;
  traffic.pending.count += 1; traffic.pending.e4 += e4; traffic.pending.e5 += e5; traffic.pending.ms += ms;
  traffic.snapshot.count += 1; traffic.snapshot.e5 += e5; traffic.snapshot.ms += ms;

  traffic.durations.push(ms);
  if (traffic.durations.length > 2000) traffic.durations.shift();

  const kunci = `${method} ${normalisasiPath(url)}`;
  const r = traffic.routes.get(kunci) || { count: 0, errors: 0, totalMs: 0, maxMs: 0, bytes: 0 };
  r.count += 1; r.errors += e5 + e4; r.totalMs += ms; r.bytes += bytes || 0;
  if (ms > r.maxMs) r.maxMs = ms;
  traffic.routes.set(kunci, r);
  pangkasMap(traffic.routes);

  if (ip) {
    const i = traffic.ips.get(ip) || { count: 0, errors: 0, bytes: 0, last: 0 };
    i.count += 1; i.errors += e4 + e5; i.bytes += bytes || 0; i.last = Date.now();
    traffic.ips.set(ip, i);
    pangkasMap(traffic.ips);
  }
};

const persentil = (arr, p) => {
  if (!arr.length) return 0;
  const urut = [...arr].sort((a, b) => a - b);
  return Math.round(urut[Math.min(urut.length - 1, Math.floor((p / 100) * urut.length))]);
};

const getTraffic = () => {
  const routes = [...traffic.routes.entries()].map(([k, v]) => ({
    route: k,
    count: v.count,
    errors: v.errors,
    avg_ms: Math.round(v.totalMs / v.count),
    max_ms: Math.round(v.maxMs),
    bytes: v.bytes,
  }));
  const ips = [...traffic.ips.entries()].map(([ip, v]) => ({ ip, ...v }));
  const menit = traffic.minutes.slice(-60);
  const totalMenit = menit.reduce((t, m) => t + m.count, 0);
  const rpm = menit.length ? Math.round(totalMenit / menit.length) : 0;
  return {
    since: traffic.since,
    total: traffic.total,
    bytes: traffic.bytes,
    status: traffic.status,
    rpm,
    p50: persentil(traffic.durations, 50),
    p95: persentil(traffic.durations, 95),
    p99: persentil(traffic.durations, 99),
    per_minute: menit.map((m) => ({
      t: m.t, count: m.count, e4: m.e4, e5: m.e5, avg_ms: m.count ? Math.round(m.ms / m.count) : 0,
    })),
    top_routes: [...routes].sort((a, b) => b.count - a.count).slice(0, 25),
    slowest_routes: routes.filter((r) => r.count >= 3).sort((a, b) => b.avg_ms - a.avg_ms).slice(0, 15),
    error_routes: routes.filter((r) => r.errors > 0).sort((a, b) => b.errors - a.errors).slice(0, 15),
    top_ips: ips.sort((a, b) => b.count - a.count).slice(0, 25),
  };
};

const resetTraffic = () => {
  traffic.since = new Date();
  traffic.total = 0; traffic.bytes = 0; traffic.status = {};
  traffic.routes.clear(); traffic.ips.clear(); traffic.durations = [];
};

/* ───────────────────────── Sampel sistem ───────────────────────── */

const bacaTeks = async (berkas) => {
  try { return await fsp.readFile(berkas, 'utf8'); } catch { return null; }
};

const cpuTotal = async () => {
  if (IS_LINUX) {
    const stat = await bacaTeks('/proc/stat');
    if (stat) {
      const angka = stat.split('\n')[0].trim().split(/\s+/).slice(1).map(Number);
      const idle = angka[3] + (angka[4] || 0);
      const total = angka.reduce((a, b) => a + b, 0);
      return { idle, total };
    }
  }
  let idle = 0; let total = 0;
  for (const c of os.cpus()) {
    for (const [k, v] of Object.entries(c.times)) { total += v; if (k === 'idle') idle += v; }
  }
  return { idle, total };
};

const memori = async () => {
  if (IS_LINUX) {
    const info = await bacaTeks('/proc/meminfo');
    if (info) {
      const ambil = (kunci) => {
        const m = info.match(new RegExp(`^${kunci}:\\s+(\\d+)`, 'm'));
        return m ? Number(m[1]) * 1024 : 0;
      };
      const total = ambil('MemTotal');
      const available = ambil('MemAvailable') || ambil('MemFree') + ambil('Cached');
      return {
        total,
        used: total - available,
        available,
        cached: ambil('Cached') + ambil('Buffers'),
        swap_total: ambil('SwapTotal'),
        swap_used: ambil('SwapTotal') - ambil('SwapFree'),
      };
    }
  }
  const total = os.totalmem();
  const free = os.freemem();
  return { total, used: total - free, available: free, cached: 0, swap_total: 0, swap_used: 0 };
};

const jaringan = async () => {
  if (!IS_LINUX) return null;
  const isi = await bacaTeks('/proc/net/dev');
  if (!isi) return null;
  let rx = 0; let tx = 0;
  const antarmuka = [];
  for (const baris of isi.split('\n').slice(2)) {
    const [nama, data] = baris.split(':');
    if (!data) continue;
    const n = nama.trim();
    if (n === 'lo') continue;
    const kolom = data.trim().split(/\s+/).map(Number);
    rx += kolom[0]; tx += kolom[8];
    antarmuka.push({ name: n, rx: kolom[0], tx: kolom[8] });
  }
  return { rx, tx, interfaces: antarmuka };
};

const disk = async () => {
  try {
    const s = await fsp.statfs(BACKEND_ROOT);
    const total = s.blocks * s.bsize;
    const free = s.bavail * s.bsize;
    return { total, free, used: total - free, percent: total ? ((total - free) / total) * 100 : 0 };
  } catch {
    return null;
  }
};

const onlineSockets = () => {
  try {
    // Dimuat saat dipakai: modul socket memuat banyak hal saat require.
    const { getIO } = require('../socket/meeting.socket');
    const io = getIO();
    return io ? io.engine.clientsCount : 0;
  } catch {
    return 0;
  }
};

const bulat = (n, d = 1) => Math.round(n * 10 ** d) / 10 ** d;

const ambilSampel = async () => {
  const sekarangCpu = await cpuTotal();
  let cpu = 0;
  if (prevCpu) {
    const dTotal = sekarangCpu.total - prevCpu.total;
    const dIdle = sekarangCpu.idle - prevCpu.idle;
    cpu = dTotal > 0 ? ((dTotal - dIdle) / dTotal) * 100 : 0;
  }
  prevCpu = sekarangCpu;

  const net = await jaringan();
  let rxRate = 0; let txRate = 0;
  if (net && prevNet) {
    const detik = (Date.now() - prevNet.at) / 1000;
    rxRate = Math.max(0, (net.rx - prevNet.rx) / detik);
    txRate = Math.max(0, (net.tx - prevNet.tx) / detik);
  }
  if (net) prevNet = { rx: net.rx, tx: net.tx, at: Date.now() };

  const mem = await memori();
  const dsk = await disk();

  // CPU milik proses Node ini saja.
  const kiniProc = process.cpuUsage();
  const kiniAt = process.hrtime.bigint();
  const lewatUs = Number(kiniAt - prevProcAt) / 1000;
  const procCpu = lewatUs > 0
    ? (((kiniProc.user - prevProcCpu.user) + (kiniProc.system - prevProcCpu.system)) / lewatUs) * 100
    : 0;
  prevProcCpu = kiniProc; prevProcAt = kiniAt;

  const pm = process.memoryUsage();
  const loop = {
    mean: bulat(Math.max(0, eventLoop.mean / 1e6 - LOOP_RES_MS)),
    p99: bulat(Math.max(0, eventLoop.percentile(99) / 1e6 - LOOP_RES_MS)),
    max: bulat(Math.max(0, eventLoop.max / 1e6 - LOOP_RES_MS)),
  };
  eventLoop.reset();

  const p = traffic.pending;
  const req = {
    count: p.count,
    rps: bulat(p.count / (SAMPLE_MS / 1000), 2),
    errors: p.e5,
    client_errors: p.e4,
    avg_ms: p.count ? Math.round(p.ms / p.count) : 0,
  };
  traffic.pending = { count: 0, e4: 0, e5: 0, ms: 0 };

  const cores = os.cpus().length;
  const [l1, l5, l15] = os.loadavg();

  latest = {
    t: Date.now(),
    cpu: bulat(cpu),
    cores,
    load: [bulat(l1, 2), bulat(l5, 2), bulat(l15, 2)],
    memory: { ...mem, percent: mem.total ? bulat((mem.used / mem.total) * 100) : 0 },
    disk: dsk ? { ...dsk, percent: bulat(dsk.percent) } : null,
    network: { rx_rate: Math.round(rxRate), tx_rate: Math.round(txRate), rx_total: net?.rx || 0, tx_total: net?.tx || 0, interfaces: net?.interfaces || [] },
    process: {
      pid: process.pid,
      cpu: bulat(procCpu),
      rss: pm.rss,
      heap_used: pm.heapUsed,
      heap_total: pm.heapTotal,
      external: pm.external,
      uptime: Math.round(process.uptime()),
    },
    event_loop: loop,
    requests: req,
    online: onlineSockets(),
  };

  history.push({
    t: latest.t,
    cpu: latest.cpu,
    memory: latest.memory.percent,
    disk: latest.disk?.percent ?? null,
    load1: latest.load[0],
    process_mb: Math.round(pm.rss / 1048576),
    rps: req.rps,
    avg_ms: req.avg_ms,
    errors: req.errors,
    rx: latest.network.rx_rate,
    tx: latest.network.tx_rate,
    loop: loop.p99,
    online: latest.online,
  });
  if (history.length > HISTORY_POINTS) history.shift();

  // Evaluasi peringatan dimuat malas untuk menghindari require melingkar.
  try { require('./serverAlerts.service').evaluasiMetrik(latest); } catch (e) { logger.debug?.(e.message); }

  return latest;
};

/* ───────────────────────── Snapshot ke DB ───────────────────────── */

const simpanSnapshot = async () => {
  const jendela = history.filter((h) => h.t >= Date.now() - SNAPSHOT_MS);
  if (!jendela.length) return;
  const rata = (k) => jendela.reduce((t, h) => t + (h[k] || 0), 0) / jendela.length;
  const s = traffic.snapshot;
  traffic.snapshot = { count: 0, e5: 0, ms: 0 };
  let serangan = 0;
  try { serangan = require('./serverSecurity.service').ambilHitunganSnapshot(); } catch { /* opsional */ }

  try {
    await store.ensureTables();
    await store.execute(
      `INSERT INTO server_metric_snapshots
        (cpu, memory, disk, load1, process_mb, requests, errors, avg_ms, net_rx, net_tx, attacks, online)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      bulat(rata('cpu'), 2), bulat(rata('memory'), 2), latest?.disk ? bulat(latest.disk.percent, 2) : null,
      bulat(rata('load1'), 2), Math.round(rata('process_mb')), s.count, s.e5,
      s.count ? Math.round(s.ms / s.count) : 0,
      Math.round(rata('rx')), Math.round(rata('tx')), serangan, Math.round(rata('online')),
    );
  } catch (error) {
    logger.warn(`[ServerMetrics] Gagal simpan snapshot: ${error.message}`);
  }
};

const bersihkanSnapshot = async () => {
  try {
    await store.execute(
      `DELETE FROM server_metric_snapshots WHERE created_at < DATE_SUB(NOW(), INTERVAL ${SNAPSHOT_RETENTION_DAYS} DAY)`,
    );
  } catch { /* tabel mungkin belum ada */ }
};

/** Riwayat per rentang: 1h dari memori, sisanya dari DB (dirata-ratakan per bucket). */
const getHistory = async (rentang = '1h') => {
  if (rentang === '1h') return { range: '1h', resolution: '10s', points: history };

  const peta = { '6h': [6, 5], '24h': [24, 10], '7d': [168, 60], '30d': [720, 240] };
  const [jam, bucketMenit] = peta[rentang] || peta['24h'];
  await store.ensureTables();
  const baris = await store.query(
    `SELECT FLOOR(UNIX_TIMESTAMP(created_at) / (? * 60)) * (? * 60) * 1000 AS t,
            AVG(cpu) AS cpu, AVG(memory) AS memory, AVG(disk) AS disk, AVG(load1) AS load1,
            AVG(process_mb) AS process_mb, SUM(requests) AS requests, SUM(errors) AS errors,
            AVG(avg_ms) AS avg_ms, AVG(net_rx) AS rx, AVG(net_tx) AS tx,
            SUM(attacks) AS attacks, AVG(online) AS online
       FROM server_metric_snapshots
      WHERE created_at >= DATE_SUB(NOW(), INTERVAL ? HOUR)
      GROUP BY t ORDER BY t`,
    bucketMenit, bucketMenit, jam,
  );
  return {
    range: rentang,
    resolution: `${bucketMenit}m`,
    points: baris.map((b) => {
      const o = {};
      for (const [k, v] of Object.entries(b)) o[k] = v === null ? null : bulat(Number(v), 2);
      return o;
    }),
  };
};

const getSystemInfo = () => {
  let distro = null;
  if (IS_LINUX) {
    try {
      const rel = fs.readFileSync('/etc/os-release', 'utf8');
      distro = (rel.match(/^PRETTY_NAME="?([^"\n]+)"?/m) || [])[1] || null;
    } catch { /* abaikan */ }
  }
  const cpu = os.cpus()[0];
  return {
    hostname: os.hostname(),
    platform: process.platform,
    distro: distro || `${os.type()} ${os.release()}`,
    kernel: os.release(),
    arch: os.arch(),
    cpu_model: cpu ? cpu.model.trim() : '-',
    cpu_cores: os.cpus().length,
    total_memory: os.totalmem(),
    node_version: process.version,
    os_uptime: Math.round(os.uptime()),
    app_started_at: startedAt,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    env: process.env.NODE_ENV || 'development',
    ip_addresses: Object.entries(os.networkInterfaces())
      .flatMap(([nama, daftar]) => (daftar || []).filter((a) => !a.internal && a.family === 'IPv4').map((a) => ({ iface: nama, address: a.address }))),
  };
};

const start = () => {
  if (started) return;
  started = true;
  ambilSampel().catch(() => {});
  setInterval(() => ambilSampel().catch((e) => logger.warn(`[ServerMetrics] ${e.message}`)), SAMPLE_MS).unref();
  setInterval(() => simpanSnapshot(), SNAPSHOT_MS).unref();
  setInterval(() => bersihkanSnapshot(), 6 * 60 * 60 * 1000).unref();
  store.ensureTables().then(bersihkanSnapshot).catch(() => {});
};

module.exports = {
  start,
  recordRequest,
  getLatest: () => latest,
  getHistory,
  getTraffic,
  resetTraffic,
  getSystemInfo,
  normalisasiPath,
};
