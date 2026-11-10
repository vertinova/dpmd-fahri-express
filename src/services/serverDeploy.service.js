/**
 * Deploy & rollback dari panel Manajemen Server.
 *
 * Status repo dibaca langsung lewat git di server; deploy/rollback sendiri
 * TIDAK dikerjakan di sini — panel mengetuk webhook-handler (127.0.0.1:9000)
 * dengan payload push bertanda tangan, sama seperti GitHub dan deploy-guard,
 * sehingga lock, antrean, dan log-nya tetap satu jalur.
 *
 * Sengaja tanpa prisma.
 */

const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const { DEPLOY_REPOS, BACKEND_ROOT } = require('../config/serverManagement');

const WEBHOOK_URL = process.env.DEPLOY_WEBHOOK_URL || 'http://127.0.0.1:9000';
const PIN_FILE = process.env.DEPLOY_PIN_FILE || '/var/www/webhook/pins.json';
const FORMAT_LOG = '--format=%H%x1f%h%x1f%s%x1f%an%x1f%cI';

const galat = (pesan, status) => Object.assign(new Error(pesan), { status });

const git = (dir, args, timeout = 15000) => new Promise((resolve, reject) => {
  execFile(process.env.DEPLOY_GIT || 'git', ['-C', dir, ...args], {
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    maxBuffer: 4 * 1024 * 1024,
    timeout,
    windowsHide: true,
  }, (err, stdout, stderr) => {
    if (err) reject(Object.assign(new Error(String(stderr || err.message).trim()), { kode: err.code }));
    else resolve(String(stdout).trim());
  });
});

const uraiCommit = (baris) => {
  const [sha, short, subject, author, date] = baris.split('\x1f');
  return { sha, short, subject, author, date };
};

const infoRepo = async (r) => {
  const dasar = { key: r.key, label: r.label, dir: r.dir };
  if (!fs.existsSync(path.join(r.dir, '.git'))) {
    return { ...dasar, available: false, error: 'Repo tidak ditemukan di server ini', head: null, origin: null, behind: 0, ahead: 0, pinned: null, commits: [] };
  }
  try {
    const head = uraiCommit(await git(r.dir, ['log', '-1', FORMAT_LOG, 'HEAD']));
    const originSha = await git(r.dir, ['rev-parse', 'origin/main']);
    const originShort = await git(r.dir, ['rev-parse', '--short', 'origin/main']);
    const behind = Number(await git(r.dir, ['rev-list', '--count', 'HEAD..origin/main'])) || 0;
    const ahead = Number(await git(r.dir, ['rev-list', '--count', 'origin/main..HEAD'])) || 0;
    const log = await git(r.dir, ['log', 'origin/main', '-n', '30', FORMAT_LOG]);
    const commits = log ? log.split('\n').map((b) => ({ ...uraiCommit(b) })).map((c) => ({ ...c, is_head: c.sha === head.sha })) : [];
    return { ...dasar, available: true, error: null, head, origin: { sha: originSha, short: originShort }, behind, ahead, pinned: null, commits };
  } catch (e) {
    return { ...dasar, available: true, error: e.message, head: null, origin: null, behind: 0, ahead: 0, pinned: null, commits: [] };
  }
};

const ambilTeks = (jalur) => new Promise((resolve, reject) => {
  const req = http.get(`${WEBHOOK_URL}${jalur}`, { timeout: 4000 }, (res) => {
    let data = '';
    res.setEncoding('utf8');
    res.on('data', (d) => { data += d; });
    res.on('end', () => (res.statusCode >= 400 ? reject(new Error(`Handler membalas ${res.statusCode}`)) : resolve(data)));
  });
  req.on('timeout', () => req.destroy(new Error('Handler deploy tidak merespons (timeout)')));
  req.on('error', (e) => reject(new Error(`Handler deploy tidak terjangkau: ${e.message}`)));
});

