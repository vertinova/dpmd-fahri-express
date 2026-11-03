/**
 * Penjaga hak akses Smart CCTV.
 *
 * Superadmin selalu berakses penuh dan satu-satunya yang mengatur akses. Pengguna
 * lain hanya bisa memakai bagian yang izinnya diberikan (tabel cctv_akses):
 *   lihat      — live monitoring & playback rekaman
 *   peringatan — peringatan, riwayat, statistik/analitik, tindak lanjut, notifikasi real-time
 *   kamera     — tambah/ubah/hapus/uji perangkat kamera
 *   wajah      — data wajah terdaftar (biometrik)
 * Izin berbatas waktu (berlaku_sampai) diabaikan setelah lewat.
 */

const prisma = require('../config/prisma');
const logger = require('../utils/logger');

const IZIN_CCTV = ['lihat', 'peringatan', 'kamera', 'wajah'];

// Cache pendek supaya tidak query per-request; pencabutan tetap cepat terasa
// (dan langsung dibuang saat superadmin mengubah akses).
const CACHE_TTL_MS = 30 * 1000;
const cache = new Map(); // userId(string) -> { izin: string[], sampai: number }

const isSuperadmin = (user) => String(user?.role || '').toLowerCase() === 'superadmin';

async function izinCctv(user) {
  if (!user) return [];
  if (isSuperadmin(user)) return [...IZIN_CCTV];
  const kunci = String(user.id);
  const ada = cache.get(kunci);
  if (ada && ada.sampai > Date.now()) return ada.izin;
  const kini = new Date();
  const baris = await prisma.cctv_akses.findMany({
    where: { user_id: BigInt(kunci), OR: [{ berlaku_sampai: null }, { berlaku_sampai: { gt: kini } }] },
    select: { izin: true },
  });
  const izin = baris.map((b) => b.izin).filter((i) => IZIN_CCTV.includes(i));
  cache.set(kunci, { izin, sampai: Date.now() + CACHE_TTL_MS });
  return izin;
}

const lupakanIzinCctv = (userId) => {
  if (userId === undefined || userId === null) return;
  cache.delete(String(userId));
};

/** Middleware: lolos bila punya SALAH SATU izin yang diminta. */
const butuhCctv = (...diminta) => async (req, res, next) => {
  if (!req.user) return res.status(401).json({ success: false, message: 'Unauthorized - No user found' });
  try {
    const izin = await izinCctv(req.user);
    if (diminta.some((i) => izin.includes(i))) {
      req.izinCctv = izin;
      return next();
    }
    logger.warn(`❌ ${req.user.email} ditolak Smart CCTV (butuh: ${diminta.join('/')}, punya: ${izin.join(',') || '-'})`);
    return res.status(403).json({
      success: false,
      code: 'CCTV_NO_ACCESS',
      message: izin.length
        ? 'Anda tidak punya izin untuk bagian Smart CCTV ini. Hubungi superadmin.'
        : 'Anda belum diberi akses Smart CCTV. Hubungi superadmin.',
    });
  } catch (err) {
    logger.error(`Gagal memeriksa akses Smart CCTV: ${err.message}`);
    return res.status(500).json({ success: false, message: 'Gagal memeriksa akses Smart CCTV' });
  }
};

module.exports = { IZIN_CCTV, izinCctv, lupakanIzinCctv, butuhCctv, isSuperadmin };
