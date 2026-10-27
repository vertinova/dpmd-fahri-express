const express = require('express');
const http = require('http');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const jwt = require('jsonwebtoken');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

// Fix BigInt serialization for JSON
BigInt.prototype.toJSON = function() {
  return this.toString();
};

// Global error handlers - prevent process crash on unhandled errors
process.on('unhandledRejection', (reason, promise) => {
  console.error('[Process] Unhandled Rejection:', reason);
});

process.on('uncaughtException', (error) => {
  console.error('[Process] Uncaught Exception:', error);
  // Don't exit - let PM2 handle if truly fatal
});

// Initialize Sequelize models FIRST before any routes
const { sequelize } = require('./models');

const logger = require('./utils/logger');
const errorHandler = require('./middlewares/errorHandler');
// Operator kecamatan: fitur dibatasi per hak akses di titik mount (lihat middleware-nya).
const { gerbangOperatorKecamatan } = require('./middlewares/kecamatanPermission');
const schedulerService = require('./services/scheduler.service');

// Ensure required directories exist
const requiredDirs = [
  path.join(__dirname, '../storage/uploads/temp'),
  path.join(__dirname, '../storage/uploads/peraturan'),
  path.join(__dirname, '../storage/uploads/produk-hukum'),
  path.join(__dirname, '../storage/produk_hukum_bidang'),
  path.join(__dirname, '../storage/uploads/bumdes_dokumen_badanhukum'),
  path.join(__dirname, '../storage/uploads/bumdes_laporan_keuangan'),
  path.join(__dirname, '../storage/uploads/bumdes'),
  path.join(__dirname, '../storage/uploads/kerjasama_desa'),
  path.join(__dirname, '../storage/uploads/profil_desa'),
  path.join(__dirname, '../storage/uploads/bankeu-perubahan/berita-acara'),
  path.join(__dirname, '../storage/uploads/bankeu-perubahan/surat-pengantar'),
  path.join(__dirname, '../storage/uploads/bankeu-perubahan/annotated'),
  path.join(__dirname, '../storage/uploads/bantuan_provinsi_lpj/temp'),
  path.join(__dirname, '../storage/uploads/bankeu_proposal_2025/temp'),
  path.join(__dirname, '../public/backups')
];

requiredDirs.forEach(dir => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
    logger.info(`📁 Created directory: ${dir}`);
  }
});

// Import routes
const authRoutes = require('./routes/auth.routes');
const userRoutes = require('./routes/user.routes');
const bumdesRoutes = require('./routes/bumdes.routes');
const musdesusRoutes = require('./routes/musdesus.routes');
const heroGalleryRoutes = require('./routes/heroGallery.routes');
const publicRoutes = require('./routes/public.routes');
const locationRoutes = require('./routes/location.routes');
const kepalaDinasRoutes = require('./routes/kepalaDinas.routes');
const kelembagaanRoutes = require('./routes/kelembagaan.routes');
const desaKelembagaanRoutes = require('./routes/desa.kelembagaan.routes');
const aparaturDesaRoutes = require('./routes/aparatur-desa.routes');
const profilDesaRoutes = require('./routes/profil-desa.routes');
const produkHukumRoutes = require('./routes/produkHukum.routes');
const bankeuT1Routes = require('./routes/bankeu-t1.routes');
const bankeuT2Routes = require('./routes/bankeu-t2.routes');
const addRoutes = require('./routes/add.routes');
const ddRoutes = require('./routes/dd.routes');
const ddEarmarkedT1Routes = require('./routes/dd-earmarked-t1.routes');
const ddEarmarkedT2Routes = require('./routes/dd-earmarked-t2.routes');
const ddNonEarmarkedT1Routes = require('./routes/dd-nonearmarked-t1.routes');
const ddNonEarmarkedT2Routes = require('./routes/dd-nonearmarked-t2.routes');
const insentifDdRoutes = require('./routes/insentif-dd.routes');
const bhprdRoutes = require('./routes/bhprd.routes');
const bhprdT1Routes = require('./routes/bhprd-t1.routes');
const bhprdT2Routes = require('./routes/bhprd-t2.routes');
const bhprdT3Routes = require('./routes/bhprd-t3.routes');
const pegawaiRoutes = require('./routes/pegawai.routes');
const bidangRoutes = require('./routes/bidang.routes');
const bankeuProposalRoutes = require('./routes/bankeuProposal.routes');
const desaBankeuSuratRoutes = require('./routes/desaBankeuSurat.routes');
const kecamatanBankeuSuratRoutes = require('./routes/kecamatanBankeuSurat.routes');
const bankeuVerificationRoutes = require('./routes/bankeuVerification.routes');
const bankeuMasterKegiatanRoutes = require('./routes/bankeuMasterKegiatan.routes');
// Bankeu Perubahan 2026 - flow Desa -> Kecamatan -> DPMD (skip Dinas)
const bankeuPerubahanProposalRoutes = require('./routes/bankeuPerubahanProposal.routes');
const bankeuPerubahanVerificationRoutes = require('./routes/bankeuPerubahanVerification.routes');
const bankeuPerubahanDpmdRoutes = require('./routes/bankeuPerubahanDpmd.routes');
const dinasBankeuPerubahanRoutes = require('./routes/dinasBankeuPerubahan.routes');
const dinasPelihatBankeuPerubahanRoutes = require('./routes/dinasPelihatBankeuPerubahan.routes');
const bankeuPerubahanConfigRoutes = require('./routes/bankeuPerubahanConfig.routes');
const bankeuPerubahanLpjRoutes = require('./routes/bankeuPerubahanLpj.routes');
const dpmdBankeuPerubahanLpjRoutes = require('./routes/dpmdBankeuPerubahanLpj.routes');
const bankeuPerubahanPublicRoutes = require('./routes/bankeuPerubahanPublic.routes');
const bankeuPerubahanBeritaAcaraRoutes = require('./routes/bankeuPerubahanBeritaAcara.routes');
const bankeuPerubahanQuestionnaireRoutes = require('./routes/bankeuPerubahanQuestionnaire.routes');
const dinasRoutes = require('./routes/dinas.routes');
const dinasVerificationRoutes = require('./routes/dinasVerification.routes');
const dpmdVerificationRoutes = require('./routes/dpmdVerification.routes');
const bankeuLpjRoutes = require('./routes/bankeuLpj.routes');
const dpmdBankeuLpjRoutes = require('./routes/dpmdBankeuLpj.routes');
const bankeuProposal2025Routes = require('./routes/bankeuProposal2025.routes');
const dpmdBankeuProposal2025Routes = require('./routes/dpmdBankeuProposal2025.routes');
const bantuanProvinsiLpjRoutes = require('./routes/bantuanProvinsiLpj.routes');
const dpmdBantuanProvinsiLpjRoutes = require('./routes/dpmdBantuanProvinsiLpj.routes');
const dinasVerifikatorRoutes = require('./routes/dinasVerifikator.routes');
const verifikatorAksesDesaRoutes = require('./routes/verifikatorAksesDesa.routes');
const beritaAcaraRoutes = require('./routes/beritaAcara.routes');
const perjadinRoutes = require('./routes/perjadin.routes');
const pemdesAparaturRoutes = require('./routes/pemdes-aparatur.routes');
const pemdesProfilDesaRoutes = require('./routes/pemdes-profil-desa.routes');
const chatbotRoutes = require('./routes/chatbot.routes');
const anggaranRoutes = require('./routes/anggaran.routes');
const anggaranKasRoutes = require('./routes/anggaranKas.routes');
const rekeningRefRoutes = require('./routes/rekeningRef.routes');
const penyediaRoutes = require('./routes/penyedia.routes');
const pencairanRoutes = require('./routes/pencairan.routes');
const pencairanSkRefRoutes = require('./routes/pencairanSkRef.routes');

