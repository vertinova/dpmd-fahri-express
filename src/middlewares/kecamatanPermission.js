/**
 * Penjaga hak akses fitur untuk akun OPERATOR kecamatan.
 *
 * Aturan:
 * - role selain `kecamatan`        : diteruskan, kewenangannya diatur rute masing-masing.
 * - akun utama kecamatan           : diteruskan, semua fitur terbuka.
 * - operator kecamatan nonaktif    : ditolak di semua fitur.
 * - operator kecamatan aktif       : harus punya permission_key yang diminta.
 *
 * Kenapa dipasang di TITIK MOUNT (server.js), bukan di dalam tiap router:
 * sebagian besar rute kecamatan (verifikasi Bankeu, Bankeu Perubahan,
 * Kelembagaan) tidak memeriksa role sama sekali — cukup `auth` lalu
 * `req.user.kecamatan_id`. Memasang penjaga di satu tempat lebih sulit
 * terlewat daripada menyisipkannya ke belasan berkas rute.
 *
 * Konsekuensinya, saat penjaga ini berjalan `auth` di dalam router BELUM
 * dijalankan, sehingga token dibaca sendiri di sini. Penjaga ini TIDAK PERNAH
 * menolak karena token tidak ada atau tidak sah — itu tetap tugas `auth`;
 * ia hanya menolak operator kecamatan yang tidak berhak.
 */

const jwt = require('jsonwebtoken');
const prisma = require('../config/prisma');
const logger = require('../utils/logger');

const JWT_SECRET = process.env.JWT_SECRET;

// Cache pendek supaya tidak query per-request, tapi pencabutan izin tetap cepat terasa.
const CACHE_TTL_MS = 30 * 1000;
const aksesCache = new Map(); // userId(string) -> { akses, expiresAt }

/** { operator, aktif, keys } untuk satu akun kecamatan. */
const getKecamatanAkses = async (userId) => {
  const cacheKey = String(userId);
  const cached = aksesCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.akses;

  const user = await prisma.users.findUnique({
    where: { id: BigInt(cacheKey) },
    select: {
      operator_kecamatan: true,
      is_active: true,
      kecamatan_user_permissions: { select: { permission_key: true } },
    },
  });

  const akses = {
    operator: Boolean(user?.operator_kecamatan),
    aktif: user ? user.is_active !== false : false,
    keys: (user?.kecamatan_user_permissions || []).map((p) => p.permission_key),
  };
  aksesCache.set(cacheKey, { akses, expiresAt: Date.now() + CACHE_TTL_MS });
  return akses;
};

/** Dipanggil akun utama setelah mengubah operator agar izin baru langsung berlaku. */
const invalidateKecamatanAkses = (userId) => {
  if (userId === undefined || userId === null) return;
  aksesCache.delete(String(userId));
};

/** Payload token tanpa melempar — null bila tidak ada atau tidak sah. */
const bacaToken = (req) => {
  const token = req.header('Authorization')?.replace('Bearer ', '');
  if (!token || !JWT_SECRET) return null;
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch {
    return null;
  }
};

const tolakOperator = async (res, userId, email, permissionKey) => {
  const akses = await getKecamatanAkses(userId);
  if (!akses.operator) return false;

  if (!akses.aktif) {
    logger.warn(`❌ Operator kecamatan nonaktif ${email} mencoba mengakses "${permissionKey}"`);
    res.status(403).json({
      success: false,
      code: 'OPERATOR_KECAMATAN_NONAKTIF',
      message: 'Akun operator Anda sudah dinonaktifkan. Hubungi akun utama kecamatan.',
    });
    return true;
  }

  if (akses.keys.includes(permissionKey)) return false;

  logger.warn(`❌ Operator kecamatan ${email} tidak punya hak akses "${permissionKey}"`);
  res.status(403).json({
    success: false,
    code: 'KECAMATAN_PERMISSION_DENIED',
    message: 'Akun Anda tidak memiliki hak akses untuk fitur ini. Hubungi akun utama kecamatan.',
    required_permission: permissionKey,
  });
  return true;
};

/** Untuk titik mount di server.js — membaca token sendiri (lihat catatan di atas). */
const gerbangOperatorKecamatan = (permissionKey) => async (req, res, next) => {
  const payload = req.user || bacaToken(req);
  if (!payload || String(payload.role || '').trim().toLowerCase() !== 'kecamatan') return next();

  try {
    if (await tolakOperator(res, payload.id, payload.email, permissionKey)) return undefined;
    return next();
  } catch (error) {
    logger.error(`Gagal memeriksa hak akses operator kecamatan ${payload.id}:`, error.message);
    return res.status(500).json({ success: false, message: 'Gagal memeriksa hak akses' });
  }
};

/** Untuk rute yang hanya boleh dibuka akun UTAMA kecamatan (pasang setelah `auth`). */
const requireKecamatanUtama = async (req, res, next) => {
  try {
    const akses = await getKecamatanAkses(req.user.id);
    if (!akses.operator) return next();
    return res.status(403).json({
      success: false,
      code: 'BUKAN_AKUN_UTAMA_KECAMATAN',
      message: 'Hanya akun utama kecamatan yang dapat mengelola akun operator.',
    });
  } catch (error) {
    logger.error('Gagal memeriksa akun utama kecamatan:', error.message);
    return res.status(500).json({ success: false, message: 'Gagal memeriksa hak akses' });
  }
};

module.exports = {
  gerbangOperatorKecamatan,
  requireKecamatanUtama,
  getKecamatanAkses,
  invalidateKecamatanAkses,
};
