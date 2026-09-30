/**
 * Penjaga server untuk fitur Manajemen Server. Tiga middleware, dipasang di
 * server.js pada urutan berbeda:
 *
 *   gerbang      → paling awal: tolak IP yang diblokir, lalu pasang pencatat
 *                  trafik & respons (termasuk 429 dari rate limiter).
 *   pemeriksa    → setelah body parser: deteksi pola serangan (WAF ringan).
 *   kuotaUnggah  → di /api: tolak unggahan bila kuota storage penuh.
 *
 * Semuanya fail-open: kesalahan di sini tidak boleh menjatuhkan aplikasi.
 */

const jwt = require('jsonwebtoken');
const logger = require('../utils/logger');
const metrics = require('../services/serverMetrics.service');
const security = require('../services/serverSecurity.service');
const storage = require('../services/serverStorage.service');
const store = require('../services/serverStore.service');
const { EVENT_TYPES } = require('../config/serverManagement');

const terakhirCatatBlokir = new Map();

const tokenSah = (req) => {
  const h = req.headers.authorization;
  if (!h || !h.startsWith('Bearer ')) return false;
  try { jwt.verify(h.slice(7), process.env.JWT_SECRET); return true; } catch { return false; }
};

const gerbang = (req, res, next) => {
  try {
    const ip = security.bersihkanIp(req.ip);
    const b = security.isBlocked(ip);
    if (b && !security.diWhitelist(ip)) {
      const kini = Date.now();
      // Catat paling sering sekali per menit per IP — IP yang diblokir biasanya
      // justru sedang membanjiri server.
      if (kini - (terakhirCatatBlokir.get(ip) || 0) > 60000) {
        terakhirCatatBlokir.set(ip, kini);
        security.recordEvent({ ip, type: 'blocked_request', method: req.method, path: req.originalUrl, userAgent: req.headers['user-agent'], blocked: true });
      }
      security.catatHitBlokir(ip);
      return res.status(403).json({
        success: false,
        code: 'IP_DIBLOKIR',
        message: 'Akses dari alamat IP Anda diblokir sementara karena aktivitas mencurigakan. Hubungi admin DPMD bila ini keliru.',
      });
    }

    const mulai = process.hrtime.bigint();
    res.on('finish', () => {
      try {
        const ms = Number(process.hrtime.bigint() - mulai) / 1e6;
        const status = res.statusCode;
        metrics.recordRequest({
          method: req.method,
          url: req.originalUrl,
          status,
          ms,
          bytes: Number(res.getHeader('content-length')) || 0,
          ip,
        });
        security.onResponse({ ip, status, method: req.method, path: req.originalUrl, userAgent: req.headers['user-agent'] });
      } catch { /* pencatatan tidak boleh mengganggu */ }
    });
  } catch (error) {
    logger.warn(`[ServerGuard] gerbang: ${error.message}`);
  }
  return next();
};

const pemeriksa = (req, res, next) => {
  try {
    const cfg = store.getConfigSync().security;
    if (!cfg.detection) return next();
    const ip = security.bersihkanIp(req.ip);
    if (security.diWhitelist(ip)) return next();

    const terautentikasi = tokenSah(req);
    const temuan = security.inspect({
      url: req.originalUrl,
      userAgent: req.headers['user-agent'],
      body: req.body,
      terautentikasi,
    });
    if (!temuan.length) return next();

    // Mode WAF: request anonim dengan pola serangan serius langsung ditolak.
    // Pengguna yang login hanya dicatat — salah tangkap pada pegawai lebih
    // mahal daripada satu request penyerang yang sudah punya akun.
    const serius = temuan.some((t) => ['critical', 'high'].includes(EVENT_TYPES[t.type]?.severity));
    const tolak = cfg.waf_mode !== false && serius && !terautentikasi;

    for (const t of temuan) {
      security.recordEvent({
        ip,
        type: t.type,
        method: req.method,
        path: req.originalUrl,
        userAgent: req.headers['user-agent'],
        detail: `${t.detail}${terautentikasi ? ' (pengguna login)' : ''}`,
        blocked: tolak,
      });
    }

    if (tolak) {
      return res.status(403).json({ success: false, code: 'DITOLAK_WAF', message: 'Permintaan ditolak karena terdeteksi pola berbahaya.' });
    }
  } catch (error) {
    logger.warn(`[ServerGuard] pemeriksa: ${error.message}`);
  }
  return next();
};

const kuotaUnggah = (req, res, next) => {
  try {
    if (!['POST', 'PUT', 'PATCH'].includes(req.method)) return next();
    const jenis = String(req.headers['content-type'] || '');
    if (!jenis.startsWith('multipart/form-data')) return next();
    const ukuran = Number(req.headers['content-length']) || 0;
    const tolak = storage.cekUnggahan(ukuran);
    if (tolak) {
      security.recordEvent({
        ip: req.ip, type: 'upload_rejected', method: req.method, path: req.originalUrl,
        userAgent: req.headers['user-agent'], detail: `${tolak.message} (${Math.round(ukuran / 1048576)} MB)`,
      });
      return res.status(tolak.status).json({ success: false, code: 'KUOTA_STORAGE', message: tolak.message });
    }
  } catch (error) {
    logger.warn(`[ServerGuard] kuota: ${error.message}`);
  }
  return next();
};

module.exports = { gerbang, pemeriksa, kuotaUnggah };
