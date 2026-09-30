/**
 * Storage Manajemen Server: kapasitas disk, pemakaian berkas aplikasi per
 * folder & jenis, berkas terbesar, kuota unggahan, dan pembersihan.
 *
 * Penelusuran berkas bisa lama (ratusan ribu berkas), jadi hasilnya disimpan
 * di cache dan dihitung ulang di latar tiap 15 menit. Middleware kuota hanya
 * membaca angka dari cache — tidak pernah menelusuri disk di jalur request.
 */

const fsp = require('fs/promises');
const path = require('path');
const { execFile } = require('child_process');
const logger = require('../utils/logger');
const store = require('./serverStore.service');
const alerts = require('./serverAlerts.service');
const { STORAGE_FOLDERS, CLEANUP_TARGETS, BACKEND_ROOT } = require('../config/serverManagement');

const IS_LINUX = process.platform === 'linux';
const GB = 1024 ** 3;

const KATEGORI_EKSTENSI = {
  Gambar: ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.svg', '.heic', '.heif', '.avif', '.ico'],
  PDF: ['.pdf'],
  'Dokumen Office': ['.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.odt', '.ods', '.csv', '.txt', '.rtf'],
  Video: ['.mp4', '.webm', '.mov', '.mkv', '.avi', '.ts', '.m3u8'],
  Audio: ['.mp3', '.wav', '.ogg', '.m4a', '.aac'],
  Arsip: ['.zip', '.rar', '.7z', '.gz', '.tar', '.sql'],
  Log: ['.log'],
};

const kategoriDari = (nama) => {
  const ext = path.extname(nama).toLowerCase();
  for (const [k, daftar] of Object.entries(KATEGORI_EKSTENSI)) if (daftar.includes(ext)) return k;
  return 'Lainnya';
};

let cache = null;
let sedangScan = null;

const telusuri = async (akar, onBerkas) => {
  const tumpukan = [akar];
  while (tumpukan.length) {
    const dir = tumpukan.pop();
    let isi;
    try { isi = await fsp.readdir(dir, { withFileTypes: true }); } catch { continue; }
    for (const e of isi) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { tumpukan.push(p); continue; }
      if (!e.isFile()) continue;
      let st;
      try { st = await fsp.stat(p); } catch { continue; }
      onBerkas(p, st);
    }
  }
};

const scan = async () => {
  const mulai = Date.now();
  const folder = [];
  const subfolder = new Map();
  const kategori = {};
  let terbesar = [];
  let totalBerkas = 0;

  for (const f of STORAGE_FOLDERS) {
    let ukuran = 0; let jumlah = 0;
    await telusuri(f.path, (p, st) => {
      ukuran += st.size; jumlah += 1; totalBerkas += 1;
      const rel = path.relative(BACKEND_ROOT, p).split(path.sep);
      // Kelompokkan sampai kedalaman 3 (mis. storage/uploads/berita).
      const kunci = rel.slice(0, Math.min(rel.length - 1, rel[1] === 'uploads' ? 3 : 2)).join('/') || rel[0];
      const s = subfolder.get(kunci) || { path: kunci, size: 0, files: 0, newest: 0 };
      s.size += st.size; s.files += 1;
      if (st.mtimeMs > s.newest) s.newest = st.mtimeMs;
      subfolder.set(kunci, s);

      const kat = kategoriDari(p);
      kategori[kat] = kategori[kat] || { size: 0, files: 0 };
      kategori[kat].size += st.size; kategori[kat].files += 1;

      if (terbesar.length < 30 || st.size > terbesar[terbesar.length - 1].size) {
        terbesar.push({ path: rel.join('/'), size: st.size, modified: st.mtime });
        terbesar.sort((a, b) => b.size - a.size);
        if (terbesar.length > 30) terbesar = terbesar.slice(0, 30);
      }
    });
    folder.push({ key: f.key, label: f.label, size: ukuran, files: jumlah });
  }

  const pakaiAplikasi = folder.filter((f) => f.key === 'storage' || f.key === 'private').reduce((t, f) => t + f.size, 0);
  cache = {
    scanned_at: new Date(),
    duration_ms: Date.now() - mulai,
    app_usage: pakaiAplikasi,
    total_files: totalBerkas,
    folders: folder,
    subfolders: [...subfolder.values()].sort((a, b) => b.size - a.size).slice(0, 40),
    categories: Object.entries(kategori).map(([nama, v]) => ({ name: nama, ...v })).sort((a, b) => b.size - a.size),
    largest_files: terbesar,
  };
  periksaKuota();
  return cache;
};

