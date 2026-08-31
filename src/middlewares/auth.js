const jwt = require('jsonwebtoken');
const logger = require('../utils/logger');
const prisma = require('../config/prisma');

const JWT_SECRET = process.env.JWT_SECRET;
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';

// Ambang perpanjangan token: begitu sisa umur token kurang dari ini, request
// berikutnya dibalas dengan token baru lewat header X-Renewed-Token. Dipasang
// lebih dari separuh JWT_EXPIRES_IN supaya user yang membuka aplikasi sesekali
// saja tetap terperpanjang sebelum tokennya mati.
const RENEW_IF_REMAINING_MS = 4 * 24 * 60 * 60 * 1000; // 4 hari

// Throttle last_active_at updates: max once per 60s per user
const lastActiveCache = new Map();
const ACTIVE_THROTTLE_MS = 60 * 1000;

const updateLastActive = (userId) => {
  const now = Date.now();
  const last = lastActiveCache.get(userId);
  if (last && now - last < ACTIVE_THROTTLE_MS) return;
  lastActiveCache.set(userId, now);
  prisma.users.update({
    where: { id: BigInt(userId) },
    data: { last_active_at: new Date() }
  }).catch(() => {}); // fire-and-forget
};

// Sesi di aplikasi ini tidak pernah kedaluwarsa, sedangkan role ikut di dalam JWT.
// Tanpa pengecekan ini, user yang rolenya berubah di database (mis. saat migrasi
// desa -> admin_desa) akan terus dilayani memakai role lama sampai dia logout
// sendiri — dan dia tidak punya alasan untuk logout karena tidak ada error.
const ROLE_CACHE_TTL_MS = 60 * 1000;
const roleCache = new Map(); // userId(string) -> { role, expiresAt }

const getCurrentRole = async (userId) => {
  const key = String(userId);
  const cached = roleCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.role;

  const user = await prisma.users.findUnique({
    where: { id: BigInt(key) },
    select: { role: true }
  });
  const role = user ? user.role : null;
  roleCache.set(key, { role, expiresAt: Date.now() + ROLE_CACHE_TTL_MS });
  return role;
};

/** Dipanggil saat role user diubah agar token lamanya langsung ditolak. */
const invalidateRoleCache = (userId) => {
  if (userId === undefined || userId === null) return;
  roleCache.delete(String(userId));
};

