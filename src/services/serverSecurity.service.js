/**
 * Keamanan Manajemen Server: deteksi serangan, skor ancaman per IP, blokir IP
 * (manual & otomatis), serta pemindaian log nginx/SSH.
 *
 * Alurnya:
 *   1. Middleware memeriksa tiap request (URL, User-Agent, sebagian body) dan
 *      tiap respons (401/403/404/429) lalu memanggil recordEvent().
 *   2. recordEvent() menambah skor IP dalam jendela waktu; bila melewati ambang
 *      dan auto-block aktif, IP diblokir sementara.
 *   3. Kejadian ditampung lalu ditulis ke server_security_events per 5 detik
 *      dalam satu INSERT supaya serangan ribuan request tidak ikut membanjiri
 *      database.
 *
 * Pemblokiran berlaku di tingkat aplikasi (API/Node). Aset statis frontend
 * dilayani nginx langsung, dan SSH di luar jangkauan aplikasi — untuk itu
 * halaman menampilkan perintah nginx/ufw yang bisa disalin.
 */

const fs = require('fs');
const fsp = require('fs/promises');
const net = require('net');
const logger = require('../utils/logger');
const store = require('./serverStore.service');
const alerts = require('./serverAlerts.service');
const {
  EVENT_TYPES,
  SEVERITY_SCORE,
  DETECTION_RULES,
  BAD_USER_AGENTS,
  FLOOD_THRESHOLDS,
  SYSTEM_LOGS,
} = require('../config/serverManagement');

const IS_LINUX = process.platform === 'linux';

const antrean = [];
const skorIp = new Map(); // ip → [{ t, s }]
const banjir = new Map(); // ip → { unauth: [t], nf: [t], login: [t] }
const blokir = new Map(); // ip → { reason, expires_at, auto }
const hitunganTipe = []; // [{ t, type }] 1 jam terakhir untuk ringkasan langsung
let hitunganSnapshot = 0;
let started = false;

/* ─────────────────────────── Util IP ─────────────────────────── */

const bersihkanIp = (ip) => String(ip || '').replace(/^::ffff:/, '').trim();

const ipPrivat = (ip) => {
  const i = bersihkanIp(ip);
  if (!i) return true;
  if (i === '::1' || i.startsWith('127.')) return true;
  if (/^10\./.test(i) || /^192\.168\./.test(i) || /^172\.(1[6-9]|2\d|3[01])\./.test(i)) return true;
  if (/^f[cd][0-9a-f]{2}:/i.test(i) || /^fe80:/i.test(i)) return true;
  return false;
};

const diWhitelist = (ip) => {
  const daftar = store.getConfigSync().security.whitelist || [];
  const i = bersihkanIp(ip);
  return daftar.some((w) => {
    const pola = String(w).trim();
    if (!pola) return false;
    if (pola.endsWith('*')) return i.startsWith(pola.slice(0, -1));
    return pola === i;
  });
};

/* ─────────────────────────── Blokir ─────────────────────────── */

const muatBlokir = async () => {
  try {
    await store.ensureTables();
    const baris = await store.query(
      'SELECT ip_address, reason, auto, expires_at FROM server_ip_blocklist WHERE expires_at IS NULL OR expires_at > NOW()',
    );
    blokir.clear();
    for (const b of baris) {
      blokir.set(b.ip_address, { reason: b.reason, auto: !!b.auto, expires_at: b.expires_at ? new Date(b.expires_at) : null });
    }
  } catch (error) {
    logger.warn(`[ServerSecurity] Gagal memuat blokir IP: ${error.message}`);
  }
};

const isBlocked = (ip) => {
  const i = bersihkanIp(ip);
  const b = blokir.get(i);
  if (!b) return null;
  if (b.expires_at && b.expires_at.getTime() < Date.now()) {
    blokir.delete(i);
    return null;
  }
  return b;
};

const blockIp = async ({ ip, reason, minutes = null, auto = false, by = null }) => {
  const i = bersihkanIp(ip);
  if (!net.isIP(i)) throw new Error('Alamat IP tidak valid');
  const expires = minutes ? new Date(Date.now() + minutes * 60000) : null;
  await store.ensureTables();
  await store.execute(
    `INSERT INTO server_ip_blocklist (ip_address, reason, auto, expires_at, created_by)
     VALUES (?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE reason = VALUES(reason), auto = VALUES(auto), expires_at = VALUES(expires_at),
       created_by = VALUES(created_by), created_at = NOW()`,
    i, String(reason || '').slice(0, 500), auto ? 1 : 0, expires, by,
  );
  blokir.set(i, { reason, auto, expires_at: expires });
  return { ip: i, expires_at: expires };
};