const scanUlang = () => {
  if (!sedangScan) {
    sedangScan = scan()
      .catch((e) => { logger.warn(`[ServerStorage] Scan gagal: ${e.message}`); return cache; })
      .finally(() => { sedangScan = null; });
  }
  return sedangScan;
};

const df = () => new Promise((resolve) => {
  if (!IS_LINUX) { resolve([]); return; }
  execFile('df', ['-kPT'], { timeout: 8000 }, (err, stdout) => {
    if (err && !stdout) { resolve([]); return; }
    const baris = String(stdout).trim().split('\n').slice(1);
    const abaikan = /^(tmpfs|devtmpfs|squashfs|overlay|udev|proc|sysfs|cgroup2?|fuse\.lxcfs|none)$/;
    resolve(baris.map((b) => b.trim().split(/\s+/)).filter((k) => k.length >= 7 && !abaikan.test(k[1])).map((k) => ({
      filesystem: k[0],
      type: k[1],
      total: Number(k[2]) * 1024,
      used: Number(k[3]) * 1024,
      free: Number(k[4]) * 1024,
      percent: Number(String(k[5]).replace('%', '')),
      mount: k.slice(6).join(' '),
    })));
  });
});

const statusKuota = () => {
  const s = store.getConfigSync().storage;
  const kuota = Number(s.quota_gb) > 0 ? Number(s.quota_gb) * GB : 0;
  const pakai = cache?.app_usage ?? null;
  return {
    quota_bytes: kuota,
    used_bytes: pakai,
    percent: kuota && pakai !== null ? Math.round((pakai / kuota) * 1000) / 10 : null,
    warn_percent: s.warn_percent,
    enforce: !!s.enforce,
    max_upload_mb: Number(s.max_upload_mb) || 0,
    full: !!(kuota && pakai !== null && pakai >= kuota),
  };
};

const periksaKuota = () => {
  const k = statusKuota();
  if (!k.quota_bytes || k.percent === null) { alerts.clear('quota'); return; }
  if (k.percent >= k.warn_percent) {
    alerts.raise('quota', {
      level: k.percent >= 100 ? 'critical' : 'warning',
      kategori: 'storage',
      title: k.percent >= 100 ? 'Kuota storage penuh' : 'Kuota storage hampir penuh',
      message: `Berkas aplikasi memakai ${k.percent}% dari kuota ${Math.round(k.quota_bytes / GB)} GB.${k.full && k.enforce ? ' Unggahan baru sedang ditolak.' : ''}`,
    });
  } else {
    alerts.clear('quota');
  }
};

/**
 * Apakah unggahan sebesar `bytes` boleh diterima? Dipakai middleware.
 * Mengembalikan null bila boleh, atau { status, message } bila ditolak.
 */
const cekUnggahan = (bytes) => {
  const k = statusKuota();
  if (k.max_upload_mb && bytes > k.max_upload_mb * 1024 * 1024) {
    return { status: 413, message: `Ukuran unggahan melebihi batas ${k.max_upload_mb} MB yang ditetapkan admin.` };
  }
  if (k.enforce && k.quota_bytes && k.used_bytes !== null && k.used_bytes + bytes > k.quota_bytes) {
    return { status: 507, message: 'Kapasitas penyimpanan aplikasi sudah penuh. Hubungi admin untuk menambah kuota atau membersihkan berkas.' };
  }
  return null;
};

const getStorage = async ({ segar = false } = {}) => {
  if (segar || !cache) await scanUlang();
  const [disk] = await Promise.all([df()]);
  let rootDisk = null;
  try {
    const s = await fsp.statfs(BACKEND_ROOT);
    rootDisk = { total: s.blocks * s.bsize, free: s.bavail * s.bsize, used: (s.blocks - s.bavail) * s.bsize };
    rootDisk.percent = rootDisk.total ? Math.round((rootDisk.used / rootDisk.total) * 1000) / 10 : 0;
  } catch { /* statfs tidak tersedia */ }
  return { ...cache, scanning: !!sedangScan, disk: rootDisk, partitions: disk, quota: statusKuota() };
};