const app = express();

// Trust proxy for reverse proxy chain (OpenResty/CDN -> Nginx -> Express)
// Use 2 for two reverse proxies to get real client IP for rate limiting
app.set('trust proxy', 2);

// Manajemen Server: tolak IP yang diblokir & catat trafik/respons. Dipasang
// sebelum rate limiter supaya respons 429 miliknya ikut terhitung sebagai
// indikasi serangan.
const serverGuard = require('./middlewares/serverGuard');
app.use(serverGuard.gerbang);

// Security middleware - Configure helmet to allow PDF embedding via object tag
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      frameAncestors: ["'self'", "http://localhost:5173", "https://dpmd.bogorkab.go.id"],
      objectSrc: ["'self'", "data:", "blob:"],
      frameSrc: ["'self'", "data:", "blob:"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "blob:"],
    }
  },
  crossOriginEmbedderPolicy: false,
  crossOriginResourcePolicy: { policy: "cross-origin" }
}));

// CORS Configuration - Use environment variable or fallback to defaults
const allowedOrigins = process.env.CORS_ORIGIN 
  ? process.env.CORS_ORIGIN.split(',').map(origin => origin.trim())
  : [
      'http://localhost:5173',
      'http://localhost:5174',
      'http://127.0.0.1:5173',
      'http://127.0.0.1:5174',
      'https://dpmd.bogorkab.go.id'
    ];

app.use(cors({
  origin: allowedOrigins,
  credentials: true,
  // Tanpa ini header perpanjangan token tidak terbaca oleh JavaScript di
  // browser saat frontend beda origin (dev di localhost:5173).
  exposedHeaders: ['X-Renewed-Token']
}));

/**
 * Kunci rate limit: per AKUN bila request membawa JWT yang sah, per IP bila
 * tidak.
 *
 * Seluruh pegawai di kantor keluar lewat satu IP NAT (103.51.103.197). Dengan
 * kunci per IP, jatah 1000 request itu milik sekantor — pada 2026-10-02 satu HP
 * yang terjebak loop tanpa token menghabiskannya dalam beberapa detik dan semua
 * orang di kantor menerima 429 ("backend mati"). Sekarang tiap akun punya
 * jatahnya sendiri, dan request anonim dari IP itu hanya menghabiskan keranjang
 * anonim. Tokennya diverifikasi (bukan sekadar dibaca) supaya token karangan
 * tidak bisa dipakai untuk membuat keranjang baru tanpa batas.
 *
 * TOKEN KEDALUWARSA TETAP DIKUNCI PER AKUN. Dulu token yang lewat masa
 * berlakunya jatuh ke kunci IP — keranjang anonim sekantor. Pada 2026-10-13
 * tablet Kepala Dinas (token >7 hari) membuka Core Dashboard Asta Desa saat
 * keranjang itu sudah habis: setiap request dibalas 429 SEBELUM sempat sampai
 * ke `auth` yang akan membalas 401, sehingga frontend tidak pernah memicu
 * /auth/renew dan halaman macet di "Request failed with status code 429".
 * Tanda tangannya tetap diverifikasi, jadi tidak ada keranjang yang bisa
 * dikarang tanpa JWT_SECRET; masa berlaku diurus `auth` seperti biasa.
 */
