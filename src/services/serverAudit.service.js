/**
 * Audit Keamanan Manajemen Server: memeriksa konfigurasi server & aplikasi
 * yang sebenarnya (bukan daftar periksa statis) lalu memberi skor, nilai, dan
 * perintah perbaikan per temuan.
 *
 * Semua pemeriksaan bersifat BACA SAJA — tidak ada yang diubah. Pemeriksaan
 * sistem (SSH, firewall, update, izin berkas) hanya berjalan di Linux; di
 * lingkungan lain dilaporkan "dilewati", bukan "lulus".
 */

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const { execFile } = require('child_process');
const axios = require('axios');
const store = require('./serverStore.service');
const metrics = require('./serverMetrics.service');
const apps = require('./serverApps.service');
const { BACKEND_ROOT, IP_TEPERCAYA } = require('../config/serverManagement');

const IS_LINUX = process.platform === 'linux';
const CACHE_MS = 60 * 1000;
let cache = null;
let sedang = null;

const jalankan = (cmd, args, timeout = 20000) => new Promise((resolve) => {
  execFile(cmd, args, { timeout, maxBuffer: 8 * 1024 * 1024, windowsHide: true }, (err, stdout) => {
    resolve({ ok: !err, stdout: String(stdout || ''), error: err ? err.message : null });
  });
});

const BOBOT = { fail: 15, warn: 5, pass: 0, info: 0, skip: 0 };

const temuan = (id, kategori, judul, status, detail, saran = null, perintah = null) => ({ id, kategori, judul, status, detail, saran, perintah });

/* ─────────────────────────── Aplikasi ─────────────────────────── */

const cekAplikasi = async () => {
  const hasil = [];
  const rahasia = String(process.env.JWT_SECRET || '');
  const lemah = /change|secret|password|your_|replace|example|12345/i.test(rahasia);
  hasil.push(rahasia.length >= 32 && !lemah
    ? temuan('jwt_secret', 'Aplikasi', 'Rahasia JWT kuat', 'pass', `${rahasia.length} karakter.`)
    : temuan('jwt_secret', 'Aplikasi', 'Rahasia JWT lemah', 'fail',
      rahasia ? `Hanya ${rahasia.length} karakter${lemah ? ' dan mirip nilai contoh' : ''}. Token bisa dipalsukan.` : 'JWT_SECRET kosong.',
      'Ganti JWT_SECRET dengan nilai acak ≥ 64 karakter lalu restart backend (semua pengguna harus login ulang).',
      "node -e \"console.log(require('crypto').randomBytes(48).toString('base64url'))\""));

  hasil.push(process.env.NODE_ENV === 'production'
    ? temuan('node_env', 'Aplikasi', 'Mode produksi aktif', 'pass', 'NODE_ENV=production.')
    : temuan('node_env', 'Aplikasi', 'Bukan mode produksi', IS_LINUX ? 'warn' : 'info', `NODE_ENV=${process.env.NODE_ENV || '(kosong)'} — pesan error bisa membocorkan detail internal.`, 'Set NODE_ENV=production di .env server.'));

  const mayor = Number(process.versions.node.split('.')[0]);
  hasil.push(mayor >= 20
    ? temuan('node_version', 'Aplikasi', 'Versi Node.js masih didukung', 'pass', `Node ${process.version}.`)
    : temuan('node_version', 'Aplikasi', 'Versi Node.js sudah EOL', 'warn', `Node ${process.version} tidak lagi mendapat patch keamanan.`, 'Naikkan ke Node 20/22/24 LTS.'));

  const cfg = (await store.getConfig()).security;
  const mati = [
    !cfg.detection && 'deteksi serangan',
    !cfg.waf_mode && 'mode WAF',
    !cfg.auto_block && 'blokir otomatis',
    !cfg.honeypot && 'honeypot',
  ].filter(Boolean);
  hasil.push(mati.length
    ? temuan('guard', 'Aplikasi', 'Sebagian perlindungan dimatikan', mati.length >= 2 ? 'fail' : 'warn', `Mati: ${mati.join(', ')}.`, 'Aktifkan kembali di tab Pengaturan → Keamanan.')
    : temuan('guard', 'Aplikasi', 'Perlindungan aplikasi aktif penuh', 'pass', 'Deteksi, WAF, blokir otomatis, dan honeypot menyala.'));

  const lebar = [...(cfg.whitelist || [])].filter((w) => /^\*$|^\d{1,3}\.\*$|^\d{1,3}\.\d{1,3}\.\*$/.test(String(w).trim()));
  hasil.push(lebar.length
    ? temuan('whitelist', 'Aplikasi', 'Whitelist terlalu luas', 'warn', `Pola ${lebar.join(', ')} mengecualikan jutaan alamat dari pemblokiran.`, 'Persempit ke IP atau /24 tertentu.')
    : temuan('whitelist', 'Aplikasi', 'Whitelist sempit', 'pass', `${(cfg.whitelist || []).length + IP_TEPERCAYA.length} entri, tidak ada pola luas.`));

  return hasil;
};

