const http = require('http');
const crypto = require('crypto');
const { exec } = require('child_process');
const fs = require('fs');

const PORT = 9000;
const SECRET = 'dpmd-webhook-secret-2026';
const LOG_FILE = '/var/www/webhook/webhook.log';

const REPOS = {
  'dpmd-fahri-express': {
    path: '/var/www/backend',
    branch: 'main',
    commands: [
      '/usr/bin/git fetch origin',
      '/usr/bin/git reset --hard origin/main',
      '/root/.local/share/fnm/node-versions/v20.20.0/installation/bin/npm install || true',
      '/root/.local/share/fnm/node-versions/v20.20.0/installation/bin/npx prisma generate || true',
      '/root/.local/share/fnm/node-versions/v20.20.0/installation/bin/npx prisma db push --accept-data-loss || true',
      '/root/.local/share/fnm/node-versions/v20.20.0/installation/bin/node /var/www/backend/database-express/auto-migrate.js || true',
      '/bin/cp -f /var/www/backend/nginx-dpmdbogorkab.conf /etc/nginx/sites-available/dpmdbogorkab.id || true',
      '/usr/sbin/nginx -t && /usr/sbin/nginx -s reload || true',
      '/root/.local/share/fnm/node-versions/v20.20.0/installation/bin/pm2 restart dpmd-backend || /root/.local/share/fnm/node-versions/v20.20.0/installation/bin/pm2 start /var/www/backend/src/server.js --name dpmd-backend',
      '/root/.local/share/fnm/node-versions/v20.20.0/installation/bin/pm2 restart webhook-handler || true'
    ]
  },
  'dpmd-frontend': {
    path: '/var/www/frontend',
    branch: 'main',
    commands: [
      '/usr/bin/git fetch origin',
      '/usr/bin/git reset --hard origin/main',
      '/root/.local/share/fnm/node-versions/v20.20.0/installation/bin/npm install --include=dev',
      '/root/.local/share/fnm/node-versions/v20.20.0/installation/bin/npm run build'
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

function executeCommands(commands, cwd, callback) {
  let index = 0;
  // Env untuk memastikan shell dan node tersedia
  const execEnv = {
    ...process.env,
    PATH: '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:/root/.local/share/fnm/node-versions/v20.20.0/installation/bin',
    HOME: '/root',
    SHELL: '/bin/bash'
  };
  function next() {
    if (index >= commands.length) {
      callback(null, 'All commands completed');
      return;
    }
    const cmd = commands[index++];
    log('Executing: ' + cmd);
    exec(cmd, { cwd, maxBuffer: 10 * 1024 * 1024, env: execEnv, shell: '/bin/bash', timeout: 120000 }, (error, stdout, stderr) => {
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
    exec('/root/.local/share/fnm/node-versions/v20.20.0/installation/bin/pm2 jlist', { env: { ...process.env, HOME: '/root' } }, (err, stdout) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      if (err) { res.end(JSON.stringify({ error: err.message })); return; }
      try {
        const list = JSON.parse(stdout);
        const summary = list.map(p => ({ name: p.name, status: p.pm2_env?.status, restarts: p.pm2_env?.restart_time, uptime: p.pm2_env?.pm_uptime }));
        res.end(JSON.stringify({ processes: summary }));
      } catch { res.end(stdout.substring(0, 2000)); }
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

    res.writeHead(200);
    res.end('Webhook received, deploying...');

    log('Starting deployment for ' + repoName + '...');
    executeCommands(config.commands, config.path, (error) => {
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