const kunciRateLimit = (req) => {
  if (req.__kunciRateLimit) return req.__kunciRateLimit;
  let kunci = `ip:${req.ip}`;
  const h = req.headers.authorization;
  if (h && h.startsWith('Bearer ')) {
    try {
      const muatan = jwt.verify(h.slice(7), process.env.JWT_SECRET, { ignoreExpiration: true });
      if (muatan?.id !== undefined && muatan?.id !== null) kunci = `akun:${muatan.id}`;
    } catch {
      // Tanda tangan tidak cocok/rusak: jatuh ke kunci IP.
    }
  }
  // Disimpan di request: satu request bisa melewati beberapa limiter, dan
  // jwt.verify tidak perlu diulang di tiap limiter.
  req.__kunciRateLimit = kunci;
  return kunci;
};
const milikAkun = (req) => kunciRateLimit(req).startsWith('akun:');

/**
 * Balasan 429 berbentuk JSON + Retry-After.
 *
 * Dulu badannya teks polos, sehingga frontend (yang membaca `message` dari
 * JSON) hanya bisa menampilkan "Request failed with status code 429" — tanpa
 * penjelasan dan tanpa tahu kapan boleh mencoba lagi.
 */
const balas429 = (pesan) => (req, res, _next, options) => {
  const reset = req.rateLimit?.resetTime instanceof Date ? req.rateLimit.resetTime.getTime() : null;
  const detik = reset ? Math.max(1, Math.ceil((reset - Date.now()) / 1000)) : Math.ceil(options.windowMs / 1000);
  res.set('Retry-After', String(detik));
  res.status(options.statusCode).json({
    success: false,
    code: 'RATE_LIMIT',
    message: `${pesan} Coba lagi dalam ${Math.max(1, Math.ceil(detik / 60))} menit.`,
    retry_after: detik
  });
};

// Rate limiting - Standard API requests
//
// Akun yang login mendapat jatah lebih longgar daripada keranjang anonim:
// identitasnya terverifikasi, dan satu akun pimpinan sering terbuka di
// beberapa perangkat sekaligus (tablet, laptop, layar rapat) dengan dasbor
// yang memperbarui dirinya sendiri.
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: (req) => (milikAkun(req) ? 3000 : 1000),
  keyGenerator: kunciRateLimit,
  // Ditangani oleh limiter khusus di bawah — jangan dihitung dua kali.
  skip: (req) => req.path === '/auth/renew' || (req.path.startsWith('/asta-desa/') && milikAkun(req)),
  handler: balas429('Terlalu banyak permintaan.'),
  standardHeaders: true,
  legacyHeaders: false,
});

// Asta Desa punya keranjang sendiri per akun. Halaman itu memperbarui dirinya
// tiap 30–60 detik dan dilayani dari cache backend (penyusuran ke ASTA DESA
// dibagi bersama dan tidak diulang per permintaan), jadi ia tidak boleh ikut
// kehabisan jatah hanya karena modul lain di perangkat yang sama ramai.
const astaDesaLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 2000,
  keyGenerator: kunciRateLimit,
  skip: (req) => !milikAkun(req),
  handler: balas429('Terlalu banyak permintaan data Asta Desa dari akun ini.'),
  standardHeaders: true,
  legacyHeaders: false,
});

// /auth/renew dipisah dari keranjang umum: inilah jalan keluar sesi yang
// kedaluwarsa, dan menutupnya dengan 429 membuat sesi tidak bisa pulih sama
// sekali. Request ini tidak membawa header Authorization (tokennya di body),
// jadi kuncinya IP — jatahnya cukup untuk sekantor yang tokennya habis
// bersamaan, tetapi tetap membendung pengulangan liar.
const renewLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 600,
  keyGenerator: (req) => `renew:${req.ip}`,
  handler: balas429('Terlalu banyak permintaan perpanjangan sesi.'),
  standardHeaders: true,
  legacyHeaders: false,
});

// Rate limiting - More permissive for Bankeu uploads (1 juta proposals scenario)
const bankeuUploadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5000, // 5000 uploads per 15 minutes, per akun (atau per IP bila anonim)
  keyGenerator: kunciRateLimit,
  handler: balas429('Terlalu banyak unggahan.'),
  standardHeaders: true,
  legacyHeaders: false,
});

