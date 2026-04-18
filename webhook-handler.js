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
      '/bin/cp -f /var/www/backend/nginx-dpmdbogorkab.conf /etc/nginx/sites-available/dpmdbogorkab.id',
      '/usr/sbin/nginx -t && /usr/sbin/nginx -s reload',
      '/bin/cp -f /var/www/backend/webhook-handler.js /var/www/webhook/webhook-handler.js',
      // Restart backend; fallback start jika process belum ada
      `${NODE_BIN}/pm2 restart dpmd-backend --update-env || ${NODE_BIN}/pm2 start /var/www/backend/src/server.js --name dpmd-backend`,
      // JANGAN restart github-webhook di sini — akan kill proses deploy sendiri
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
const http = require('http');
const crypto = require('crypto');
const { exec } = require('child_process');
const fs = require('fs');

const PORT = 9000;
const SECRET = 'dpmd-webhook-secret-2026';
const LOG_FILE = '/var/www/webhook/webhook.log';
const NODE_BIN = '/root/.local/share/fnm/node-versions/v20.20.0/installation/bin';

// Deployment lock - prevent concurrent deployments
const deployLock = {};

const REPOS = {
  'dpmd-fahri-express': {
    path: '/var/www/backend',
    branch: 'main',
    commands: [
      '/usr/bin/git fetch origin',
      '/usr/bin/git reset --hard origin/main',
      `${NODE_BIN}/npm install --production || true`,
      `${NODE_BIN}/npx prisma generate || true`,
      `${NODE_BIN}/node /var/www/backend/database-express/auto-migrate.js || true`,
      '/bin/cp -f /var/www/backend/nginx-dpmdbogorkab.conf /etc/nginx/sites-available/dpmdbogorkab.id || true',
      '/usr/sbin/nginx -t && /usr/sbin/nginx -s reload || true',
      '/bin/cp -f /var/www/backend/webhook-handler.js /var/www/webhook/webhook-handler.js || true',
      // Restart backend: try restart first (works if process exists), then start as fallback
      `${NODE_BIN}/pm2 restart dpmd-backend --update-env || ${NODE_BIN}/pm2 start /var/www/backend/src/server.js --name dpmd-backend`
      // NOTE: Do NOT restart github-webhook here - it kills the current deployment process
    ]
  },
  'dpmd-frontend': {
    path: '/var/www/frontend',
    branch: 'main',
    commands: [
      '/usr/bin/git fetch origin',
      '/usr/bin/git reset --hard origin/main',
      `${NODE_BIN}/npm install --include=dev || true`,
      `${NODE_BIN}/npm run build`
    ]
  }
};

function log(message) {
  const timestamp = new Date().toISOString();
  const logMessage = '[' + timestamp + '] ' + message + '\n';
  console.log(logMessage.trim());
  fs.appendFileSync(LOG_FILE, logMessage);
}

function verifySignature(payload, signature) {
  if (!signature) return false;
  const hmac = crypto.createHmac('sha256', SECRET);
  const digest = 'sha256=' + hmac.update(payload).digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(digest));
  } catch (e) {
    return false;
  }
}

// Env untuk memastikan shell dan node tersedia
const execEnv = {
  ...process.env,
  PATH: '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:' + NODE_BIN,
  HOME: '/root',
  SHELL: '/bin/bash'
};

function executeCommands(commands, cwd, callback) {
  let index = 0;
  function next() {
    if (index >= commands.length) {
      callback(null, 'All commands completed');
      return;
    }
    const cmd = commands[index++];
    log('[' + index + '/' + commands.length + '] Executing: ' + cmd);
    exec(cmd, { cwd, maxBuffer: 10 * 1024 * 1024, env: execEnv, shell: '/bin/bash', timeout: 180000 }, (error, stdout, stderr) => {
      if (stdout) log('stdout: ' + stdout.substring(0, 500));
      if (stderr) log('stderr: ' + stderr.substring(0, 500));
      if (error) {
        log('Error (continuing): ' + error.message);
      }
      next();
    });
  }
  next();
}

