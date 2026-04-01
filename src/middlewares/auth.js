const jwt = require('jsonwebtoken');
const logger = require('../utils/logger');

const JWT_SECRET = process.env.JWT_SECRET;
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';

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
    
    logger.info(`✅ Auth successful: User ${req.user.id} (${req.user.role}) - Bidang: ${req.user.bidang_id} - Kecamatan: ${req.user.kecamatan_id}`);
    
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

    logger.info(`🔐 Role check - User: ${req.user.email} | User role: "${userRole}" | Allowed roles: [${allowedRoles.join(', ')}]`);

    if (!allowedRoles.includes(userRole)) {
      logger.warn(`❌ Access forbidden - User ${req.user.email} with role "${userRole}" not in [${allowedRoles.join(', ')}]`);
      return res.status(403).json({
        success: false,
        message: `Access forbidden - Role "${req.user.role}" not authorized`,
        debug: {
          userRole: req.user.role,
          allowedRoles: roles
        }
      });
    }

    logger.info(`✅ Role check passed - User ${req.user.email} (${userRole}) authorized`);
    next();
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
const authorizeDinas = (req, res, next) => {
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

  logger.info(`✅ Dinas authorization passed - User ${req.user.email} (dinas_id: ${req.user.dinas_id}, role: ${req.user.role})`);
  next();
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

module.exports = { auth, checkRole, checkAbsensiAdmin, generateToken, authorizeDinas, requireSuperadmin };