/* ─────────────────────────── Pembersihan ─────────────────────────── */

const hapusBerkasLama = async (akar, umurMs, { filterDir } = {}) => {
  let bebas = 0; let jumlah = 0;
  const batas = Date.now() - umurMs;
  const tumpukan = [akar];
  while (tumpukan.length) {
    const dir = tumpukan.pop();
    let isi;
    try { isi = await fsp.readdir(dir, { withFileTypes: true }); } catch { continue; }
    for (const e of isi) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { tumpukan.push(p); continue; }
      if (!e.isFile()) continue;
      if (filterDir && !filterDir(dir)) continue;
      try {
        const st = await fsp.stat(p);
        if (st.mtimeMs < batas) { await fsp.unlink(p); bebas += st.size; jumlah += 1; }
      } catch { /* berkas sedang dipakai/hilang */ }
    }
  }
  return { freed: bebas, files: jumlah };
};

const hapusDirKosong = async (akar) => {
  let isi;
  try { isi = await fsp.readdir(akar, { withFileTypes: true }); } catch { return; }
  for (const e of isi) {
    if (!e.isDirectory()) continue;
    const p = path.join(akar, e.name);
    await hapusDirKosong(p);
    try { await fsp.rmdir(p); } catch { /* tidak kosong */ }
  }
};

const previewCleanup = async () => {
  const cfg = store.getConfigSync().storage;
  const hasil = {};
  for (const [key, t] of Object.entries(CLEANUP_TARGETS)) {
    let size = 0; let files = 0;
    const umur = key === 'temp' ? cfg.temp_max_age_hours * 3600000 : key === 'hls' ? 6 * 3600000 : key === 'backups' ? 7 * 86400000 : 0;
    const batas = Date.now() - umur;
    const akar = key === 'temp' ? path.join(BACKEND_ROOT, 'storage') : t.path;
    await telusuri(akar, (p, st) => {
      if (key === 'temp' && !p.split(path.sep).includes('temp')) return;
      if (key === 'logs' || st.mtimeMs < batas) { size += st.size; files += 1; }
    });
    hasil[key] = { label: t.label, size, files, age_rule: umur ? Math.round(umur / 3600000) : 0 };
  }
  return hasil;
};

const cleanup = async (target) => {
  const cfg = store.getConfigSync().storage;
  const t = CLEANUP_TARGETS[target];
  if (!t) throw new Error('Target pembersihan tidak dikenal');
  let hasil;
  if (target === 'temp') {
    // Semua folder bernama "temp" di bawah storage/ (uploads/temp, */temp modul).
    hasil = await hapusBerkasLama(path.join(BACKEND_ROOT, 'storage'), cfg.temp_max_age_hours * 3600000, {
      filterDir: (d) => d.split(path.sep).includes('temp'),
    });
  } else if (target === 'hls') {
    hasil = await hapusBerkasLama(t.path, 6 * 3600000);
    await hapusDirKosong(t.path);
  } else if (target === 'backups') {
    hasil = await hapusBerkasLama(t.path, 7 * 86400000);
  } else if (target === 'logs') {
    // Dikosongkan, tidak dihapus: winston masih memegang berkasnya.
    hasil = { freed: 0, files: 0 };
    let isi = [];
    try { isi = await fsp.readdir(t.path); } catch { /* tidak ada */ }
    for (const nama of isi) {
      if (!nama.endsWith('.log')) continue;
      const p = path.join(t.path, nama);
      try {
        const st = await fsp.stat(p);
        await fsp.truncate(p, 0);
        hasil.freed += st.size; hasil.files += 1;
      } catch { /* abaikan */ }
    }
  }
  scanUlang();
  return { target, label: t.label, ...hasil };
};

let started = false;
const start = () => {
  if (started) return;
  started = true;
  setTimeout(() => scanUlang(), 30000).unref();
  setInterval(() => scanUlang(), 15 * 60000).unref();
};

module.exports = { start, getStorage, scanUlang, statusKuota, cekUnggahan, previewCleanup, cleanup, periksaKuota };