const server = http.createServer((req, res) => {
  // GET /webhook/logs - view last deployment logs
  if (req.method === 'GET' && req.url === '/webhook/logs') {
    try {
      const logs = fs.readFileSync(LOG_FILE, 'utf-8');
      const lines = logs.trim().split('\n').slice(-50).join('\n');
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end(lines);
    } catch (e) {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('No logs found');
    }
    return;
  }

  // GET /webhook/status - check pm2 status
  if (req.method === 'GET' && req.url === '/webhook/status') {
    exec(NODE_BIN + '/pm2 jlist', { env: execEnv }, (err, stdout) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      if (err) { res.end(JSON.stringify({ error: err.message })); return; }
      try {
        const list = JSON.parse(stdout);
        const summary = list.map(p => ({ name: p.name, status: p.pm2_env?.status, restarts: p.pm2_env?.restart_time, uptime: p.pm2_env?.pm_uptime }));
        res.end(JSON.stringify({ processes: summary, deployLocks: Object.keys(deployLock) }));
      } catch (e) { res.end(stdout.substring(0, 2000)); }
    });
    return;
  }

  // GET /webhook/restart-backend - manual restart endpoint
  if (req.method === 'GET' && req.url === '/webhook/restart-backend') {
    log('Manual backend restart requested');
    exec(NODE_BIN + '/pm2 restart dpmd-backend --update-env', { env: execEnv }, (err, stdout, stderr) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: !err, stdout: (stdout || '').substring(0, 500), stderr: (stderr || '').substring(0, 500) }));
    });
    return;
  }

  if (req.method !== 'POST' || req.url !== '/webhook') {
    res.writeHead(404);
    res.end('Not Found');
    return;
  }

  let body = '';
  req.on('data', chunk => body += chunk);
  req.on('end', () => {
    const signature = req.headers['x-hub-signature-256'];

    if (!verifySignature(body, signature)) {
      log('Invalid signature');
      res.writeHead(401);
      res.end('Unauthorized');
      return;
    }

    let payload;
    try {
      payload = JSON.parse(body);
    } catch (e) {
      log('Invalid JSON payload');
      res.writeHead(400);
      res.end('Bad Request');
      return;
    }

    // Handle ping event from GitHub
    const githubEvent = req.headers['x-github-event'];
    if (githubEvent === 'ping') {
      log('Received ping event from GitHub');
      res.writeHead(200);
      res.end('Pong! Webhook is working.');
      return;
    }

    const repoName = payload.repository && payload.repository.name;
    const branch = payload.ref && payload.ref.replace('refs/heads/', '');

    log('Received webhook for repo: ' + repoName + ', branch: ' + branch);

    const config = REPOS[repoName];
    if (!config) {
      log('Unknown repository: ' + repoName);
      res.writeHead(200);
      res.end('Repository not configured');
      return;
    }

    if (branch !== config.branch) {
      log('Ignoring push to branch: ' + branch);
      res.writeHead(200);
      res.end('Branch ignored');
      return;
    }

    // Deployment lock - skip if already deploying this repo
    if (deployLock[repoName]) {
      log('Deployment already in progress for ' + repoName + ', skipping');
      res.writeHead(200);
      res.end('Deployment already in progress, skipped');
      return;
    }

    res.writeHead(200);
    res.end('Webhook received, deploying...');

    // Set lock
    deployLock[repoName] = true;

    log('Starting deployment for ' + repoName + '...');
    executeCommands(config.commands, config.path, (error) => {
      // Release lock
      delete deployLock[repoName];

      if (error) {
        log('Deployment failed for ' + repoName + ': ' + error.message);
      } else {
        log('Deployment completed for ' + repoName);
      }
    });
  });
});

server.listen(PORT, '127.0.0.1', () => {
  log('Webhook handler listening on port ' + PORT);
});
