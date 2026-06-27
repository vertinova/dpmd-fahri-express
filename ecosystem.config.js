module.exports = {
  apps: [{
    name: 'dpmd-backend',
    script: './src/server.js',
    cwd: '/var/www/backend',
    // PENTING (bug "menit ke-30 semua kepental"):
    // Proses ini menampung SELURUH super-app + state signaling video meeting
    // (socket.io polling buffer, peta room/peer/transport mediasoup di memori).
    // Batas lama 512MB/500M terlalu kecil: saat >5 peserta video+suara, RAM naik
    // dan ~30 menit menyentuh 500M → pm2 RESTART proses → semua socket putus
    // serentak & seluruh room mediasoup (in-memory) hilang → semua "kepental"
    // dan sulit masuk lagi (state hilang + reconnect berbarengan).
    //
    // Video meeting = fitur UTAMA → prioritaskan. Container LXC = 16GB RAM
    // (memory.max=max), idle backend ~160MB → plafon 500M lama murni salah
    // konfigurasi dan jadi sebab "kepental menit ke-30".
    // Beri heap besar (8GB) supaya pm2 TIDAK pernah me-restart proses saat rapat
    // ramai. Safety-net restart 10G hanya untuk jaga-jaga kalau ada memory leak
    // sungguhan. Sisakan ~6GB untuk worker mediasoup (proses C++ terpisah, di
    // luar heap Node), OS, dan buff/cache — jangan diberikan semua ke heap Node
    // agar worker/container tidak ikut kena OOM.
    // Override tanpa edit file:
    //   NODE_MAX_OLD_SPACE_MB (default 8192)  &  PM2_MAX_MEMORY_RESTART (default 10G)
    node_args: `--max-old-space-size=${process.env.NODE_MAX_OLD_SPACE_MB || 8192}`,
    max_memory_restart: process.env.PM2_MAX_MEMORY_RESTART || '10G',
    wait_ready: true,
    listen_timeout: 15000,
    // Jangan biarkan restart-loop diam: kalau crash beruntun, beri jeda agar
    // tidak ikut memperparah "badai reconnect".
    restart_delay: 3000,
    max_restarts: 20,
    env: {
      NODE_ENV: 'production',
    },
  }],
};