// Express JWT Auth Middleware (Independent from Laravel)
const auth = async (req, res, next) => {
  try {
    // Get token from header
    const token = req.header('Authorization')?.replace('Bearer ', '');

    if (!token) {
      logger.warn('No token provided');
      return res.status(401).json({
        success: false,
        message: 'No authentication token provided'
      });
    }

    // Verify Express JWT token
    const decoded = jwt.verify(token, JWT_SECRET);
    
    // Attach user to request
    // Coerce desa_id to integer to satisfy Prisma Int fields
    const desaId = decoded.desa_id !== undefined && decoded.desa_id !== null
      ? parseInt(decoded.desa_id, 10)
      : null;

    // Coerce bidang_id to integer
    const bidangId = decoded.bidang_id !== undefined && decoded.bidang_id !== null
      ? parseInt(decoded.bidang_id, 10)
      : null;

    // Coerce dinas_id to integer
    const dinasId = decoded.dinas_id !== undefined && decoded.dinas_id !== null
      ? parseInt(decoded.dinas_id, 10)
      : null;

    // Coerce kecamatan_id to integer
    const kecamatanId = decoded.kecamatan_id !== undefined && decoded.kecamatan_id !== null
      ? parseInt(decoded.kecamatan_id, 10)
      : null;

    req.user = {
      id: decoded.id,
      name: decoded.name,
      email: decoded.email,
      role: decoded.role,
      desa_id: Number.isNaN(desaId) ? null : desaId,
      bidang_id: Number.isNaN(bidangId) ? null : bidangId,
      dinas_id: Number.isNaN(dinasId) ? null : dinasId,
      kecamatan_id: Number.isNaN(kecamatanId) ? null : kecamatanId
    };
    
    // Tolak token yang rolenya sudah tidak sama dengan database supaya user
    // dipaksa login ulang dan mendapat token baru. Sengaja fail-open: bila
    // pengecekan gagal (mis. database sedang bermasalah), request tetap diteruskan
    // agar tidak menjatuhkan seluruh aplikasi.
    try {
      const currentRole = await getCurrentRole(req.user.id);
      if (currentRole !== null && String(currentRole) !== String(req.user.role)) {
        logger.warn(`🔄 Role berubah untuk user ${req.user.id}: token "${req.user.role}" vs database "${currentRole}" — minta login ulang`);
        return res.status(401).json({
          success: false,
          code: 'ROLE_CHANGED',
          message: 'Hak akses akun Anda telah diperbarui. Silakan login kembali.'
        });
      }
    } catch (roleCheckError) {
      logger.error('Gagal memeriksa role terkini:', roleCheckError.message);
    }

    logger.info(`✅ Auth successful: User ${req.user.id} (${req.user.role}) - Bidang: ${req.user.bidang_id} - Kecamatan: ${req.user.kecamatan_id}`);

    // Perpanjang token yang mendekati kedaluwarsa. Sesi di klien memang tidak
    // pernah kedaluwarsa, tapi JWT-nya berumur JWT_EXPIRES_IN (7 hari) dan tidak
    // ada mekanisme perpanjangan — jadi setiap 7 hari sekali user terlempar
    // keluar di tengah pemakaian, paling terasa di PWA yang tidak pernah ditutup.
    // Selama user membuka aplikasi dalam masa berlaku, tokennya bergulir sendiri.
    // Header ini diabaikan begitu saja oleh klien versi lama.
    try {
      const sisaMs = decoded.exp ? decoded.exp * 1000 - Date.now() : 0;
      if (sisaMs > 0 && sisaMs < RENEW_IF_REMAINING_MS) {
        res.setHeader('X-Renewed-Token', generateToken(req.user));
        logger.info(`♻️  Token diperpanjang untuk user ${req.user.id} (sisa ${Math.round(sisaMs / 3600000)} jam)`);
      }
    } catch (renewError) {
      // Gagal memperpanjang bukan alasan menolak request yang tokennya masih sah.
      logger.error('Gagal memperpanjang token:', renewError.message);
    }

    // Update last_active_at (throttled, fire-and-forget)
    updateLastActive(req.user.id);

    next();
  } catch (error) {
    if (error.name === 'JsonWebTokenError') {
      logger.warn('Invalid token format');
      return res.status(401).json({
        success: false,
        message: 'Invalid token'
      });
    }
    
    if (error.name === 'TokenExpiredError') {
      logger.warn('Token expired');
      return res.status(401).json({
        success: false,
        message: 'Token expired'
      });
    }
    
    logger.error('Authentication failed:', error.message);
    return res.status(401).json({
      success: false,
      message: 'Authentication failed'
    });
  }
};

// Role-based middleware
// Supports both direct role checks AND bidang-based pseudo-roles.
// Some routes specify bidang names as roles (e.g., 'kekayaan_keuangan', 'sarana_prasarana').
// These don't match any actual user.role — they map to bidang_id instead.
const BIDANG_ROLE_MAP = {
  'sekretariat': 2,        // Sekretariat
  'sarana_prasarana': 3,    // Bidang Sarana Prasarana Kewilayahan dan Ekonomi Desa
  'kekayaan_keuangan': 4,   // Bidang Kekayaan dan Keuangan Desa
  'pemberdayaan_masyarakat': 5, // Bidang Pemberdayaan Masyarakat Desa
  'pemerintahan_desa': 6,   // Bidang Pemerintahan Desa
};

const checkRole = (...roles) => {
  return (req, res, next) => {
    if (!req.user) {
      logger.warn('❌ Role check failed: No user in request');
      return res.status(401).json({
        success: false,
        message: 'Unauthorized - No user found'
      });
    }

    if (!req.user.role) {
      logger.warn(`❌ Role check failed: User ${req.user.id} has no role defined`);
      return res.status(403).json({
        success: false,
        message: 'Access forbidden - No role assigned'
      });
    }

    // Normalize user role (trim whitespace, lowercase)
    const userRole = String(req.user.role).trim().toLowerCase();
    // Flatten in case array of arrays passed
    const flatRoles = roles.flat();
    const allowedRoles = flatRoles.map(r => String(r).trim().toLowerCase());

    logger.info(`🔐 Role check - User: ${req.user.email} | User role: "${userRole}" | bidang_id: ${req.user.bidang_id} | Allowed roles: [${allowedRoles.join(', ')}]`);

    // 1. Direct role match
    if (allowedRoles.includes(userRole)) {
      logger.info(`✅ Role check passed (direct) - User ${req.user.email} (${userRole}) authorized`);
      return next();
    }

    // 2. Bidang-based match: check if user's bidang_id matches any bidang pseudo-role
    if (req.user.bidang_id) {
      const userBidangId = parseInt(req.user.bidang_id);
      for (const role of allowedRoles) {
        if (BIDANG_ROLE_MAP[role] && BIDANG_ROLE_MAP[role] === userBidangId) {
          logger.info(`✅ Role check passed (bidang) - User ${req.user.email} (role: ${userRole}, bidang_id: ${userBidangId}) authorized via bidang "${role}"`);
          return next();
        }
      }
    }

    logger.warn(`❌ Access forbidden - User ${req.user.email} with role "${userRole}" (bidang_id: ${req.user.bidang_id}) not authorized`);
    return res.status(403).json({
      success: false,
      message: `Access forbidden - Role "${req.user.role}" not authorized`,
      debug: {
        userRole: req.user.role,
        allowedRoles: roles
      }
    });
  };
};