const unblockIp = async (ip) => {
  const i = bersihkanIp(ip);
  await store.execute('DELETE FROM server_ip_blocklist WHERE ip_address = ?', i);
  blokir.delete(i);
  skorIp.delete(i);
};

const catatHitBlokir = (ip) => {
  store.execute('UPDATE server_ip_blocklist SET hits = hits + 1 WHERE ip_address = ?', bersihkanIp(ip)).catch(() => {});
};

const listBlocklist = async () => {
  await store.ensureTables();
  const baris = await store.query(
    `SELECT id, ip_address, reason, auto, hits, expires_at, created_by, created_at,
            (expires_at IS NOT NULL AND expires_at <= NOW()) AS expired
       FROM server_ip_blocklist ORDER BY created_at DESC`,
  );
  return baris.map((b) => ({ ...b, auto: !!b.auto, expired: !!b.expired }));
};

/* ─────────────────────────── Kejadian ─────────────────────────── */

const skorSaatIni = (ip) => {
  const cfg = store.getConfigSync().security;
  const batas = Date.now() - cfg.auto_block_window_minutes * 60000;
  const daftar = (skorIp.get(ip) || []).filter((x) => x.t >= batas);
  skorIp.set(ip, daftar);
  return daftar.reduce((t, x) => t + x.s, 0);
};

const recordEvent = ({
  ip, type, severity, method = null, path = null, userAgent = null, userId = null, detail = null, source = 'app', blocked = false,
}) => {
  const i = bersihkanIp(ip) || 'unknown';
  const tingkat = severity || EVENT_TYPES[type]?.severity || 'low';

  antrean.push({
    ip: i,
    type,
    severity: tingkat,
    source,
    method: method ? String(method).slice(0, 10) : null,
    path: path ? String(path).slice(0, 500) : null,
    ua: userAgent ? String(userAgent).slice(0, 500) : null,
    userId: userId ? String(userId) : null,
    detail: detail ? String(detail).slice(0, 1000) : null,
    blocked: blocked ? 1 : 0,
    at: new Date(),
  });
  if (antrean.length > 5000) antrean.splice(0, antrean.length - 5000);

  hitunganTipe.push({ t: Date.now(), type, severity: tingkat });
  hitunganSnapshot += 1;

  if (type === 'blocked_request' || type === 'auto_blocked') return;

  // Skor & blokir otomatis.
  const daftar = skorIp.get(i) || [];
  daftar.push({ t: Date.now(), s: SEVERITY_SCORE[tingkat] || 1 });
  skorIp.set(i, daftar);

  const cfg = store.getConfigSync().security;
  if (!cfg.auto_block || source !== 'app') return;
  if (ipPrivat(i) || diWhitelist(i) || isBlocked(i)) return;

  const skor = skorSaatIni(i);
  if (skor >= cfg.auto_block_score) {
    const alasan = `Otomatis: skor ancaman ${skor} dalam ${cfg.auto_block_window_minutes} menit (terakhir: ${EVENT_TYPES[type]?.label || type})`;
    blockIp({ ip: i, reason: alasan, minutes: cfg.auto_block_duration_minutes, auto: true, by: 'sistem' })
      .then(() => {
        recordEvent({ ip: i, type: 'auto_blocked', detail: alasan, source: 'app' });
        alerts.raise(`autoblock:${i}`, {
          level: 'warning',
          kategori: 'keamanan',
          title: 'IP diblokir otomatis',
          message: `${i} diblokir ${cfg.auto_block_duration_minutes} menit. ${alasan}`,
        });
        setTimeout(() => alerts.clear(`autoblock:${i}`), 15 * 60000).unref();
      })
      .catch((e) => logger.warn(`[ServerSecurity] Auto-block gagal: ${e.message}`));
  }
};

const flush = async () => {
  if (!antrean.length) return;
  const batch = antrean.splice(0, 500);
  try {
    await store.ensureTables();
    const tanda = batch.map(() => '(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').join(', ');
    const nilai = batch.flatMap((e) => [
      e.ip, e.type, e.severity, e.source, e.method, e.path, e.ua, e.userId, e.detail, e.blocked, e.at,
    ]);
    await store.execute(
      `INSERT INTO server_security_events
        (ip_address, event_type, severity, source, method, path, user_agent, user_id, detail, blocked, created_at)
       VALUES ${tanda}`,
      ...nilai,
    );
  } catch (error) {
    logger.warn(`[ServerSecurity] Gagal menulis kejadian: ${error.message}`);
  }
};

