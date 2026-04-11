const express = require('express');
const http = require('http');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

// Fix BigInt serialization for JSON
BigInt.prototype.toJSON = function() {
  return this.toString();
};

// Initialize Sequelize models FIRST before any routes
const { sequelize } = require('./models');

const logger = require('./utils/logger');
const errorHandler = require('./middlewares/errorHandler');
const schedulerService = require('./services/scheduler.service');

// Ensure required directories exist
const requiredDirs = [
  path.join(__dirname, '../storage/uploads/temp'),
  path.join(__dirname, '../storage/uploads/peraturan'),
  path.join(__dirname, '../storage/uploads/produk-hukum'),
  path.join(__dirname, '../storage/uploads/bumdes_dokumen_badanhukum'),
  path.join(__dirname, '../storage/uploads/bumdes_laporan_keuangan'),
  path.join(__dirname, '../storage/uploads/bumdes'),
  path.join(__dirname, '../storage/uploads/profil_desa'),
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
const dinasRoutes = require('./routes/dinas.routes');
const dinasVerificationRoutes = require('./routes/dinasVerification.routes');
const dpmdVerificationRoutes = require('./routes/dpmdVerification.routes');
const bankeuLpjRoutes = require('./routes/bankeuLpj.routes');
const dpmdBankeuLpjRoutes = require('./routes/dpmdBankeuLpj.routes');
const dinasVerifikatorRoutes = require('./routes/dinasVerifikator.routes');
const verifikatorAksesDesaRoutes = require('./routes/verifikatorAksesDesa.routes');
const beritaAcaraRoutes = require('./routes/beritaAcara.routes');
const perjadinRoutes = require('./routes/perjadin.routes');
const externalApiRoutes = require('./routes/externalApi.routes');
const pemdesAparaturRoutes = require('./routes/pemdes-aparatur.routes');
const pemdesProfilDesaRoutes = require('./routes/pemdes-profil-desa.routes');
const chatbotRoutes = require('./routes/chatbot.routes');

const app = express();

// Trust proxy for reverse proxy chain (OpenResty/CDN -> Nginx -> Express)
// Use 2 for two reverse proxies to get real client IP for rate limiting
app.set('trust proxy', 2);

// Security middleware - Configure helmet to allow PDF embedding via object tag
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      frameAncestors: ["'self'", "http://localhost:5173", "https://dpmd.bogorkab.go.id", "https://dpmdbogorkab.id"],
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
      'https://dpmdbogorkab.id',
      'http://dpmdbogorkab.id'
    ];

app.use(cors({
  origin: allowedOrigins,
  credentials: true
}));

// Rate limiting - Standard API requests
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 1000, // 1000 requests per windowMs
  message: 'Terlalu banyak request dari IP ini, silakan coba lagi nanti.',
  standardHeaders: true,
  legacyHeaders: false,
});

// Rate limiting - More permissive for Bankeu uploads (1 juta proposals scenario)
const bankeuUploadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5000, // 5000 uploads per 15 minutes per IP
  message: 'Terlalu banyak upload, silakan tunggu beberapa menit.',
  standardHeaders: true,
  legacyHeaders: false,
});

// Only apply rate limiting in production
if (process.env.NODE_ENV === 'production') {
  // Apply permissive rate limit to bankeu upload routes
  app.use('/api/desa/bankeu', bankeuUploadLimiter);
  // Apply standard rate limit to other API routes
  app.use('/api/', limiter);
  logger.info('🛡️  Rate limiting enabled (1000 req/15min API, 5000 req/15min Bankeu uploads)');
} else {
  logger.info('⚠️  Rate limiting disabled for development');
}

// Body parsers with increased limits for file metadata
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

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
app.use('/storage', (req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Cross-Origin-Resource-Policy', 'cross-origin');
  next();
}, express.static(path.join(__dirname, '../storage')));

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
app.use('/api/roles', require('./routes/role.routes')); // Role management routes
app.use('/api/pegawai', pegawaiRoutes); // Pegawai routes
app.use('/api/absensi', require('./routes/absensi.routes')); // Absensi pegawai routes
app.use('/api/bidang', bidangRoutes); // Bidang routes
app.use('/api', locationRoutes); // Kecamatan & Desa routes

// App Settings routes (for edit mode, etc.)
app.use('/api/app-settings', require('./routes/appSettings.routes'));
app.use('/api/settings', require('./routes/settings.routes'));

// Printer routes (for thermal printer)
app.use('/api/printer', require('./routes/printer.routes'));

// Disposisi Surat routes
app.use('/api/surat-masuk', require('./routes/surat.routes'));
app.use('/api/disposisi', require('./routes/disposisi.routes'));

// Push Notifications routes - Modern Web Push API
app.use('/api/push-notification', require('./routes/pushNotification'));

// Cron test routes - For testing push notifications manually
app.use('/api/cron', require('./routes/cron.routes'));