// Bidang-based middleware for absensi admin
// Allows: superadmin OR users whose bidang = 'Sekretariat'
const checkAbsensiAdmin = async (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ success: false, message: 'Unauthorized' });
  }

  // Superadmin always allowed
  if (req.user.role === 'superadmin') {
    return next();
  }

  // Sekretaris dinas always allowed (inherits sekretariat access)
  if (req.user.role === 'sekretaris_dinas') {
    logger.info(`✅ Absensi admin check passed - User ${req.user.email} is sekretaris_dinas`);
    return next();
  }

  // Check if user's bidang is Sekretariat
  if (req.user.bidang_id) {
    try {
      const prisma = require('../config/prisma');
      const bidang = await prisma.bidangs.findUnique({
        where: { id: BigInt(req.user.bidang_id) },
        select: { nama: true }
      });

      if (bidang && bidang.nama.toLowerCase().includes('sekretariat')) {
        logger.info(`✅ Absensi admin check passed - User ${req.user.email} bidang: ${bidang.nama}`);
        return next();
      }
    } catch (error) {
      logger.error('Error checking bidang for absensi admin:', error.message);
    }
  }

  logger.warn(`❌ Absensi admin access denied - User ${req.user.email} (role: ${req.user.role}, bidang_id: ${req.user.bidang_id})`);
  return res.status(403).json({
    success: false,
    message: 'Akses ditolak - Hanya superadmin atau bidang Sekretariat yang dapat mengakses'
  });
};

// Generate JWT token
const generateToken = (user) => {
  // Convert all BigInt fields to strings for JWT serialization
  const convertBigInt = (value) => {
    if (value === null || value === undefined) return value;
    return typeof value === 'bigint' ? value.toString() : value;
  };

  return jwt.sign(
    {
      id: convertBigInt(user.id),
      name: user.name,
      email: user.email,
      role: user.role,
      desa_id: convertBigInt(user.desa_id),
      kecamatan_id: convertBigInt(user.kecamatan_id),
      bidang_id: convertBigInt(user.bidang_id),
      dinas_id: convertBigInt(user.dinas_id)
    },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN }
  );
};

// Middleware to check if user has dinas_terkait or verifikator_dinas role and dinas_id
const authorizeDinas = async (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({
      success: false,
      message: 'Unauthorized - No user found'
    });
  }

  const allowedDinasRoles = ['dinas_terkait', 'verifikator_dinas'];
  if (!allowedDinasRoles.includes(req.user.role)) {
    logger.warn(`❌ Dinas access denied - User ${req.user.email} has role ${req.user.role}, expected one of: ${allowedDinasRoles.join(', ')}`);
    return res.status(403).json({
      success: false,
      message: 'Access forbidden - Requires dinas role'
    });
  }

  if (!req.user.dinas_id) {
    logger.warn(`❌ Dinas access denied - User ${req.user.email} has no dinas_id assigned`);
    return res.status(403).json({
      success: false,
      message: 'Access forbidden - No dinas assignment found'
    });
  }

  // Dinas pelihat (BPKAD/Inspektorat) hanya PELIHAT: seluruh jalur
  // verifikasi/pengelolaan dinas (Bankeu reguler, verifikator, akses desa)
  // tertutup untuknya. Satu-satunya pintu mereka adalah /api/dinas-pelihat/*
  // yang read-only.
  if (await isDinasPelihatAccount(req.user)) {
    logger.warn(`❌ Dinas access denied - Akun pelihat ${req.user.email} hanya punya akses lihat`);
    return res.status(403).json({
      success: false,
      message: 'Akun ini hanya memiliki akses lihat (Bantuan Keuangan Perubahan)'
    });
  }

  logger.info(`✅ Dinas authorization passed - User ${req.user.email} (dinas_id: ${req.user.dinas_id}, role: ${req.user.role})`);
  next();
};