/* ─────────────────────────── Deteksi ─────────────────────────── */

const decodeAman = (s) => {
  try { return decodeURIComponent(String(s).replace(/\+/g, ' ')); } catch { return String(s); }
};

/**
 * Periksa request. Mengembalikan daftar temuan { type, detail }.
 * `terautentikasi` = token valid → body tidak diperiksa (pegawai yang menyunting
 * berita berisi HTML atau SQL contoh tidak boleh dianggap penyerang).
 */
const inspect = ({ url, userAgent, body, terautentikasi }) => {
  const temuan = [];
  const target = decodeAman(decodeAman(url || ''));

  if (userAgent && BAD_USER_AGENTS.test(userAgent)) {
    temuan.push({ type: 'bad_bot', detail: `User-Agent: ${String(userAgent).slice(0, 120)}` });
  }

  let teksBody = null;
  if (!terautentikasi && body && typeof body === 'object' && Object.keys(body).length) {
    try { teksBody = JSON.stringify(body).slice(0, 8000); } catch { teksBody = null; }
  }

  for (const aturan of DETECTION_RULES) {
    const m = target.match(aturan.pattern);
    if (m) {
      temuan.push({ type: aturan.type, detail: `URL cocok pola: "${m[0].slice(0, 80)}"` });
      continue;
    }
    if (aturan.body && teksBody) {
      const mb = teksBody.match(aturan.pattern);
      if (mb) temuan.push({ type: aturan.type, detail: `Body cocok pola: "${mb[0].slice(0, 80)}"` });
    }
  }
  return temuan;
};

const dorong = (arr, t) => {
  arr.push(t);
  const batas = t - FLOOD_THRESHOLDS.window_ms;
  while (arr.length && arr[0] < batas) arr.shift();
  return arr.length;
};

/** Dipanggil setelah respons selesai untuk mendeteksi banjir 401/403/404. */
const onResponse = ({ ip, status, method, path, userAgent }) => {
  if (status !== 401 && status !== 403 && status !== 404 && status !== 429) return;
  const i = bersihkanIp(ip);
  const now = Date.now();
  const b = banjir.get(i) || { unauth: [], nf: [], login: [], flagged: {} };
  banjir.set(i, b);

  const tandai = (kunci, type, detail) => {
    // Satu kejadian banjir per IP per jendela, bukan satu per request.
    if (b.flagged[kunci] && now - b.flagged[kunci] < FLOOD_THRESHOLDS.window_ms) return;
    b.flagged[kunci] = now;
    recordEvent({ ip: i, type, method, path, userAgent, detail });
  };

  if (status === 429) {
    tandai('rl', 'rate_limit', 'Melewati batas jumlah request API');
  } else if (status === 404) {
    const n = dorong(b.nf, now);
    if (n >= FLOOD_THRESHOLDS.not_found) tandai('nf', 'not_found_flood', `${n} request 404 dalam 5 menit`);
  } else {
    const n = dorong(b.unauth, now);
    if (n >= FLOOD_THRESHOLDS.unauthorized) tandai('ua', 'auth_flood', `${n} request ditolak (401/403) dalam 5 menit`);
  }
};

/** Dipanggil dari controller login saat email/sandi salah. */
const onLoginFailed = ({ ip, email, userAgent, alasan }) => {
  const i = bersihkanIp(ip);
  const b = banjir.get(i) || { unauth: [], nf: [], login: [], flagged: {} };
  banjir.set(i, b);
  const n = dorong(b.login, Date.now());
  recordEvent({
    ip: i, type: 'login_failed', method: 'POST', path: '/api/auth/login', userAgent,
    detail: `Email: ${String(email || '-').slice(0, 120)} (${alasan})`,
  });
  if (n >= FLOOD_THRESHOLDS.login_failed && (!b.flagged.bf || Date.now() - b.flagged.bf > FLOOD_THRESHOLDS.window_ms)) {
    b.flagged.bf = Date.now();
    recordEvent({
      ip: i, type: 'brute_force', method: 'POST', path: '/api/auth/login', userAgent,
      detail: `${n} login gagal dalam 5 menit, terakhir untuk ${String(email || '-').slice(0, 120)}`,
    });
  }
};

