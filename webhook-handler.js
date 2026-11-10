/**
 * GitHub Webhook Handler - DPMD Bogor
 *
 * Menerima webhook push dari GitHub, lalu auto-deploy backend & frontend.
 * Berjalan sebagai service terpisah di VPS (PM2 process: github-webhook).
 *
 * Endpoint:
 *   POST /webhook          - GitHub webhook receiver
 *   GET  /webhook/status   - PM2 process status + deployment lock info
 *   GET  /webhook/logs     - 100 baris terakhir log deployment
 *
 * Setup di VPS:
 *   File ini di-copy otomatis ke /var/www/webhook/webhook-handler.js saat deploy backend.
 *   pm2 start /var/www/webhook/webhook-handler.js --name github-webhook
 *
 * Nginx proxy (sudah di nginx-dpmdbogorkab.conf):
 *   location /webhook { proxy_pass http://127.0.0.1:9000; }
 */

const http = require('http');
const crypto = require('crypto');
const { exec } = require('child_process');
const fs = require('fs');

// ─── Konfigurasi ────────────────────────────────────────────────────────────────

const PORT = Number(process.env.WEBHOOK_PORT) || 9000;
const SECRET = 'dpmd-webhook-secret-2026';
const LOG_FILE = process.env.WEBHOOK_LOG_FILE || '/var/www/webhook/webhook.log';
const PIN_FILE = process.env.WEBHOOK_PIN_FILE || '/var/www/webhook/pins.json';
const MAX_LOG_LINES = 100;
const CMD_TIMEOUT = 300_000; // 5 menit per command
const MAX_BUFFER = 10 * 1024 * 1024; // 10 MB stdout/stderr
const NODE_BIN = '/root/.local/share/fnm/node-versions/v20.20.0/installation/bin';

const { max_memory_restart: _mmr, ...cleanEnv } = process.env;
const EXEC_ENV = {
  ...cleanEnv,
  PATH: `/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:${NODE_BIN}`,
  HOME: '/root',
  SHELL: '/bin/bash',
};

// ─── Repository Config ──────────────────────────────────────────────────────────

const REPOS = {
  'dpmd-fahri-express': {
    path: '/var/www/backend',
    branch: 'main',
    commands: [
      '/usr/bin/git fetch origin',
      '/usr/bin/git reset --hard origin/main',
      `${NODE_BIN}/npm install --production`,
      `${NODE_BIN}/npx prisma generate`,
      `${NODE_BIN}/node /var/www/backend/database-express/auto-migrate.js`,
      // Akun bawaan yang tidak bisa dibuat lewat SQL (sandinya perlu di-hash):
      // dinas pelihat BPKAD & Inspektorat. Skripnya idempoten — kalau akunnya
      // sudah ada, ia hanya memastikan tautan dinasnya benar lalu keluar.
      `${NODE_BIN}/node /var/www/backend/scripts/seed-dinas-pelihat.js`,
      // Auto-import RT/RW Excel data if files exist, then remove them from repo
      `/bin/bash -c 'if ls /var/www/backend/data/datartrw/*.xlsx 1>/dev/null 2>&1; then ${NODE_BIN}/node /var/www/backend/scripts/import-rtrw-from-excel.js && rm -f /var/www/backend/data/datartrw/*.xlsx && echo "RT/RW import done, Excel files removed"; else echo "No RT/RW Excel files to import"; fi'`,
      '/bin/cp -f /var/www/backend/nginx-dpmdbogorkab.conf /etc/nginx/sites-available/dpmdbogorkab.id',
      '/usr/sbin/nginx -t && /usr/sbin/nginx -s reload',
      '/bin/cp -f /var/www/backend/webhook-handler.js /var/www/webhook/webhook-handler.js',
      // Restart backend using ecosystem config (preserves max_memory_restart)
      `${NODE_BIN}/pm2 delete dpmd-backend 2>/dev/null; ${NODE_BIN}/pm2 start /var/www/backend/ecosystem.config.js`,
      // Layanan deteksi Smart CCTV (cctv-ai/): hanya bila sudah dipasang lewat
      // cctv-ai/pasang.sh — dependensinya diperbarui lalu layanannya direstart.
      `/bin/bash -c 'if [ -f /etc/systemd/system/dpmd-cctv-ai.service ]; then cd /var/www/backend/cctv-ai && ONNXRUNTIME_NODE_INSTALL=skip PATH=${NODE_BIN}:$PATH ${NODE_BIN}/npm install --omit=dev --no-audit --no-fund && systemctl restart dpmd-cctv-ai && echo "cctv-ai direstart"; else echo "cctv-ai belum dipasang"; fi'`,
    ],
  },
  'dpmd-frontend': {
    path: '/var/www/frontend',
    branch: 'main',
    commands: [
      '/usr/bin/git fetch origin',
      '/usr/bin/git reset --hard origin/main',
      `${NODE_BIN}/npm install --include=dev`,
      `${NODE_BIN}/npm run build`,
    ],
  },
};