/**
 * Tolak akun dinas pelihat pada rute yang dijaga checkRole (bukan
 * authorizeDinas), mis. pengelolaan verifikator dinas. Dipakai berdampingan
 * dengan checkRole.
 */
const denyDinasPelihat = async (req, res, next) => {
  try {
    if (await isDinasPelihatAccount(req.user)) {
      logger.warn(`❌ Akses ditolak - Akun pelihat ${req.user?.email} mencoba rute pengelolaan dinas`);
      return res.status(403).json({
        success: false,
        message: 'Akun ini hanya memiliki akses lihat (Bantuan Keuangan Perubahan)'
      });
    }
    next();
  } catch (error) {
    logger.error('denyDinasPelihat error:', error);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

// Kode dinas (di master_dinas) yang berperan PELIHAT: hanya boleh membaca &
// mengunduh arsip Bankeu Perubahan, tidak pernah memverifikasi atau mengubah
// apa pun. Menambah OPD pelihat baru cukup dengan menambah kodenya di sini
// (dan barisnya di master_dinas).
const KODE_DINAS_PELIHAT = ['BPKAD', 'INSPEKTORAT'];

// Cache kecil id dinas -> kode_dinas supaya tidak query master_dinas tiap request.
const dinasKodeCache = new Map();
const getKodeDinas = async (dinasId) => {
  const key = Number(dinasId);
  if (dinasKodeCache.has(key)) return dinasKodeCache.get(key);
  const dinas = await prisma.master_dinas.findUnique({
    where: { id: key },
    select: { kode_dinas: true }
  });
  const kode = dinas?.kode_dinas || null;
  dinasKodeCache.set(key, kode);
  return kode;
};

// Apakah user ini akun dinas pelihat (BPKAD/Inspektorat)? Dipakai untuk
// membuka akses lihat sekaligus menutup akses tulis di rute dinas lainnya.
const isDinasPelihatAccount = async (user) => {
  if (!user || !user.dinas_id) return false;
  return KODE_DINAS_PELIHAT.includes(await getKodeDinas(user.dinas_id));
};

/**
 * Require dinas pelihat (read-only)
 * Hanya akun dinas yang kode dinasnya terdaftar di KODE_DINAS_PELIHAT yang
 * lolos. Dipakai untuk endpoint arsip Bankeu Perubahan versi lihat-saja; tidak
 * ada satupun endpoint tulis yang memakai middleware ini.
 */
const authorizeDinasPelihat = async (req, res, next) => {
  try {
    if (!req.user) {
      return res.status(401).json({ success: false, message: 'Unauthorized - No user found' });
    }

    const allowedRoles = ['dinas_terkait', 'verifikator_dinas'];
    if (!allowedRoles.includes(req.user.role) || !req.user.dinas_id) {
      logger.warn(`❌ Akses pelihat ditolak - User ${req.user.email} (role: ${req.user.role}, dinas_id: ${req.user.dinas_id})`);
      return res.status(403).json({ success: false, message: 'Access forbidden - Requires viewer dinas account' });
    }

    if (!(await isDinasPelihatAccount(req.user))) {
      logger.warn(`❌ Akses pelihat ditolak - User ${req.user.email} bukan akun dinas pelihat`);
      return res.status(403).json({ success: false, message: 'Access forbidden - Requires viewer dinas account' });
    }

    next();
  } catch (error) {
    logger.error('authorizeDinasPelihat error:', error);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

/**
 * Require Superadmin Role
 * Middleware untuk endpoint yang hanya boleh diakses superadmin
 */
const requireSuperadmin = (req, res, next) => {
  if (req.user.role !== 'superadmin') {
    logger.warn(`❌ Superadmin access denied - User ${req.user.email} (role: ${req.user.role})`);
    return res.status(403).json({
      success: false,
      message: 'Access forbidden - Requires superadmin role'
    });
  }

  logger.info(`✅ Superadmin authorization passed - User ${req.user.email}`);
  next();
};

module.exports = { auth, checkRole, checkAbsensiAdmin, generateToken, authorizeDinas, authorizeDinasPelihat, denyDinasPelihat, requireSuperadmin, invalidateRoleCache };