/* ─────────────────────── Pemindaian log sistem ─────────────────────── */

const offsetLog = new Map();
const MAX_BACA = 4 * 1024 * 1024;

const bacaTambahan = async (berkas) => {
  let st;
  try { st = await fsp.stat(berkas); } catch { return null; }
  let mulai = offsetLog.has(berkas) ? offsetLog.get(berkas) : Math.max(0, st.size - 512 * 1024);
  if (st.size < mulai) mulai = 0; // log dirotasi
  if (st.size - mulai > MAX_BACA) mulai = st.size - MAX_BACA;
  offsetLog.set(berkas, st.size);
  if (st.size === mulai) return '';
  const fh = await fsp.open(berkas, 'r');
  try {
    const buf = Buffer.alloc(st.size - mulai);
    await fh.read(buf, 0, buf.length, mulai);
    return buf.toString('utf8');
  } finally {
    await fh.close();
  }
};

// Format "combined" nginx: IP - - [waktu] "METHOD PATH HTTP/x" status bytes "ref" "UA"
const POLA_NGINX = /^(\S+) \S+ \S+ \[[^\]]+\] "(\S+) (\S+)[^"]*" (\d{3}) \S+ "[^"]*" "([^"]*)"/;

const pindaiNginx = async () => {
  const isi = await bacaTambahan(SYSTEM_LOGS.nginx_access);
  if (!isi) return;
  const perIp = new Map();
  for (const baris of isi.split('\n')) {
    const m = baris.match(POLA_NGINX);
    if (!m) continue;
    const [, ip, method, url, , ua] = m;
    // Request /api dan /socket.io diteruskan ke Node dan sudah diperiksa di sana.
    if (url.startsWith('/api/') || url.startsWith('/socket.io')) continue;
    const agg = perIp.get(ip) || { total: 0, temuan: new Map(), contoh: null, ua };
    agg.total += 1;
    for (const t of inspect({ url, userAgent: ua })) {
      agg.temuan.set(t.type, (agg.temuan.get(t.type) || 0) + 1);
      if (!agg.contoh) agg.contoh = `${method} ${url.slice(0, 200)}`;
    }
    perIp.set(ip, agg);
  }
  for (const [ip, agg] of perIp) {
    for (const [type, n] of agg.temuan) {
      recordEvent({
        ip, type: type === 'bad_bot' ? 'bad_bot' : 'nginx_attack', severity: EVENT_TYPES[type]?.severity,
        source: 'nginx', path: agg.contoh, userAgent: agg.ua,
        detail: `${EVENT_TYPES[type]?.label || type}: ${n} request di log nginx`,
      });
    }
    // Nginx di sini berada di belakang proxy lain tanpa modul real_ip, jadi
    // IP privat = alamat proxy yang membawa trafik SEMUA pengguna. Menghitung
    // banjir untuknya hanya menghasilkan alarm palsu setiap menit.
    if (agg.total >= 1500 && !ipPrivat(ip)) {
      recordEvent({ ip, type: 'rate_limit', source: 'nginx', userAgent: agg.ua, detail: `${agg.total} request ke nginx dalam 1 menit` });
    }
  }
};

const pindaiSsh = async () => {
  const isi = await bacaTambahan(SYSTEM_LOGS.auth);
  if (!isi) return;
  const perIp = new Map();
  const pola = /(Failed password for (?:invalid user )?(\S+)|Invalid user (\S+)) from (\S+)/;
  for (const baris of isi.split('\n')) {
    const m = baris.match(pola);
    if (!m) continue;
    const ip = m[4];
    const user = m[2] || m[3];
    const agg = perIp.get(ip) || { n: 0, users: new Set() };
    agg.n += 1;
    agg.users.add(user);
    perIp.set(ip, agg);
  }
  for (const [ip, agg] of perIp) {
    recordEvent({
      ip, type: 'ssh_failed', severity: agg.n >= 10 ? 'high' : 'medium', source: 'ssh',
      detail: `${agg.n} percobaan SSH gagal, user: ${[...agg.users].slice(0, 8).join(', ')}`,
    });
  }
  if (perIp.size) {
    const total = [...perIp.values()].reduce((t, a) => t + a.n, 0);
    if (total >= 50) {
      alerts.raise('ssh_bruteforce', {
        level: 'warning', kategori: 'keamanan', title: 'Brute force SSH',
        message: `${total} percobaan login SSH gagal dari ${perIp.size} IP dalam 1 menit terakhir. Pertimbangkan fail2ban/ufw.`,
      });
    } else {
      alerts.clear('ssh_bruteforce');
    }
  }
};