/* ─────────────────────────── Web & TLS ─────────────────────────── */

const cekWeb = async () => {
  const hasil = [];
  const monitor = apps.getMonitorStatus();
  for (const m of monitor) {
    const hari = m.ssl?.days_left;
    if (hari === null || hari === undefined) continue;
    hasil.push(hari < 7
      ? temuan(`ssl:${m.url}`, 'Web & TLS', `Sertifikat ${m.name} hampir habis`, 'fail', `Sisa ${hari} hari (${m.url}).`, 'Perpanjang sertifikat (Nginx Proxy Manager → SSL → Renew).')
      : hari < 21
        ? temuan(`ssl:${m.url}`, 'Web & TLS', `Sertifikat ${m.name} segera habis`, 'warn', `Sisa ${hari} hari (${m.url}).`, 'Pastikan perpanjangan otomatis berjalan.')
        : temuan(`ssl:${m.url}`, 'Web & TLS', `Sertifikat ${m.name} sehat`, 'pass', `Sisa ${hari} hari.`));
  }

  const situs = monitor.find((m) => /^https:/.test(m.url) && !/127\.0\.0\.1|localhost/.test(m.url));
  if (situs) {
    try {
      const r = await axios.get(situs.url, { timeout: 8000, maxRedirects: 3, validateStatus: () => true, responseType: 'text', transformResponse: (x) => x });
      const h = r.headers;
      const kurang = [
        !h['strict-transport-security'] && 'Strict-Transport-Security',
        !h['x-content-type-options'] && 'X-Content-Type-Options',
        !h['x-frame-options'] && !/frame-ancestors/i.test(h['content-security-policy'] || '') && 'X-Frame-Options / frame-ancestors',
        !h['referrer-policy'] && 'Referrer-Policy',
      ].filter(Boolean);
      const bocor = [h['x-powered-by'] && `X-Powered-By: ${h['x-powered-by']}`, /\d/.test(h.server || '') && `Server: ${h.server}`].filter(Boolean);
      hasil.push(kurang.length
        ? temuan('headers', 'Web & TLS', 'Header keamanan belum lengkap', kurang.length >= 2 ? 'warn' : 'info', `${situs.url} tanpa: ${kurang.join(', ')}.`,
          'Tambahkan di blok server nginx situs frontend.',
          'add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;\nadd_header X-Content-Type-Options nosniff always;\nadd_header X-Frame-Options SAMEORIGIN always;\nadd_header Referrer-Policy strict-origin-when-cross-origin always;')
        : temuan('headers', 'Web & TLS', 'Header keamanan lengkap', 'pass', `${situs.url} mengirim HSTS, nosniff, anti-framing, dan Referrer-Policy.`));
      if (bocor.length) {
        hasil.push(temuan('banner', 'Web & TLS', 'Versi perangkat lunak terlihat', 'info', bocor.join(' · '), 'Sembunyikan versi: server_tokens off; di nginx.', 'server_tokens off;'));
      }
    } catch (error) {
      hasil.push(temuan('headers', 'Web & TLS', 'Header keamanan tidak bisa diperiksa', 'skip', `${situs.url}: ${error.message}`));
    }
  }
  return hasil;
};

/* ─────────────────────────── Database ─────────────────────────── */