// Only apply rate limiting in production
if (process.env.NODE_ENV === 'production') {
  // Apply permissive rate limit to bankeu upload routes
  app.use('/api/desa/bankeu', bankeuUploadLimiter);
  app.use('/api/desa/bankeu-perubahan', bankeuUploadLimiter);
  app.use('/api/auth/renew', renewLimiter);
  app.use('/api/asta-desa', astaDesaLimiter);
  // Apply standard rate limit to other API routes
  app.use('/api/', limiter);
  logger.info('🛡️  Rate limiting enabled (akun 3000 / anonim 1000 req/15min API, Asta Desa 2000/akun, Bankeu 5000)');
} else {
  logger.info('⚠️  Rate limiting disabled for development');
}

// Body parsers with increased limits for file metadata
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Deteksi pola serangan (butuh body yang sudah diurai) dan kuota unggahan.
app.use(serverGuard.pemeriksa);
app.use('/api', serverGuard.kuotaUnggah);

// Compression
app.use(compression());

// Logging
if (process.env.NODE_ENV === 'development') {
  app.use(morgan('dev'));
} else {
  app.use(morgan('combined', {
    stream: { write: message => logger.info(message.trim()) }
  }));
}

// Static files - MUST BE BEFORE API ROUTES
// Handle favicon
app.get('/favicon.ico', (req, res) => res.status(204).end());

// Serve uploaded files with CORS headers
//
// Perhatian: ini menyajikan SELURUH direktori storage/ tanpa autentikasi.
// Jangan pernah menaruh berkas yang butuh kontrol akses di bawah storage/ —
// berkas Drive misalnya disimpan di private/ (sejajar storage/) dan hanya
// dilayani lewat controller. Penjaga di bawah menolak lintasan bernama
// "private" seandainya suatu saat ada yang membuatnya di sini.
app.use('/storage', (req, res, next) => {
  if (/(^|\/)private(\/|$)/i.test(req.path)) {
    return res.status(404).end();
  }
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Cross-Origin-Resource-Policy', 'cross-origin');
  next();
}, express.static(path.join(__dirname, '../storage')));

// Serve HLS (webinar broadcast). no-cache pada playlist agar pemutar ambil segmen baru.
app.use('/hls', (req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Cross-Origin-Resource-Policy', 'cross-origin');
  if (req.path.endsWith('.m3u8')) res.header('Cache-Control', 'no-cache, no-store, must-revalidate');
  next();
}, express.static(path.join(__dirname, '../storage/hls')));

app.use('/uploads', (req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Cross-Origin-Resource-Policy', 'cross-origin');
  next();
}, express.static(path.join(__dirname, '../storage/uploads')));

// Serve bankeu proposal files with fallback to bankeu_reference/ (for old/revised files)
app.get('/storage/uploads/bankeu/resolve/:filename', (req, res) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Cross-Origin-Resource-Policy', 'cross-origin');
  const filename = req.params.filename;
  const primaryPath = path.join(__dirname, '../storage/uploads/bankeu', filename);
  const fallbackPath = path.join(__dirname, '../storage/uploads/bankeu_reference', filename);
  
  if (fs.existsSync(primaryPath)) {
    return res.sendFile(primaryPath);
  } else if (fs.existsSync(fallbackPath)) {
    return res.sendFile(fallbackPath);
  } else {
    return res.status(404).json({ success: false, message: 'File tidak ditemukan' });
  }
});

// Serve bankeu LPJ files (supports nested kecamatan/desa folder structure)
app.get('/storage/uploads/bankeu_lpj/:kecamatanId/:desaId/:filename', (req, res) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Cross-Origin-Resource-Policy', 'cross-origin');
  const kecamatanId = path.basename(req.params.kecamatanId);
  const desaId = path.basename(req.params.desaId);
  const filename = path.basename(req.params.filename);
  const filePath = path.join(__dirname, '../storage/uploads/bankeu_lpj', kecamatanId, desaId, filename);
  
  if (fs.existsSync(filePath)) {
    return res.sendFile(filePath);
  } else {
    return res.status(404).json({ success: false, message: 'File tidak ditemukan' });
  }
});

// Backward compatibility: serve old flat bankeu LPJ files
app.get('/storage/uploads/bankeu_lpj/:filename', (req, res) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Cross-Origin-Resource-Policy', 'cross-origin');
  const filename = path.basename(req.params.filename);
  const filePath = path.join(__dirname, '../storage/uploads/bankeu_lpj', filename);
  
  if (fs.existsSync(filePath)) {
    return res.sendFile(filePath);
  } else {
    return res.status(404).json({ success: false, message: 'File tidak ditemukan' });
  }
});

// Serve Bantuan Provinsi LPJ files (supports nested kecamatan/desa folder structure)
app.get('/storage/uploads/bantuan_provinsi_lpj/:kecamatanId/:desaId/:filename', (req, res) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Cross-Origin-Resource-Policy', 'cross-origin');
  const kecamatanId = path.basename(req.params.kecamatanId);
  const desaId = path.basename(req.params.desaId);
  const filename = path.basename(req.params.filename);
  const filePath = path.join(__dirname, '../storage/uploads/bantuan_provinsi_lpj', kecamatanId, desaId, filename);

  if (fs.existsSync(filePath)) {
    return res.sendFile(filePath);
  } else {
    return res.status(404).json({ success: false, message: 'File tidak ditemukan' });
  }
});