const pindaiLogSistem = async () => {
  if (!IS_LINUX || !store.getConfigSync().security.scan_system_logs) return;
  try { await pindaiNginx(); } catch (e) { logger.debug?.(`[ServerSecurity] nginx: ${e.message}`); }
  try { await pindaiSsh(); } catch (e) { logger.debug?.(`[ServerSecurity] ssh: ${e.message}`); }
};

const statusLogSistem = () => Object.entries(SYSTEM_LOGS).map(([key, berkas]) => {
  let terbaca = false;
  try { fs.accessSync(berkas, fs.constants.R_OK); terbaca = true; } catch { /* tidak ada/izin */ }
  return { key, path: berkas, readable: terbaca };
});

/* ─────────────────────────── Ringkasan ─────────────────────────── */

const RENTANG = { '1h': 1, '24h': 24, '7d': 168, '30d': 720 };

const getSummary = async (rentang = '24h') => {
  await flush();
  await store.ensureTables();
  const jam = RENTANG[rentang] || 24;
  const bucket = jam <= 24 ? 3600 : 86400;
  const where = 'created_at >= DATE_SUB(NOW(), INTERVAL ? HOUR)';

  const [perTipe, perSeverity, perSumber, timeline, topIp, topPath, total] = await Promise.all([
    store.query(`SELECT event_type, COUNT(*) AS n, COUNT(DISTINCT ip_address) AS ips FROM server_security_events WHERE ${where} GROUP BY event_type ORDER BY n DESC`, jam),
    store.query(`SELECT severity, COUNT(*) AS n FROM server_security_events WHERE ${where} GROUP BY severity`, jam),
    store.query(`SELECT source, COUNT(*) AS n FROM server_security_events WHERE ${where} GROUP BY source`, jam),
    store.query(
      `SELECT FLOOR(UNIX_TIMESTAMP(created_at) / ?) * ? * 1000 AS t,
              SUM(severity = 'critical') AS critical, SUM(severity = 'high') AS high,
              SUM(severity = 'medium') AS medium, SUM(severity = 'low') AS low
         FROM server_security_events WHERE ${where} GROUP BY t ORDER BY t`,
      bucket, bucket, jam,
    ),
    store.query(
      `SELECT ip_address, COUNT(*) AS n, MAX(created_at) AS last_seen, MIN(created_at) AS first_seen,
              SUM(severity IN ('critical','high')) AS serius,
              GROUP_CONCAT(DISTINCT event_type ORDER BY event_type SEPARATOR ',') AS types,
              GROUP_CONCAT(DISTINCT source SEPARATOR ',') AS sources
         FROM server_security_events WHERE ${where} AND event_type NOT IN ('blocked_request')
        GROUP BY ip_address ORDER BY serius DESC, n DESC LIMIT 20`,
      jam,
    ),
    store.query(
      `SELECT path, COUNT(*) AS n FROM server_security_events
        WHERE ${where} AND path IS NOT NULL AND event_type NOT IN ('login_failed','blocked_request')
        GROUP BY path ORDER BY n DESC LIMIT 15`,
      jam,
    ),
    store.query(`SELECT COUNT(*) AS n, COUNT(DISTINCT ip_address) AS ips FROM server_security_events WHERE ${where}`, jam),
  ]);

  const sev = Object.fromEntries(perSeverity.map((r) => [r.severity, r.n]));
  const jamIni = hitunganTipe.filter((x) => x.t >= Date.now() - 3600000);
  const seriusJamIni = jamIni.filter((x) => x.severity === 'critical' || x.severity === 'high').length;
  let level = 'aman';
  if (seriusJamIni >= 20 || jamIni.length >= 300) level = 'kritis';
  else if (seriusJamIni >= 5 || jamIni.length >= 80) level = 'tinggi';
  else if (jamIni.length >= 10) level = 'waspada';

  return {
    range: rentang,
    threat_level: level,
    total: total[0]?.n || 0,
    unique_ips: total[0]?.ips || 0,
    last_hour: jamIni.length,
    by_severity: { critical: sev.critical || 0, high: sev.high || 0, medium: sev.medium || 0, low: sev.low || 0 },
    by_source: Object.fromEntries(perSumber.map((r) => [r.source, r.n])),
    by_type: perTipe.map((r) => ({ ...r, ...EVENT_TYPES[r.event_type] })),
    timeline,
    top_ips: topIp.map((r) => ({
      ...r,
      types: r.types ? r.types.split(',') : [],
      sources: r.sources ? r.sources.split(',') : [],
      blocked: !!isBlocked(r.ip_address),
      private: ipPrivat(r.ip_address),
      score: skorSaatIni(bersihkanIp(r.ip_address)),
    })),
    top_paths: topPath,
    blocked_count: blokir.size,
    event_types: EVENT_TYPES,
    system_logs: statusLogSistem(),
  };
};