const cekDatabase = async () => {
  const hasil = [];
  try {
    const [[u], bind] = await Promise.all([
      store.query('SELECT CURRENT_USER() AS u'),
      store.query("SHOW VARIABLES WHERE Variable_name IN ('bind_address','skip_networking','local_infile','max_connections')"),
    ]);
    const v = Object.fromEntries(bind.map((b) => [b.Variable_name, b.Value]));
    const user = String(u?.u || '');
    hasil.push(/^root@/i.test(user)
      ? temuan('db_user', 'Database', 'Aplikasi memakai akun root MySQL', 'warn', `Terhubung sebagai ${user}. Bila aplikasi dibobol, seluruh server database ikut.`, 'Buat akun khusus dengan hak hanya pada database aplikasi.', "CREATE USER 'dpmd_app'@'127.0.0.1' IDENTIFIED BY '<sandi-kuat>';\nGRANT SELECT, INSERT, UPDATE, DELETE, CREATE, ALTER, INDEX, DROP ON dpmd.* TO 'dpmd_app'@'127.0.0.1';")
      : temuan('db_user', 'Database', 'Akun database bukan root', 'pass', `Terhubung sebagai ${user}.`));
    const alamat = v.bind_address;
    if (alamat !== undefined) {
      hasil.push(['0.0.0.0', '*', '::'].includes(alamat) && v.skip_networking !== 'ON'
        ? temuan('db_bind', 'Database', 'MySQL mendengarkan semua antarmuka', 'warn', `bind_address=${alamat}. Pastikan port 3306 tidak terbuka ke internet.`, 'Set bind-address = 127.0.0.1 di my.cnf bila aplikasi satu mesin.')
        : temuan('db_bind', 'Database', 'MySQL hanya lokal', 'pass', `bind_address=${alamat}.`));
    }
    if (v.local_infile === 'ON') {
      hasil.push(temuan('db_infile', 'Database', 'local_infile aktif', 'warn', 'LOAD DATA LOCAL bisa dipakai penyerang SQL injection untuk membaca berkas.', 'Matikan: local_infile = 0 di my.cnf.'));
    }
  } catch (error) {
    hasil.push(temuan('db', 'Database', 'Database tidak bisa diperiksa', 'skip', error.message));
  }
  return hasil;
};

/* ─────────────────────────── Sistem (Linux) ─────────────────────────── */

const bacaSshd = async () => {
  const berkas = ['/etc/ssh/sshd_config'];
  try {
    for (const f of await fsp.readdir('/etc/ssh/sshd_config.d')) if (f.endsWith('.conf')) berkas.push(path.join('/etc/ssh/sshd_config.d', f));
  } catch { /* tidak ada */ }
  const nilai = {};
  let terbaca = false;
  // sshd memakai nilai PERTAMA yang ditemukan; Include di awal berkas utama
  // biasanya memuat sshd_config.d lebih dulu, jadi berkas .d diproses dulu.
  for (const f of [...berkas.slice(1), berkas[0]]) {
    let isi;
    try { isi = await fsp.readFile(f, 'utf8'); terbaca = true; } catch { continue; }
    for (const baris of isi.split('\n')) {
      const m = baris.trim().match(/^(\w+)\s+(.+)$/);
      if (m && !m[1].startsWith('#')) {
        const k = m[1].toLowerCase();
        if (!(k in nilai)) nilai[k] = m[2].trim().toLowerCase();
      }
    }
  }
  return terbaca ? nilai : null;
};

