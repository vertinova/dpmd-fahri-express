/**
 * Penjaga hak akses fitur untuk akun operasional desa.
 *
 * Aturan:
 * - role `admin_desa` : pengelola akun saja, ditolak di semua fitur operasional
 *   (kecuali route yang lewat opsi `allowAdminDesa`).
 * - role `desa`       : harus punya permission_key yang diminta.
 * - role lain         : diteruskan, kewenangannya diatur `checkRole` masing-masing route.
 */

const prisma = require('../config/prisma');
const logger = require('../utils/logger');

// Cache pendek supaya tidak query per-request, tapi pencabutan izin tetap cepat terasa.
const CACHE_TTL_MS = 30 * 1000;
const permissionCache = new Map(); // userId(string) -> { keys: string[], expiresAt: number }

const getDesaPermissions = async (userId) => {
  const cacheKey = String(userId);
  const cached = permissionCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.keys;
  }

  const rows = await prisma.desa_user_permissions.findMany({
    where: { user_id: BigInt(cacheKey) },
    select: { permission_key: true },
  });

  const keys = rows.map((row) => row.permission_key);
  permissionCache.set(cacheKey, { keys, expiresAt: Date.now() + CACHE_TTL_MS });
  return keys;
};

/** Dipanggil Admin Desa setelah mengubah/menghapus akun agar izin baru langsung berlaku. */
const invalidateDesaPermissions = (userId) => {
  if (userId === undefined || userId === null) return;
  permissionCache.delete(String(userId));
};

const requireDesaPermission = (permissionKey, options = {}) => {
  const { allowAdminDesa = false } = options;

  return async (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ success: false, message: 'Unauthorized - No user found' });
    }

    const role = String(req.user.role || '').trim().toLowerCase();

    if (role === 'admin_desa') {
      if (allowAdminDesa) return next();
      logger.warn(`❌ Admin Desa ${req.user.email} mencoba mengakses fitur operasional "${permissionKey}"`);
      return res.status(403).json({
        success: false,
        code: 'ADMIN_DESA_NO_OPERATIONAL_ACCESS',
        message: 'Admin Desa hanya berwenang mengelola akun, bukan fitur operasional desa',
      });
    }

    if (role !== 'desa') {
      return next();
    }

    try {
      const keys = await getDesaPermissions(req.user.id);
      if (keys.includes(permissionKey)) {
        return next();
      }

      logger.warn(`❌ Akun desa ${req.user.email} tidak punya hak akses "${permissionKey}"`);
      return res.status(403).json({
        success: false,
        code: 'DESA_PERMISSION_DENIED',
        message: 'Akun Anda tidak memiliki hak akses untuk fitur ini. Hubungi Admin Desa.',
        required_permission: permissionKey,
      });
    } catch (error) {
      logger.error(`Gagal memuat hak akses desa untuk user ${req.user.id}:`, error.message);
      return res.status(500).json({ success: false, message: 'Gagal memeriksa hak akses' });
    }
  };
};

module.exports = {
  requireDesaPermission,
  getDesaPermissions,
  invalidateDesaPermissions,
};