const listEvents = async ({ page = 1, limit = 50, type, severity, ip, source, q, range = '7d' }) => {
  await flush();
  await store.ensureTables();
  const syarat = ['created_at >= DATE_SUB(NOW(), INTERVAL ? HOUR)'];
  const nilai = [RENTANG[range] || 168];
  if (type) { syarat.push('event_type = ?'); nilai.push(type); }
  if (severity) { syarat.push('severity = ?'); nilai.push(severity); }
  if (source) { syarat.push('source = ?'); nilai.push(source); }
  if (ip) { syarat.push('ip_address = ?'); nilai.push(ip); }
  if (q) { syarat.push('(path LIKE ? OR detail LIKE ? OR user_agent LIKE ?)'); nilai.push(`%${q}%`, `%${q}%`, `%${q}%`); }
  const where = syarat.join(' AND ');
  const lim = Math.min(200, Math.max(1, Number(limit) || 50));
  const off = (Math.max(1, Number(page) || 1) - 1) * lim;
  const [data, jumlah] = await Promise.all([
    store.query(`SELECT * FROM server_security_events WHERE ${where} ORDER BY id DESC LIMIT ${lim} OFFSET ${off}`, ...nilai),
    store.query(`SELECT COUNT(*) AS n FROM server_security_events WHERE ${where}`, ...nilai),
  ]);
  return {
    data: data.map((e) => ({ ...e, label: EVENT_TYPES[e.event_type]?.label || e.event_type, blocked: !!e.blocked })),
    total: jumlah[0]?.n || 0,
    page: Number(page) || 1,
    limit: lim,
  };
};

const bersihkanLama = async () => {
  try {
    const hari = Math.max(1, Number(store.getConfigSync().security.retention_days) || 30);
    await store.execute(`DELETE FROM server_security_events WHERE created_at < DATE_SUB(NOW(), INTERVAL ${hari} DAY)`);
    await store.execute('DELETE FROM server_ip_blocklist WHERE auto = 1 AND expires_at IS NOT NULL AND expires_at < DATE_SUB(NOW(), INTERVAL 7 DAY)');
  } catch { /* tabel belum siap */ }
};

const hapusSemuaKejadian = async () => {
  await store.execute('TRUNCATE TABLE server_security_events');
  hitunganTipe.length = 0;
};

const start = () => {
  if (started) return;
  started = true;
  store.getConfig().catch(() => {});
  muatBlokir();
  setInterval(() => flush(), 5000).unref();
  setInterval(() => muatBlokir(), 60 * 1000).unref();
  setInterval(() => pindaiLogSistem(), 60 * 1000).unref();
  setInterval(() => bersihkanLama(), 6 * 60 * 60 * 1000).unref();
  setInterval(() => {
    const batas = Date.now() - 3600000;
    while (hitunganTipe.length && hitunganTipe[0].t < batas) hitunganTipe.shift();
    // Pangkas pelacak IP yang sudah diam supaya memori tidak tumbuh terus.
    for (const [ip, b] of banjir) {
      if (!b.unauth.length && !b.nf.length && !b.login.length) banjir.delete(ip);
    }
    for (const ip of skorIp.keys()) skorSaatIni(ip) || skorIp.delete(ip);
  }, 5 * 60 * 1000).unref();
  setTimeout(() => { bersihkanLama(); pindaiLogSistem(); }, 15000).unref();
};

module.exports = {
  start,
  inspect,
  recordEvent,
  onResponse,
  onLoginFailed,
  isBlocked,
  catatHitBlokir,
  blockIp,
  unblockIp,
  listBlocklist,
  getSummary,
  listEvents,
  hapusSemuaKejadian,
  ipPrivat,
  diWhitelist,
  bersihkanIp,
  ambilHitunganSnapshot: () => { const n = hitunganSnapshot; hitunganSnapshot = 0; return n; },
};