// ─── Deployment Lock ─────────────────────────────────────────────────────────────

const deployLock = {};
let deploymentQueue = Promise.resolve();
let queuedDeployments = 0;
let restartWebhookAfterQueue = false;

// ─── Logging ─────────────────────────────────────────────────────────────────────

function log(message) {
  const line = `[${new Date().toISOString()}] ${message}\n`;
  process.stdout.write(line);
  try {
    fs.appendFileSync(LOG_FILE, line);
  } catch {
    // Log file belum ada / permission — abaikan
  }
}

// ─── Pin Rollback ────────────────────────────────────────────────────────────────

function bacaPin() { try { return JSON.parse(fs.readFileSync(PIN_FILE, 'utf8')) || {}; } catch { return {}; } }
function tulisPin(pins) { try { fs.writeFileSync(PIN_FILE, JSON.stringify(pins, null, 2)); } catch (e) { log(`Gagal menulis ${PIN_FILE}: ${e.message}`); } }

// Panel (backend di mesin yang sama) memanggil 127.0.0.1:9000 langsung tanpa
// header proxy; permintaan yang lewat nginx selalu membawa X-Forwarded-For.
function dariLokal(req) {
  const a = String(req.socket.remoteAddress || '').replace(/^::ffff:/, '');
  return (a === '127.0.0.1' || a === '::1') && !req.headers['x-forwarded-for'] && !req.headers['x-real-ip'];
}

// Rollback: reset ke commit pilihan, dan JANGAN salin webhook-handler.js lama
// supaya handler yang paham rollback & pin tetap terpasang.
function configRollback(config, sha) {
  return { ...config, commands: config.commands
    .filter((c) => !c.includes('webhook-handler.js'))
    .map((c) => (c === '/usr/bin/git reset --hard origin/main' ? `/usr/bin/git reset --hard ${sha}` : c)) };
}

// ─── Signature Verification ──────────────────────────────────────────────────────

function verifySignature(payload, signature) {
  if (!signature) return false;
  const expected = 'sha256=' + crypto.createHmac('sha256', SECRET).update(payload).digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  } catch {
    return false;
  }
}

// ─── Sequential Command Runner ───────────────────────────────────────────────────

/**
 * Potong keluaran panjang dari KEDUA ujung, bukan hanya awalnya.
 *
 * Sebelumnya dipakai `stdout.substring(0, 500)`. Masalahnya, satu-satunya bagian
 * yang menyatakan BERHASIL atau GAGAL selalu ada di AKHIR keluaran: auto-migrate
 * mencetak ratusan baris "Skipped (already ran)" sebelum menyebut migrasi yang
 * baru dijalankan, dan ringkasannya ("Ran N new migration(s)" / "❌ Failed")
 * paling belakang. Akibatnya hasil migrasi tidak pernah terlihat di log — deploy
 * tetap dilaporkan "11/11 OK" walau sebuah ALTER TABLE gagal, karena
 * auto-migrate memang sengaja lanjut ke migrasi berikutnya dan keluar dengan
 * kode 0.
 */
const AWAL_LOG = 500;
const AKHIR_LOG = 1200;

function potong(teks) {
  const t = String(teks);
  if (t.length <= AWAL_LOG + AKHIR_LOG) return t;
  const dibuang = t.length - AWAL_LOG - AKHIR_LOG;
  return `${t.slice(0, AWAL_LOG)}\n  …[${dibuang} karakter di tengah dilewati]…\n${t.slice(-AKHIR_LOG)}`;
}

