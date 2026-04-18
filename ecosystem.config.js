module.exports = {
  apps: [{
    name: 'dpmd-backend',
    script: './src/server.js',
    cwd: '/var/www/backend',
    node_args: '--max-old-space-size=512',
    max_memory_restart: '500M',
    wait_ready: true,
    listen_timeout: 15000,
    env: {
      NODE_ENV: 'production',
    },
  }],
};