const ambilHandler = async () => {
  const hasil = { reachable: false, error: null, processes: [], deploying: [], pins: null, log: [] };
  try {
    const [status, log] = await Promise.all([ambilTeks('/webhook/status'), ambilTeks('/webhook/logs').catch(() => '')]);
    const j = JSON.parse(status);
    hasil.reachable = true;
    hasil.processes = j.processes || [];
    hasil.deploying = j.deploying || [];
    hasil.pins = j.pins || null;
    hasil.log = String(log).split('\n').slice(-100);
  } catch (e) {
    hasil.error = e.message;
  }
  if (!hasil.pins) {
    // Handler versi lama belum melaporkan pin: baca berkasnya langsung.
    try { hasil.pins = JSON.parse(fs.readFileSync(PIN_FILE, 'utf8')) || {}; } catch { hasil.pins = {}; }
  }
  return hasil;
};

const getStatus = async () => {
  const [h, repos] = await Promise.all([ambilHandler(), Promise.all(DEPLOY_REPOS.map(infoRepo))]);
  const { log, ...handler } = h;
  return { handler, repos: repos.map((r) => ({ ...r, pinned: handler.pins[r.key] || null })), log };
};

const fetchSemua = async () => {
  await Promise.all(DEPLOY_REPOS.filter((r) => fs.existsSync(path.join(r.dir, '.git')))
    .map((r) => git(r.dir, ['fetch', 'origin', '--quiet'], 60000).catch(() => {})));
  return getStatus();
};

const ambilRahasia = () => {
  if (process.env.WEBHOOK_SECRET) return process.env.WEBHOOK_SECRET;
  try {
    const isi = fs.readFileSync(path.join(BACKEND_ROOT, 'webhook-handler.js'), 'utf8');
    const m = isi.match(/const\s+SECRET\s*=\s*['"]([^'"]+)['"]/);
    if (m) return m[1];
  } catch { /* jatuh ke galat di bawah */ }
  throw galat('Rahasia webhook tidak ditemukan (set WEBHOOK_SECRET atau pastikan webhook-handler.js ada).', 500);
};

const kirimWebhook = (isi, tandatangan) => new Promise((resolve, reject) => {
  const req = http.request(`${WEBHOOK_URL}/webhook`, {
    method: 'POST',
    timeout: 20000,
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(isi),
      'X-GitHub-Event': 'push',
      'X-Hub-Signature-256': tandatangan,
    },
  }, (res) => {
    let data = '';
    res.setEncoding('utf8');
    res.on('data', (d) => { data += d; });
    res.on('end', () => {
      if (res.statusCode >= 400) return reject(galat(`Handler deploy menolak (${res.statusCode}): ${data.slice(0, 200)}`, 502));
      try { resolve(JSON.parse(data)); } catch { resolve({ raw: data.slice(0, 200) }); }
    });
  });
  req.on('timeout', () => req.destroy(new Error('Handler deploy tidak merespons (timeout)')));
  req.on('error', (e) => reject(galat(`Handler deploy tidak terjangkau: ${e.message}`, 502)));
  req.write(isi);
  req.end();
});

const picu = async (repoKey, { rollbackTo, oleh } = {}) => {
  const r = DEPLOY_REPOS.find((x) => x.key === repoKey);
  if (!r) throw galat('Repo tidak dikenal', 404);

  let shaPenuh = null;
  if (rollbackTo) {
    const sha = String(rollbackTo);
    if (!/^[0-9a-f]{7,40}$/i.test(sha)) throw galat('SHA commit tidak valid', 400);
    try { await git(r.dir, ['cat-file', '-e', `${sha}^{commit}`]); } catch { throw galat('Commit tidak ditemukan', 400); }
    try { await git(r.dir, ['merge-base', '--is-ancestor', sha, 'origin/main']); } catch { throw galat('Commit bukan bagian riwayat main', 400); }
    shaPenuh = await git(r.dir, ['rev-parse', sha]);
  }

  const isi = JSON.stringify({
    ref: 'refs/heads/main',
    repository: { name: repoKey },
    pusher: { name: `panel: ${oleh}` },
    ...(shaPenuh ? { rollback_to: shaPenuh } : {}),
  });
  const tandatangan = `sha256=${crypto.createHmac('sha256', ambilRahasia()).update(isi).digest('hex')}`;
  const balasan = await kirimWebhook(isi, tandatangan);
  return shaPenuh ? { ...balasan, rollback: true, sha: shaPenuh } : balasan;
};

module.exports = { getStatus, fetchSemua, picu };