function runCommands(commands, cwd) {
  return new Promise((resolve) => {
    const results = [];
    let i = 0;

    function next() {
      if (i >= commands.length) return resolve(results);

      const cmd = commands[i];
      const step = `[${i + 1}/${commands.length}]`;
      i++;

      log(`${step} ${cmd}`);

      exec(cmd, {
        cwd,
        maxBuffer: MAX_BUFFER,
        env: EXEC_ENV,
        shell: '/bin/bash',
        timeout: CMD_TIMEOUT,
      }, (error, stdout, stderr) => {
        if (stdout) log(`  stdout: ${potong(stdout)}`);
        if (stderr) log(`  stderr: ${potong(stderr)}`);
        if (error) log(`  error (continuing): ${error.message}`);
        results.push({ cmd, ok: !error });
        next();
      });
    }

    next();
  });
}

// ─── HTTP Helpers ────────────────────────────────────────────────────────────────

async function runDeployment(repoName, config) {
  log(`=== Deployment START: ${repoName} ===`);

  try {
    const results = await runCommands(config.commands, config.path);
    const failed = results.filter((r) => !r.ok).length;
    log(`=== Deployment END: ${repoName} — ${results.length - failed}/${results.length} OK ===`);

    if (repoName === 'dpmd-fahri-express') {
      restartWebhookAfterQueue = true;
      log('Webhook restart scheduled after deployment queue is empty');
    }
  } catch (err) {
    log(`=== Deployment FAILED: ${repoName} — ${err.message} ===`);
  }
}

function enqueueDeployment(repoName, config) {
  deployLock[repoName] = Date.now();
  queuedDeployments++;

  deploymentQueue = deploymentQueue
    .catch((err) => {
      log(`Deployment queue recovered after error: ${err.message}`);
    })
    .then(async () => {
      try {
        await runDeployment(repoName, config);
      } finally {
        delete deployLock[repoName];
        queuedDeployments = Math.max(0, queuedDeployments - 1);

        if (queuedDeployments === 0 && restartWebhookAfterQueue) {
          restartWebhookAfterQueue = false;
          log('Restarting github-webhook to load updated webhook-handler.js...');
          setTimeout(() => process.exit(0), 1000); // pm2 auto-restart
        }
      }
    });

  return deploymentQueue;
}