// Backward compatibility: serve old flat Bantuan Provinsi LPJ files
app.get('/storage/uploads/bantuan_provinsi_lpj/:filename', (req, res) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Cross-Origin-Resource-Policy', 'cross-origin');
  const filename = path.basename(req.params.filename);
  const filePath = path.join(__dirname, '../storage/uploads/bantuan_provinsi_lpj', filename);

  if (fs.existsSync(filePath)) {
    return res.sendFile(filePath);
  } else {
    return res.status(404).json({ success: false, message: 'File tidak ditemukan' });
  }
});

// Serve public files (bankeu2025.json, etc)
app.use('/public', (req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Cross-Origin-Resource-Policy', 'cross-origin');
  next();
}, express.static(path.join(__dirname, '../public')));

logger.info(`📁 Static files served from: ${path.join(__dirname, '../storage')}`);

// Health check
app.get('/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

// API Routes
app.use('/api/public', publicRoutes); // Public endpoints (no auth)

app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes); // User management routes
app.use('/api/desa-admin', require('./routes/desaAdmin.routes')); // Manajemen akun oleh Admin Desa
app.use('/api/kecamatan-admin', require('./routes/kecamatanAdmin.routes')); // Akun utama kecamatan mengelola akun operatornya
app.use('/api/superadmin/backup', require('./routes/backup.routes')); // Unduh cadangan database & berkas
app.use('/api/superadmin/server', require('./routes/serverManagement.routes')); // Manajemen Server (pemantauan, storage, keamanan)
app.use('/api/roles', require('./routes/role.routes')); // Role management routes
app.use('/api/pegawai', pegawaiRoutes); // Pegawai routes
app.use('/api/absensi', require('./routes/absensi.routes')); // Absensi pegawai routes
// WAJIB sebelum '/api/bidang': bidangRoutes punya GET '/:id', yang akan
// menelan path satu segmen di bawahnya kalau urutannya terbalik.
app.use('/api/bidang/akun-desa', require('./routes/bidangAkunDesa.routes')); // Staf bidang membuat akun operator desa
app.use('/api/bidang', bidangRoutes); // Bidang routes
app.use('/api', locationRoutes); // Kecamatan & Desa routes

// App Settings routes (for edit mode, etc.)
app.use('/api/app-settings', require('./routes/appSettings.routes'));
app.use('/api/settings', require('./routes/settings.routes'));
app.use('/api/hari-libur', require('./routes/hariLibur.routes')); // Hari libur untuk blokir tanggal merah BA & SP

// Printer routes (for thermal printer)
app.use('/api/printer', require('./routes/printer.routes'));
app.use('/api/event-attendance', require('./routes/eventAttendance.routes'));

// Disposisi Surat routes
app.use('/api/surat-masuk', require('./routes/surat.routes'));
app.use('/api/disposisi', require('./routes/disposisi.routes'));
app.use('/api/bank-surat', require('./routes/bankSurat.routes'));
app.use('/api/nomor-surat', require('./routes/nomorSurat.routes'));

// Push Notifications routes - Modern Web Push API
app.use('/api/push-notification', require('./routes/pushNotification'));

// Cron test routes - For testing push notifications manually
app.use('/api/cron', require('./routes/cron.routes'));

app.use('/api/desa/bumdes', bumdesRoutes);
// Kerja Sama Desa — sisi desa (input) dan sisi DPMD/SPKED (pantau, hanya baca)
app.use('/api/desa/kerjasama', require('./routes/kerjasamaDesa.routes'));
app.use('/api/dpmd/kerjasama-desa', require('./routes/dpmdKerjasamaDesa.routes'));
// Agregat ikhtisar bidang SPKED (grafik BUM Desa & Bankeu)
app.use('/api/spked/ikhtisar', require('./routes/spkedIkhtisar.routes'));
// Ekspor BUM Desa (data lengkap .xlsx + arsip berkas .zip). HARUS di atas
// '/api/bumdes': bumdesRoutes punya rute '/:id' yang akan menelan '/ekspor'.
app.use('/api/bumdes/ekspor', require('./routes/bumdesEkspor.routes'));
app.use('/api/bumdes', bumdesRoutes); // Admin routes
// Pasar BUM Desa untuk publik (tanpa login) — dipakai landing page.
app.use('/api/public/bumdes', require('./routes/bumdesPublic.routes'));
app.use('/api/desa/musdesus', musdesusRoutes);
app.use('/api/musdesus', musdesusRoutes); // Admin routes
app.use('/api/desa', desaKelembagaanRoutes); // Desa kelembagaan routes (RW, RT, Posyandu, etc.)
app.use('/api/desa/aparatur-desa', aparaturDesaRoutes); // Aparatur Desa routes
app.use('/api/profil-desa', profilDesaRoutes); // Profil Desa routes
app.use('/api/desa/produk-hukum', produkHukumRoutes); // Produk Hukum routes (desa alias)
app.use('/api/desa/bankeu', bankeuProposalRoutes); // Bankeu proposal routes for desa
app.use('/api/desa/bankeu/surat', desaBankeuSuratRoutes); // Surat pengantar & permohonan (desa-level)
app.use('/api/kecamatan/bankeu/surat', gerbangOperatorKecamatan('bankeu'), kecamatanBankeuSuratRoutes); // Kecamatan review surat desa
app.use('/api/kecamatan/bankeu', gerbangOperatorKecamatan('bankeu'), bankeuVerificationRoutes); // Bankeu verification routes for kecamatan
app.use('/api/dinas/bankeu', dinasVerificationRoutes); // Bankeu verification routes for dinas terkait
app.use('/api/dpmd/bankeu', dpmdVerificationRoutes); // Bankeu verification routes for DPMD/SPKED
// Bankeu Perubahan 2026 - independent feature (Desa -> Kecamatan -> DPMD, skip Dinas)
app.use('/api/desa/bankeu-perubahan', bankeuPerubahanProposalRoutes);
app.use('/api/kecamatan/bankeu-perubahan', gerbangOperatorKecamatan('bankeu-perubahan'), bankeuPerubahanVerificationRoutes);
app.use('/api/kecamatan/bankeu-perubahan', gerbangOperatorKecamatan('bankeu-perubahan'), bankeuPerubahanConfigRoutes); // Config & tim verifikasi
app.use('/api/dpmd/bankeu-perubahan', bankeuPerubahanDpmdRoutes);
app.use('/api/dinas/bankeu-perubahan', dinasBankeuPerubahanRoutes); // Arsip & statistik read-only untuk Dinas/OPD (mis. DLH)
app.use('/api/dinas-pelihat/bankeu-perubahan', dinasPelihatBankeuPerubahanRoutes); // Arsip read-only utk dinas pelihat: BPKAD & Inspektorat (tanpa aksi)
app.use('/api/desa/bankeu-perubahan-lpj', bankeuPerubahanLpjRoutes);
app.use('/api/dpmd/bankeu-perubahan-lpj', dpmdBankeuPerubahanLpjRoutes);
app.use('/api/public/bankeu-perubahan', bankeuPerubahanPublicRoutes);