const cekSistem = async () => {
  if (!IS_LINUX) return [temuan('os', 'Sistem', 'Pemeriksaan sistem dilewati', 'skip', 'Hanya berjalan di server Linux.')];
  const hasil = [];

  const ssh = await bacaSshd();
  if (!ssh) {
    hasil.push(temuan('ssh', 'Sistem', 'Konfigurasi SSH tidak terbaca', 'skip', '/etc/ssh/sshd_config tidak ada atau tanpa izin baca.'));
  } else {
    const root = ssh.permitrootlogin || 'prohibit-password';
    hasil.push(root === 'yes'
      ? temuan('ssh_root', 'Sistem', 'SSH mengizinkan login root dengan sandi', 'fail', 'PermitRootLogin yes — target utama brute force.', 'Ubah ke prohibit-password (pakai kunci SSH) lalu reload sshd.', "sed -i 's/^#\\?PermitRootLogin.*/PermitRootLogin prohibit-password/' /etc/ssh/sshd_config && systemctl reload ssh")
      : temuan('ssh_root', 'Sistem', 'Login root SSH dibatasi', 'pass', `PermitRootLogin ${root}.`));
    const sandi = ssh.passwordauthentication || 'yes';
    hasil.push(sandi === 'yes'
      ? temuan('ssh_pass', 'Sistem', 'SSH menerima login dengan sandi', 'warn', 'PasswordAuthentication yes — sandi bisa ditebak.', 'Pasang kunci SSH untuk semua admin, lalu matikan login sandi.', "sed -i 's/^#\\?PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config && systemctl reload ssh")
      : temuan('ssh_pass', 'Sistem', 'SSH hanya dengan kunci', 'pass', 'PasswordAuthentication no.'));
  }

  const layanan = await apps.getServices().catch(() => ({ services: [] }));
  const aktif = (unit) => layanan.services?.some((s) => s.unit.startsWith(unit) && s.active === 'active');
  const ada = (unit) => layanan.services?.some((s) => s.unit.startsWith(unit));
  hasil.push(aktif('fail2ban')
    ? temuan('fail2ban', 'Sistem', 'Fail2ban aktif', 'pass', 'IP yang menebak sandi SSH diblokir otomatis di level sistem.')
    : temuan('fail2ban', 'Sistem', ada('fail2ban') ? 'Fail2ban terpasang tapi mati' : 'Fail2ban belum terpasang', 'warn', 'Brute force SSH tidak diblokir di level sistem (aplikasi hanya mencatat).', 'Pasang & aktifkan fail2ban.', 'apt-get install -y fail2ban && systemctl enable --now fail2ban'));

  const fw = await jalankan('ufw', ['status'], 5000);
  if (fw.ok) {
    hasil.push(/Status: active/i.test(fw.stdout)
      ? temuan('ufw', 'Sistem', 'Firewall UFW aktif', 'pass', fw.stdout.split('\n').slice(0, 1).join(''))
      : temuan('ufw', 'Sistem', 'Firewall UFW tidak aktif', 'warn', 'Semua port yang mendengarkan bisa dijangkau selama jaringan mengizinkan.', 'Izinkan port yang perlu saja lalu aktifkan.', 'ufw default deny incoming && ufw allow 22/tcp && ufw allow 80,443/tcp && ufw --force enable'));
  } else {
    hasil.push(temuan('ufw', 'Sistem', 'UFW tidak tersedia', 'info', 'Firewall mungkin diatur di host Proxmox / router (wajar untuk container).'));
  }

  const port = await apps.getPorts().catch(() => ({ ports: [] }));
  const BAHAYA = { 3306: 'MySQL', 6379: 'Redis', 27017: 'MongoDB', 9200: 'Elasticsearch', 11211: 'Memcached', 5432: 'PostgreSQL', 9000: 'Webhook/PHP-FPM' };
  const terbuka = (port.ports || []).filter((p) => p.public && BAHAYA[p.port]);
  hasil.push(terbuka.length
    ? temuan('ports', 'Sistem', 'Layanan internal terbuka ke semua antarmuka', 'fail', terbuka.map((p) => `${BAHAYA[p.port]} :${p.port} (${p.process || '-'})`).join(', '), 'Ikat ke 127.0.0.1 atau tutup dengan firewall.', terbuka.map((p) => `ufw deny ${p.port}/tcp`).join('\n'))
    : temuan('ports', 'Sistem', 'Tidak ada layanan internal yang terbuka', 'pass', `${(port.ports || []).filter((p) => p.public).length} port publik, semuanya layanan web/SSH.`));

  const upd = await jalankan('apt-get', ['-s', '-o', 'Debug::NoLocking=1', 'upgrade'], 25000);
  if (upd.ok) {
    const paket = upd.stdout.split('\n').filter((b) => b.startsWith('Inst '));
    const keamanan = paket.filter((b) => /security/i.test(b));
    hasil.push(keamanan.length
      ? temuan('updates', 'Sistem', `${keamanan.length} update keamanan tertunda`, keamanan.length >= 10 ? 'fail' : 'warn', `${paket.length} paket bisa diperbarui, ${keamanan.length} dari repositori security: ${keamanan.slice(0, 6).map((b) => b.split(' ')[1]).join(', ')}${keamanan.length > 6 ? '…' : ''}`, 'Pasang update keamanan (backend tetap jalan; restart layanan bila diminta).', 'apt-get update && apt-get upgrade -y')
      : temuan('updates', 'Sistem', paket.length ? `${paket.length} update biasa tersedia` : 'Paket sistem mutakhir', paket.length ? 'info' : 'pass', paket.length ? 'Tidak ada yang dari repositori security.' : 'Tidak ada update tertunda (berdasarkan indeks apt terakhir).'));
  }

  if (fs.existsSync('/var/run/reboot-required')) {
    hasil.push(temuan('reboot', 'Sistem', 'Perlu reboot', 'warn', 'Kernel/pustaka inti sudah diperbarui tapi baru berlaku setelah reboot.', 'Jadwalkan reboot container di luar jam kerja.'));
  }

  const env = path.join(BACKEND_ROOT, '.env');
  try {
    const st = await fsp.stat(env);
    const mode = st.mode & 0o777;
    hasil.push(mode & 0o007
      ? temuan('env_perm', 'Sistem', 'Berkas .env bisa dibaca semua pengguna', 'warn', `Izin ${mode.toString(8)} pada ${env} — berisi sandi DB & rahasia JWT.`, 'Batasi ke pemilik saja.', `chmod 600 ${env}`)
      : temuan('env_perm', 'Sistem', 'Berkas .env terlindungi', 'pass', `Izin ${mode.toString(8)}.`));
  } catch { /* .env tidak dipakai */ }

  const disk = metrics.getLatest()?.disk;
  if (disk) {
    hasil.push(disk.percent >= 92
      ? temuan('disk', 'Sistem', 'Disk hampir penuh', 'fail', `${disk.percent}% terpakai — log & database bisa berhenti menulis.`, 'Bersihkan di tab Storage atau tambah disk di Proxmox.')
      : temuan('disk', 'Sistem', 'Ruang disk cukup', disk.percent >= 85 ? 'warn' : 'pass', `${disk.percent}% terpakai.`));
  }
  return hasil;
};