function jsonResponse(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

function textResponse(res, status, text) {
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end(text);
}

// ─── Route: GET /webhook/logs ────────────────────────────────────────────────────

function handleLogs(req, res) {
  try {
    const content = fs.readFileSync(LOG_FILE, 'utf-8');
    const lines = content.trim().split('\n').slice(-MAX_LOG_LINES).join('\n');
    textResponse(res, 200, lines);
  } catch {
    textResponse(res, 200, 'No logs found');
  }
}

// ─── Route: GET /webhook/status ──────────────────────────────────────────────────

function handleStatus(req, res) {
  exec(`${NODE_BIN}/pm2 jlist`, { env: EXEC_ENV }, (err, stdout) => {
    if (err) return jsonResponse(res, 500, { error: err.message });

    try {
      const list = JSON.parse(stdout);
      const processes = list.map((p) => ({
        name: p.name,
        status: p.pm2_env?.status,
        restarts: p.pm2_env?.restart_time,
        uptime: p.pm2_env?.pm_uptime
          ? new Date(p.pm2_env.pm_uptime).toISOString()
          : null,
      }));
      jsonResponse(res, 200, { processes, deploying: Object.keys(deployLock), pins: bacaPin() });
    } catch {
      textResponse(res, 200, stdout.substring(0, 2000));
    }
  });
}

// ─── Route: POST /webhook ────────────────────────────────────────────────────────

async function handleWebhook(req, res) {
  // Kumpulkan body
  const body = await new Promise((resolve) => {
    let data = '';
    req.on('data', (chunk) => (data += chunk));
    req.on('end', () => resolve(data));
  });

  // Verifikasi signature
  if (!verifySignature(body, req.headers['x-hub-signature-256'])) {
    log('Rejected: invalid signature');
    return textResponse(res, 401, 'Unauthorized');
  }

  // Parse payload
  let payload;
  try {
    payload = JSON.parse(body);
  } catch {
    return textResponse(res, 400, 'Bad Request');
  }

  // Ping event
  if (req.headers['x-github-event'] === 'ping') {
    log('Ping received — webhook OK');
    return textResponse(res, 200, 'Pong');
  }

  const repoName = payload.repository?.name;
  const branch = payload.ref?.replace('refs/heads/', '');
  const pusher = payload.pusher?.name || 'unknown';

  log(`Push received — repo: ${repoName}, branch: ${branch}, by: ${pusher}`);

  // Cek konfigurasi repo
  const config = REPOS[repoName];
  if (!config) {
    log(`Ignored: repo "${repoName}" not configured`);
    return jsonResponse(res, 200, { ignored: true, reason: 'repo not configured' });
  }

  if (branch !== config.branch) {
    log(`Ignored: branch "${branch}" (expected "${config.branch}")`);
    return jsonResponse(res, 200, { ignored: true, reason: 'branch mismatch' });
  }

  // Deployment lock — skip jika sedang deploy repo yang sama
  if (deployLock[repoName]) {
    log(`Skipped: deployment already in progress for ${repoName}`);
    return jsonResponse(res, 200, { skipped: true, reason: 'deployment in progress' });
  }

  const pins = bacaPin();
  const rollbackTo = payload.rollback_to;
  let jalankan = config;
  if (rollbackTo !== undefined) {
    if (!dariLokal(req)) { log(`Rejected: rollback dari luar mesin (by: ${pusher})`); return jsonResponse(res, 403, { error: 'rollback hanya dari panel lokal' }); }
    if (!/^[0-9a-f]{40}$/.test(String(rollbackTo))) return jsonResponse(res, 400, { error: 'sha tidak valid' });
    jalankan = configRollback(config, rollbackTo);
    pins[repoName] = { sha: rollbackTo, at: new Date().toISOString(), by: pusher };
    tulisPin(pins);
    log(`ROLLBACK ${repoName} ke ${rollbackTo} oleh ${pusher}`);
  } else if (pins[repoName]) {
    // Cron deploy-guard melihat HEAD ≠ origin/main lalu mengetuk; abaikan selama pin aktif.
    if (/^deploy-guard/i.test(pusher)) { log(`Skipped: ${repoName} sedang di-rollback ke ${String(pins[repoName].sha).slice(0, 7)}`); return jsonResponse(res, 200, { skipped: true, reason: 'pinned' }); }
    delete pins[repoName]; tulisPin(pins); log(`Pin rollback ${repoName} dilepas oleh ${pusher}`);
  }

  // Respond dulu, deploy secara async
  jsonResponse(res, 200, {
    queued: true,
    repo: repoName,
    rollback: rollbackTo !== undefined,
    queue_size: queuedDeployments + 1,
  });

  enqueueDeployment(repoName, jalankan);
  return;

  // Jalankan deployment
  deployLock[repoName] = Date.now();
  log(`=== Deployment START: ${repoName} ===`);

  try {
    const results = await runCommands(config.commands, config.path);
    const failed = results.filter((r) => !r.ok).length;
    log(`=== Deployment END: ${repoName} — ${results.length - failed}/${results.length} OK ===`);

    // Self-restart webhook handler jika webhook-handler.js berubah (agar load commands terbaru)
    if (repoName === 'dpmd-fahri-express') {
      log('Restarting github-webhook to load updated webhook-handler.js...');
      setTimeout(() => process.exit(0), 1000); // pm2 auto-restart
    }
  } catch (err) {
    log(`=== Deployment FAILED: ${repoName} — ${err.message} ===`);
  } finally {
    delete deployLock[repoName];
  }
}

// ─── Server ──────────────────────────────────────────────────────────────────────

const server = http.createServer((req, res) => {
  const { method, url } = req;

  if (method === 'GET' && url === '/webhook/logs') return handleLogs(req, res);
  if (method === 'GET' && url === '/webhook/status') return handleStatus(req, res);
  if (method === 'POST' && url === '/webhook') return handleWebhook(req, res);

  textResponse(res, 404, 'Not Found');
});

server.listen(PORT, '127.0.0.1', () => {
  log(`Webhook handler listening on 127.0.0.1:${PORT}`);
});
