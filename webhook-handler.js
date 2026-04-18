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

const PORT = 9000;
const SECRET = 'dpmd-webhook-secret-2026';
const LOG_FILE = '/var/www/webhook/webhook.log';
const MAX_LOG_LINES = 100;
const CMD_TIMEOUT = 300_000; // 5 menit per command
const MAX_BUFFER = 10 * 1024 * 1024; // 10 MB stdout/stderr
const NODE_BIN = '/root/.local/share/fnm/node-versions/v20.20.0/installation/bin';

const EXEC_ENV = {
  ...process.env,
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
      // Auto-import RT/RW Excel data if files exist, then remove them from repo
      `/bin/bash -c 'if ls /var/www/backend/data/datartrw/*.xlsx 1>/dev/null 2>&1; then ${NODE_BIN}/node /var/www/backend/scripts/import-rtrw-from-excel.js && rm -f /var/www/backend/data/datartrw/*.xlsx && echo "RT/RW import done, Excel files removed"; else echo "No RT/RW Excel files to import"; fi'`,
      '/bin/cp -f /var/www/backend/nginx-dpmdbogorkab.conf /etc/nginx/sites-available/dpmdbogorkab.id',
      '/usr/sbin/nginx -t && /usr/sbin/nginx -s reload',
      '/bin/cp -f /var/www/backend/webhook-handler.js /var/www/webhook/webhook-handler.js',
      // Restart backend using ecosystem config (preserves max_memory_restart)
      `${NODE_BIN}/pm2 delete dpmd-backend 2>/dev/null; ${NODE_BIN}/pm2 start /var/www/backend/ecosystem.config.js`,
      // Restart webhook: spawn background process then exit this command immediately
      `/bin/bash -c '(sleep 3 && ${NODE_BIN}/pm2 restart github-webhook --update-env) &'`,
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
        if (stdout) log(`  stdout: ${stdout.substring(0, 500)}`);
        if (stderr) log(`  stderr: ${stderr.substring(0, 500)}`);
        if (error) log(`  error (continuing): ${error.message}`);
        results.push({ cmd, ok: !error });
        next();
      });
    }

    next();
  });
}

// ─── HTTP Helpers ────────────────────────────────────────────────────────────────

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
      jsonResponse(res, 200, { processes, deploying: Object.keys(deployLock) });
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

  // Respond dulu, deploy secara async
  jsonResponse(res, 200, { deploying: true, repo: repoName });

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
