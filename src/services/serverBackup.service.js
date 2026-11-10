/**
 * Backup database MySQL atas permintaan superadmin.
 *
 * mysqldump dijalankan di latar, keluarannya dikompres gzip ke
 * MYSQL_BACKUP_DIR sebagai `dpmd-YYYYMMDD-HHmmss.sql.gz`. Hanya SIMPAN berkas
 * terbaru yang dipertahankan. Sandi DB dikirim lewat MYSQL_PWD, tidak pernah
 * lewat argumen (terlihat di daftar proses).
 *
 * Sengaja tanpa prisma supaya aman diuji tanpa koneksi database.
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { spawn } = require('child_process');
const logger = require('../utils/logger');
const alerts = require('./serverAlerts.service');

const DIR = process.env.MYSQL_BACKUP_DIR || '/var/backups/dpmd-mysql';
const SIMPAN = 7;
const POLA = /^dpmd-\d{8}-\d{6}\.sql\.gz$/;
const MIN_RUANG = 200 * 1024 * 1024;

let running = false;
let lastError = null;

const galat = (pesan, status) => Object.assign(new Error(pesan), { status });

const siapkanDir = () => {
  try {
    fs.mkdirSync(DIR, { recursive: true, mode: 0o700 });
    return null;
  } catch (e) {
    return `Direktori backup ${DIR} tidak bisa dipakai: ${e.message}`;
  }
};

const bacaBerkas = () => {
  try {
    return fs.readdirSync(DIR)
      .filter((n) => POLA.test(n))
      .map((name) => {
        const st = fs.statSync(path.join(DIR, name));
        return { name, size: st.size, mtime: st.mtime };
      })
      .sort((a, b) => b.mtime - a.mtime || b.name.localeCompare(a.name));
  } catch {
    return [];
  }
};

const listMysql = () => {
  const error = siapkanDir();
  return {
    dir: DIR,
    available: !error,
    running,
    error,
    last_error: lastError,
    files: error ? [] : bacaBerkas().map((f) => ({ name: f.name, size: f.size, mtime: f.mtime.toISOString() })),
  };
};

/** `YYYYMMDD-HHmmss` waktu WIB. */
const stempelWib = () => {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date()).map((x) => [x.type, x.value]));
  return `${p.year}${p.month}${p.day}-${p.hour}${p.minute}${p.second}`;
};

const pangkas = () => {
  for (const f of bacaBerkas().slice(SIMPAN)) {
    try { fs.unlinkSync(path.join(DIR, f.name)); } catch { /* abaikan */ }
  }
};

const startMysqlBackup = ({ onSelesai } = {}) => {
  if (running) throw galat('Backup database sedang berjalan', 409);
  const err = siapkanDir();
  if (err) throw galat(err, 400);

  const terbaru = bacaBerkas()[0];
  const butuh = Math.max(2 * (terbaru ? terbaru.size : 0), MIN_RUANG);
  try {
    const st = fs.statfsSync(DIR);
    const sisa = Number(st.bavail ?? st.bfree) * Number(st.bsize);
    if (sisa < butuh) throw galat(`Ruang disk tidak cukup: sisa ${Math.floor(sisa / 1048576)} MB, butuh minimal ${Math.ceil(butuh / 1048576)} MB.`, 400);
  } catch (e) {
    if (e.status) throw e; // statfs tidak tersedia: lanjut tanpa pengecekan
  }

  const name = `dpmd-${stempelWib()}.sql.gz`;
  const final = path.join(DIR, name);
  const sementara = `${final}.part`;
  running = true;

  let stderr = '';
  let selesai = false;
  let keBerkas = null;
  const akhir = (error) => {
    if (selesai) return;
    selesai = true;
    if (error) {
      if (keBerkas) keBerkas.destroy();
      try { fs.unlinkSync(sementara); } catch { /* mungkin belum terbentuk */ }
      lastError = error;
      logger.warn(`[ServerBackup] Backup MySQL gagal: ${error}`);
      alerts.raise('mysql_backup', { level: 'warning', kategori: 'backup', title: 'Backup database gagal', message: error });
    } else {
      try {
        fs.renameSync(sementara, final);
        pangkas();
        lastError = null;
        alerts.clear('mysql_backup');
      } catch (e) {
        lastError = `Gagal memindahkan hasil backup: ${e.message}`;
        alerts.raise('mysql_backup', { level: 'warning', kategori: 'backup', title: 'Backup database gagal', message: lastError });
      }
    }
    running = false;
    if (onSelesai) {
      try { onSelesai({ ok: !lastError, name, error: lastError }); } catch { /* abaikan */ }
    }
  };

  const env = { ...process.env, MYSQL_PWD: process.env.DB_PASSWORD || '' };
  const dump = spawn(process.env.MYSQLDUMP_BIN || 'mysqldump', [
    '--no-defaults',
    `--host=${process.env.DB_HOST || '127.0.0.1'}`,
    `--port=${process.env.DB_PORT || 3306}`,
    `--user=${process.env.DB_USER}`,
    '--single-transaction', '--quick', '--hex-blob', '--no-tablespaces',
    process.env.DB_NAME,
  ], { env });

  keBerkas = fs.createWriteStream(sementara, { mode: 0o600 });
  let kode = null;
  let streamSelesai = false;
  const cek = () => {
    if (kode === null || !streamSelesai) return;
    akhir(kode === 0 ? null : `mysqldump keluar dengan kode ${kode}: ${stderr.trim().slice(-500)}`.trim());
  };

  dump.stderr.on('data', (d) => { stderr = (stderr + d).slice(-2000); });
  dump.on('error', (e) => akhir(`mysqldump tidak bisa dijalankan: ${e.message}`));
  dump.on('close', (k) => { kode = k; cek(); });
  keBerkas.on('error', (e) => akhir(`Gagal menulis berkas backup: ${e.message}`));
  keBerkas.on('finish', () => { streamSelesai = true; cek(); });
  dump.stdout.pipe(zlib.createGzip()).pipe(keBerkas);

  return { running: true };
};

const terakhir = () => {
  const f = bacaBerkas()[0];
  return f ? f.mtime.toISOString() : null;
};

module.exports = { listMysql, startMysqlBackup, terakhir };