// Bankeu Perubahan: validate tim & quisioner kelengkapan untuk Berita Acara
app.use('/api/bankeu-perubahan/berita-acara', gerbangOperatorKecamatan('bankeu-perubahan'), bankeuPerubahanBeritaAcaraRoutes);
// Bankeu Perubahan: quisioner verifikasi
app.use('/api/bankeu-perubahan/questionnaire', gerbangOperatorKecamatan('bankeu-perubahan'), bankeuPerubahanQuestionnaireRoutes);
app.use('/api/desa/bankeu-lpj', bankeuLpjRoutes); // Bankeu LPJ upload routes for desa
app.use('/api/dpmd/bankeu-lpj', dpmdBankeuLpjRoutes); // Bankeu LPJ monitoring routes for DPMD/SPKED

app.use('/api/desa/bankeu-proposal-2025', bankeuProposal2025Routes); // Unggah proposal Bankeu TA 2025 oleh desa
app.use('/api/dpmd/bankeu-proposal-2025', dpmdBankeuProposal2025Routes); // Rekap proposal Bankeu TA 2025 untuk DPMD/SPKED
app.use('/api/desa/bantuan-provinsi-lpj', bantuanProvinsiLpjRoutes); // Bantuan Provinsi LPJ upload routes for desa
app.use('/api/dpmd/bantuan-provinsi-lpj', dpmdBantuanProvinsiLpjRoutes); // Bantuan Provinsi LPJ monitoring routes for DPMD/SPKED
app.use('/api/bankeu/master-kegiatan', bankeuMasterKegiatanRoutes); // Master kegiatan CRUD
app.use('/api/master/dinas', dinasRoutes); // Dinas master data CRUD
app.use('/api/dinas', require('./routes/dinasConfig.routes')); // Dinas configuration (TTD + PIC)
app.use('/api/dinas', dinasVerifikatorRoutes); // Dinas verifikator management
app.use('/api/dinas/verifikator', verifikatorAksesDesaRoutes); // Verifikator akses desa management
app.use('/api/verifikator/profile', require('./routes/verifikatorProfile.routes')); // Verifikator profile & TTD
app.use('/api/kecamatan/bumdes', gerbangOperatorKecamatan('bumdes'), require('./routes/kecamatanBumdes.routes')); // BUMDes di wilayah kecamatan (lihat saja)
app.use('/api/kecamatan/aparatur-desa', gerbangOperatorKecamatan('aparatur-desa'), require('./routes/kecamatanAparatur.routes')); // Aparatur desa di wilayah kecamatan (lihat saja)
// Tim verifikasi Bankeu dipasang di /api/kecamatan/:kecamatanId/bankeu/... — dijaga
// per segmen numerik supaya prefiks /api/kecamatan yang luas tidak ikut terkunci.
// (Regex di app.use tidak cocok di Express 4.21 — sudah diuji, jangan dikembalikan.)
const gerbangTimBankeu = gerbangOperatorKecamatan('bankeu');
app.use('/api/kecamatan/:kecamatanId/bankeu', (req, res, next) =>
  (/^\d+$/.test(req.params.kecamatanId) ? gerbangTimBankeu(req, res, next) : next()));