app.use('/api/desa/bumdes', bumdesRoutes);
app.use('/api/bumdes', bumdesRoutes); // Admin routes
app.use('/api/desa/musdesus', musdesusRoutes);
app.use('/api/musdesus', musdesusRoutes); // Admin routes
app.use('/api/desa', desaKelembagaanRoutes); // Desa kelembagaan routes (RW, RT, Posyandu, etc.)
app.use('/api/desa/aparatur-desa', aparaturDesaRoutes); // Aparatur Desa routes
app.use('/api/profil-desa', profilDesaRoutes); // Profil Desa routes
app.use('/api/desa/produk-hukum', produkHukumRoutes); // Produk Hukum routes (desa alias)
app.use('/api/desa/bankeu', bankeuProposalRoutes); // Bankeu proposal routes for desa
app.use('/api/desa/bankeu/surat', desaBankeuSuratRoutes); // Surat pengantar & permohonan (desa-level)
app.use('/api/kecamatan/bankeu/surat', kecamatanBankeuSuratRoutes); // Kecamatan review surat desa
app.use('/api/kecamatan/bankeu', bankeuVerificationRoutes); // Bankeu verification routes for kecamatan
app.use('/api/dinas/bankeu', dinasVerificationRoutes); // Bankeu verification routes for dinas terkait
app.use('/api/dpmd/bankeu', dpmdVerificationRoutes); // Bankeu verification routes for DPMD/SPKED
app.use('/api/desa/bankeu-lpj', bankeuLpjRoutes); // Bankeu LPJ upload routes for desa
app.use('/api/dpmd/bankeu-lpj', dpmdBankeuLpjRoutes); // Bankeu LPJ monitoring routes for DPMD/SPKED
app.use('/api/bankeu/master-kegiatan', bankeuMasterKegiatanRoutes); // Master kegiatan CRUD
app.use('/api/master/dinas', dinasRoutes); // Dinas master data CRUD
app.use('/api/dinas', require('./routes/dinasConfig.routes')); // Dinas configuration (TTD + PIC)
app.use('/api/dinas', dinasVerifikatorRoutes); // Dinas verifikator management
app.use('/api/dinas/verifikator', verifikatorAksesDesaRoutes); // Verifikator akses desa management
app.use('/api/verifikator/profile', require('./routes/verifikatorProfile.routes')); // Verifikator profile & TTD
app.use('/api/kecamatan', require('./routes/kecamatanBankeuTimConfig.routes')); // Kecamatan tim verifikasi config
app.use('/api/bankeu/questionnaire', require('./routes/bankeuQuestionnaire.routes')); // Verification questionnaire
app.use('/api/berita-acara', beritaAcaraRoutes); // Berita Acara routes
app.use('/api/contoh-proposal', require('./routes/contohProposal.routes')); // Example proposal files
app.use('/api/hero-gallery', heroGalleryRoutes);
app.use('/api/kepala-dinas', kepalaDinasRoutes); // Kepala Dinas dashboard
app.use('/api/jadwal-kegiatan', require('./routes/jadwalKegiatan.routes')); // Jadwal Kegiatan routes
app.use('/api/perjadin', perjadinRoutes); // Perjadin (Perjalanan Dinas) routes
app.use('/api/berita', require('./routes/berita.routes')); // Berita routes
app.use('/api/informasi', require('./routes/informasi.routes')); // Informasi banner routes (Sekretariat)
app.use('/api/activity-logs', require('./routes/activityLog.routes')); // Global Activity Logs (Superadmin)
app.use('/api/kelembagaan', kelembagaanRoutes); // Kelembagaan routes (admin/global)
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

// External API Proxy routes (DPMD Bogorkab)
app.use('/api/external', externalApiRoutes);

// Pemdes Aparatur Desa routes (bidang-level, from local DB)
app.use('/api/pemdes/aparatur-desa', pemdesAparaturRoutes);

// Pemdes Profil Desa routes (bidang-level, all desas)
app.use('/api/pemdes/profil-desa', pemdesProfilDesaRoutes);

// Pemdes Produk Hukum routes (bidang-level, all desas)
app.use('/api/pemdes/produk-hukum', require('./routes/pemdes-produk-hukum.routes'));

// Video Meeting routes
app.use('/api/video-meetings', require('./routes/videoMeeting.routes'));

// Chatbot Smart Search routes
app.use('/api/chatbot', chatbotRoutes);

// Messaging / Chat routes
app.use('/api/messaging', require('./routes/messaging.routes'));

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

// Initialize Socket.io for video meetings
const { initSocketServer } = require('./socket/meeting.socket');
const mediasoupService = require('./services/mediasoup.service');

// Start server
async function startServer() {
  try {
    // Initialize mediasoup workers
    await mediasoupService.init();
    logger.info('📹 Mediasoup workers initialized');

    // Initialize Socket.io signaling server
    initSocketServer(server);
    logger.info('🔌 Socket.io signaling server initialized');

    server.listen(PORT, () => {
      logger.info(`🚀 Server running on port ${PORT}`);
      logger.info(`📝 Environment: ${process.env.NODE_ENV}`);
      logger.info(`🔗 CORS enabled for: ${process.env.CORS_ORIGIN}`);
      logger.info(`📹 Video Meeting: WebRTC + mediasoup ready`);
      
      // Initialize scheduler for push notifications
      schedulerService.init();
    });
  } catch (error) {
    logger.error('❌ Failed to start server:', error);
    process.exit(1);
  }
}

startServer();

module.exports = app;
