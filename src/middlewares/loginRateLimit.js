const rateLimit = require('express-rate-limit');
const logger = require('../utils/logger');

/**
 * Login Rate Limiter
 * - Max 5 login attempts per IP per 5-minute window
 * - Returns remaining attempts and retry-after info
 */
const loginRateLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 menit
  max: 5, // Maksimal 5 percobaan login
  standardHeaders: true, // Return rate limit info in `RateLimit-*` headers
  legacyHeaders: false,
  skipSuccessfulRequests: true, // Jangan hitung request yang berhasil (status 2xx)
  // Di mesin pengembang pembatas ini hanya menghalangi: salah ketik sandi
  // atau skrip uji (scripts/uji-perangkat-desa.js) yang login berulang
  // mengunci diri sendiri 5 menit. Sengaja sakelar eksplisit, BUKAN
  // NODE_ENV: berkas .env di server produksi bertuliskan development
  // (pm2 yang menimpanya jadi production) — terlalu rapuh untuk gerbang login.
  skip: () => process.env.LOGIN_RATE_LIMIT === 'off',
  keyGenerator: (req) => {
    // Gunakan IP address sebagai key
    return req.ip || req.connection.remoteAddress || 'unknown';
  },
  handler: (req, res, next, options) => {
    const retryAfterSeconds = Math.ceil(options.windowMs / 1000);
    const resetTime = req.rateLimit?.resetTime || new Date(Date.now() + options.windowMs);
    const retryAfterMs = resetTime.getTime() - Date.now();
    const retryAfterMinutes = Math.ceil(retryAfterMs / 60000);

    logger.warn(`🚫 Login rate limit exceeded for IP: ${req.ip} - Email: ${req.body?.email || 'unknown'}`);

    res.status(429).json({
      success: false,
      message: `Terlalu banyak percobaan login. Silakan coba lagi dalam ${retryAfterMinutes} menit.`,
      rate_limit: {
        max_attempts: options.max,
        window_minutes: options.windowMs / 60000,
        retry_after_seconds: Math.ceil(retryAfterMs / 1000),
        retry_after_ms: retryAfterMs,
        reset_time: resetTime.toISOString()
      }
    });
  }
});

module.exports = loginRateLimiter;