app.use('/api/kecamatan', require('./routes/kecamatanBankeuTimConfig.routes')); // Kecamatan tim verifikasi config
app.use('/api/kecamatan/kelembagaan', gerbangOperatorKecamatan('kelembagaan'), require('./routes/kecamatanKelembagaan.routes')); // Kecamatan kelembagaan verification
app.use('/api/bankeu/questionnaire', gerbangOperatorKecamatan('bankeu'), require('./routes/bankeuQuestionnaire.routes')); // Verification questionnaire
app.use('/api/berita-acara', gerbangOperatorKecamatan('bankeu'), beritaAcaraRoutes); // Berita Acara routes
app.use('/api/contoh-proposal', require('./routes/contohProposal.routes')); // Example proposal files
app.use('/api/hero-gallery', heroGalleryRoutes);
app.use('/api/kepala-dinas', kepalaDinasRoutes); // Kepala Dinas dashboard
app.use('/api/prolap', require('./routes/prolap.routes')); // Prolap — rekap output kegiatan (Sekretariat)
app.use('/api/jadwal-kegiatan', require('./routes/jadwalKegiatan.routes')); // Jadwal Kegiatan routes
app.use('/api/status', require('./routes/status.routes')); // User status/story routes
app.use('/api/perjadin', perjadinRoutes); // Perjadin (Perjalanan Dinas) routes
app.use('/api/berita', require('./routes/berita.routes')); // Berita routes
app.use('/api/informasi', require('./routes/informasi.routes')); // Informasi banner routes (Sekretariat)
app.use('/api/arsip-barang', require('./routes/arsipBarang.routes')); // Arsip Barang / inventaris (Sekretariat)
// Drive per bidang. Berkasnya di storage/private/ — TIDAK dipetakan ke rute
// statis mana pun; satu-satunya jalan mengambil berkas adalah lewat
// /api/drive/file/:id/unduh yang memeriksa izin lebih dulu.
app.use('/api/drive', require('./routes/drive.routes'));
// Formulir per bidang (seperti Google Forms). /api/formulir/publik/* sengaja
// TIDAK memakai auth — itu jalur pengisian lewat tautan yang dibagikan; sisanya
// wajib login. Lampiran jawaban ikut disimpan di private/, bukan storage/.
app.use('/api/formulir', require('./routes/formulir.routes'));
// Video Desa: bidang meminta video (videotron & media sosial) dari desa lewat
// tautan publik. /api/video-desa/publik/* tanpa auth (unggahan bertahap per
// potongan); /putar/:id memakai tautan bertanda tangan. Videonya di private/.
app.use('/api/video-desa', require('./routes/videoDesa.routes'));
app.use('/api/activity-logs', require('./routes/activityLog.routes')); // Global Activity Logs (Superadmin)
app.use('/api/kelembagaan', gerbangOperatorKecamatan('kelembagaan'), kelembagaanRoutes); // Kelembagaan routes (admin/global)
app.use('/api/kelembagaan/activity-logs', require('./routes/kelembagaanActivityLogs.routes')); // Activity logs
app.use('/api/activity-logs', require('./routes/activityLogs.routes')); // General activity logs (bankeu, etc.)
app.use('/api/admin', kelembagaanRoutes); // Admin alias for kelembagaan
app.use('/api/produk-hukum', produkHukumRoutes); // Produk Hukum routes
app.use('/api/bankeu-t1', bankeuT1Routes); // Bantuan Keuangan Tahap 1
app.use('/api/bankeu-t2', bankeuT2Routes); // Bantuan Keuangan Tahap 2
app.use('/api/public/bankeu', require('./routes/bankeuPublic.routes')); // Public bankeu transparency (no auth)
app.use('/api/add', addRoutes); // ADD (Alokasi Dana Desa) routes
app.use('/api/dd', ddRoutes); // DD (Dana Desa) routes
app.use('/api/dd-earmarked-t1', ddEarmarkedT1Routes); // DD Earmarked Tahap 1
app.use('/api/dd-earmarked-t2', ddEarmarkedT2Routes); // DD Earmarked Tahap 2
app.use('/api/dd-nonearmarked-t1', ddNonEarmarkedT1Routes); // DD Non-Earmarked Tahap 1
app.use('/api/dd-nonearmarked-t2', ddNonEarmarkedT2Routes); // DD Non-Earmarked Tahap 2
app.use('/api/insentif-dd', insentifDdRoutes); // Insentif DD
app.use('/api/bhprd', bhprdRoutes); // BHPRD (Bagi Hasil Pajak dan Retribusi Daerah) routes
app.use('/api/bhprd-t1', bhprdT1Routes); // BHPRD Tahap 1
app.use('/api/bhprd-t2', bhprdT2Routes); // BHPRD Tahap 2
app.use('/api/bhprd-t3', bhprdT3Routes); // BHPRD Tahap 3

// Pemdes Aparatur Desa routes (bidang-level, from local DB)
app.use('/api/pemdes/aparatur-desa', pemdesAparaturRoutes);

// Pemdes Profil Desa routes (bidang-level, all desas)
app.use('/api/pemdes/profil-desa', pemdesProfilDesaRoutes);