/* ─────────────────────────── Ancaman ─────────────────────────── */

const cekAncaman = async () => {
  try {
    const [r] = await store.query(
      `SELECT SUM(event_type = 'ssh_failed') AS ssh, SUM(severity = 'critical') AS kritis, COUNT(DISTINCT ip_address) AS ips
         FROM server_security_events WHERE created_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR)`,
    );
    const hasil = [];
    if (r?.ssh) {
      hasil.push(temuan('ssh_attack', 'Ancaman', 'Brute force SSH 24 jam terakhir', r.ssh >= 50 ? 'warn' : 'info', `${r.ssh} catatan percobaan SSH gagal.`, 'Pastikan fail2ban aktif dan login sandi SSH dimatikan.'));
    }
    hasil.push(temuan('critical_24h', 'Ancaman', 'Serangan kritis 24 jam terakhir', r?.kritis ? 'info' : 'pass', `${r?.kritis || 0} kejadian kritis dari ${r?.ips || 0} IP berbeda.`));
    return hasil;
  } catch {
    return [];
  }
};

/* ─────────────────────────── Ringkasan ─────────────────────────── */

const jalankanAudit = async () => {
  const mulai = Date.now();
  const bagian = await Promise.all([cekAplikasi(), cekWeb(), cekDatabase(), cekSistem(), cekAncaman()].map((p) => p.catch((e) => [temuan('error', 'Lainnya', 'Pemeriksaan gagal', 'skip', e.message)])));
  const checks = bagian.flat();
  const hitung = { pass: 0, warn: 0, fail: 0, info: 0, skip: 0 };
  for (const c of checks) hitung[c.status] += 1;
  const skor = Math.max(0, 100 - checks.reduce((t, c) => t + BOBOT[c.status], 0));
  const nilai = skor >= 90 ? 'A' : skor >= 80 ? 'B' : skor >= 65 ? 'C' : skor >= 50 ? 'D' : 'F';
  const urut = { fail: 0, warn: 1, info: 2, pass: 3, skip: 4 };
  checks.sort((a, b) => urut[a.status] - urut[b.status]);
  return { score: skor, grade: nilai, counts: hitung, checks, platform: process.platform, duration_ms: Date.now() - mulai, scanned_at: new Date() };
};

const getAudit = async ({ segar = false } = {}) => {
  if (!segar && cache && Date.now() - cache.at < CACHE_MS) return cache.data;
  if (!sedang) {
    sedang = jalankanAudit()
      .then((data) => {
        cache = { at: Date.now(), data };
        return data;
      })
      .finally(() => { sedang = null; });
  }
  return sedang;
};

module.exports = { getAudit };