// Pemdes Produk Hukum routes (bidang-level, all desas)
app.use('/api/pemdes/produk-hukum', require('./routes/pemdes-produk-hukum.routes'));
app.use('/api/produk-hukum-bidang', require('./routes/produkHukumBidang.routes')); // Produk hukum tingkat kabupaten per bidang
app.use('/api/produk-hukum-gabungan', require('./routes/produkHukumGabungan.routes')); // Ringkasan desa + bidang + referensi
app.use('/api/gema', require('./routes/gema.routes')); // Asisten suara Core Dashboard
app.use('/api/asta-desa', require('./routes/astadesa.routes')); // Proxy baca API super admin ASTA DESA
// API Asta Desa untuk pihak Bupati — dijaga API key, bukan login DPMD. Namespace
// '/api/eksternal' dipisah dari '/api/public' supaya tidak ada yang mengira
// endpoint ini terbuka seperti tetangga-tetangganya di sana.
app.use('/api/eksternal/asta-desa', require('./routes/astaDesaBupati.routes'));

// Video Meeting routes (SFU mediasoup) — aktif kembali setelah port RTC dibuka
app.use('/api/video-meetings', require('./routes/videoMeeting.routes'));

// Chatbot Smart Search routes
app.use('/api/chatbot', chatbotRoutes);

// Messaging / Chat routes
app.use('/api/messaging', gerbangOperatorKecamatan('pesan'), require('./routes/messaging.routes'));

// Anggaran Bidang routes
app.use('/api/anggaran', anggaranRoutes);
app.use('/api/anggaran-kas', anggaranKasRoutes);
app.use('/api/rekening-ref', rekeningRefRoutes);

// Pencairan & master Penyedia (modul realisasi anggaran)
app.use('/api/penyedia', penyediaRoutes);
app.use('/api/pencairan-sk', pencairanSkRefRoutes);
app.use('/api/pencairan', pencairanRoutes);

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: 'Route not found'
  });
});

// Error handler
app.use(errorHandler);

const PORT = process.env.PORT || 3001;

// Create HTTP server
const server = http.createServer(app);

// Socket.io (messaging + video meeting signaling)
const { initSocketServer } = require('./socket/meeting.socket');
const mediasoupService = require('./services/mediasoup.service');

// Start server
function startServer() {
  server.on('error', (error) => {
    logger.error('❌ Server listen error:', error);
    process.exit(1);
  });

  server.listen(PORT, () => {
    logger.info(`🚀 Server running on port ${PORT}`);
    logger.info(`📝 Environment: ${process.env.NODE_ENV}`);
    logger.info(`🔗 CORS enabled for: ${process.env.CORS_ORIGIN}`);
    // Initialize Socket.io (messaging + video meeting signaling)
    initSocketServer(server);
    logger.info('🔌 Socket.io initialized');

    // Initialize mediasoup SFU workers untuk video meeting. Dibungkus agar
    // kegagalan init (mis. worker binary) tidak meng-crash server — signaling
    // akan membalas error ramah "Mediasoup not initialized" bila gagal.
    mediasoupService.init()
      .then(() => logger.info(`🎥 Video Meeting: ENABLED (announcedIp=${process.env.MEDIASOUP_ANNOUNCED_IP || '127.0.0.1'})`))
      .catch((err) => logger.error('🎥 Video Meeting: gagal init mediasoup —', err.message));

    // Initialize scheduler for push notifications
    schedulerService.init();

    // Pemantau Manajemen Server (metrik, keamanan, storage, uptime). Masing-
    // masing hanya memasang timer ber-unref, jadi tidak menahan proses.
    try {
      require('./services/serverMetrics.service').start();
      require('./services/serverSecurity.service').start();
      require('./services/serverStorage.service').start();
      require('./services/serverApps.service').start();
      require('./services/serverProxmox.service').start();
      logger.info('🖥️  Server monitor aktif');
    } catch (err) {
      logger.error('🖥️  Server monitor gagal dijalankan —', err.message);
    }

    // Rekonsiliasi arsip Dapur Desa otomatis (data desa menang bila ada di
    // keduanya). Idempoten; ditunda supaya tidak berebut dengan pemanasan lain.
    setTimeout(() => {
      require('./controllers/aparatur-desa.controller').rekonsiliasiOtomatis()
        .then((hasil) => logger.info(`🧾 Rekonsiliasi Dapur Desa otomatis: ${JSON.stringify(hasil)}`))
        .catch((err) => logger.error('🧾 Rekonsiliasi Dapur Desa gagal —', err.message));
    }, 30000).unref();

    // Siapkan penyusuran ASTA DESA di latar supaya halaman Core Dashboard tidak
    // pernah menunggu penyusuran ribuan halaman saat dibuka.
    try {
      require('./controllers/astadesa.controller').mulaiPemanasan();
    } catch (err) {
      logger.error('Pemanasan ASTA DESA gagal dijalankan —', err.message);
    }

    // Auto-seed bankeu_perubahan_master_kegiatan (idempotent)
    // Fire-and-forget - jangan blocking startup, error tidak akan crash server
    const { seedBankeuPerubahanMasterKegiatan } = require('./utils/seedBankeuPerubahanMaster');
    seedBankeuPerubahanMasterKegiatan()
      .then(result => {
        if (result.seeded > 0) {
          logger.info(`🌱 Bankeu Perubahan master kegiatan seeded: ${result.seeded} items`);
        }
      })
      .catch(err => logger.warn('[Startup Seed] bankeu_perubahan_master_kegiatan:', err.message));

    // Signal PM2 that the app is ready (enables --wait-ready graceful reload)
    if (process.send) {
      process.send('ready');
    }
  });
}

startServer();

module.exports = app;
