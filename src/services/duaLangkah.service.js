/**
 * Verifikasi 2 langkah (2FA) untuk akun pegawai DPMD.
 *
 * Alur login pegawai:
 *   1. POST /auth/login (email + sandi benar) -> 403 PERLU_KODE_2FA / PERLU_PASANG_2FA
 *      berisi `tiket_2fa`: bukti sandi sudah benar, berumur 10 menit.
 *   2a. Belum pasang: /auth/2fa/pasang (QR) lalu /auth/2fa/aktifkan (kode pertama).
 *   2b. Sudah pasang: /auth/2fa/verifikasi (kode 6 digit).
 *   3. Barulah token sesi terbit, bertanda `mfa: true`. Middleware `auth`
 *      menolak token pegawai tanpa tanda itu, jadi sesi lama ikut terputus.
 */
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const QRCode = require('qrcode');
const prisma = require('../config/prisma');
const totp = require('../utils/totp');
const { PERAN_INTERNAL_DPMD } = require('../config/peranDpmd');

const UMUR_TIKET = '10m';
const MAKS_PERCOBAAN = 5;

/** Peran yang wajib 2FA. WAJIB_2FA=off di .env mematikannya (jalur darurat). */
const wajib2fa = (role) =>
  process.env.WAJIB_2FA !== 'off' &&
  PERAN_INTERNAL_DPMD.includes(String(role || '').trim().toLowerCase());

// Tiket ditandatangani kunci TURUNAN, bukan JWT_SECRET apa adanya: kalau sama,
// middleware `auth` dan /auth/renew akan menerima tiket ini sebagai token sesi.
const kunciTiket = () => `${process.env.JWT_SECRET}:tiket-2fa`;

const buatTiket = (userId) =>
  jwt.sign({ id: String(userId), jti: crypto.randomUUID() }, kunciTiket(), { expiresIn: UMUR_TIKET });

// shortcut: penghitung percobaan disimpan di memori proses; benar selama backend
// berjalan satu proses pm2 (mode fork). Pindahkan ke DB/Redis bila memakai cluster.
const percobaan = new Map(); // jti -> { n, sampai }

const bersihkanPercobaan = () => {
  const kini = Date.now();
  for (const [k, v] of percobaan) if (v.sampai < kini) percobaan.delete(k);
};

/** Tiket sah dan masih punya jatah percobaan? Mengembalikan isi tiket atau null. */
const bacaTiket = (tiket) => {
  let isi;
  try {
    isi = jwt.verify(String(tiket || ''), kunciTiket());
  } catch {
    return null;
  }
  if (!isi.jti || (percobaan.get(isi.jti)?.n || 0) >= MAKS_PERCOBAAN) return null;
  return isi;
};

/**
 * Potong satu jatah percobaan; mengembalikan sisa. Panggil SEBELUM kode
 * diperiksa, tanpa await di antara ini dan bacaTiket.
 */
const catatGagal = (isi) => {
  bersihkanPercobaan();
  const e = percobaan.get(isi.jti) || { n: 0, sampai: isi.exp * 1000 };
  e.n += 1;
  percobaan.set(isi.jti, e);
  return Math.max(0, MAKS_PERCOBAAN - e.n);
};

/** Tiket yang sudah menghasilkan sesi tidak boleh dipakai lagi. */
const habiskanTiket = (isi) => {
  bersihkanPercobaan();
  percobaan.set(isi.jti, { n: MAKS_PERCOBAAN, sampai: isi.exp * 1000 });
};

const idUser = (userId) => BigInt(String(userId));

const sudahAktif = async (userId) => {
  const baris = await prisma.user_totp.findUnique({
    where: { user_id: idUser(userId) },
    select: { aktif_at: true },
  });
  return Boolean(baris?.aktif_at);
};

/**
 * Siapkan rahasia baru (belum aktif) dan QR-nya. Rahasia yang belum dikonfirmasi
 * dipakai ulang, supaya QR yang sudah terpindai tetap berlaku bila halaman
 * dimuat ulang. Mengembalikan null bila 2FA akun ini sudah aktif.
 */
const mulaiPemasangan = async (userId, email) => {
  const where = { user_id: idUser(userId) };
  const baris = await prisma.user_totp.findUnique({ where });
  if (baris?.aktif_at) return null;

  let rahasia = null;
  if (baris) {
    try {
      rahasia = totp.dekripsiRahasia(baris.rahasia);
    } catch {
      rahasia = null; // kunci berganti: buat baru
    }
  }
  if (!rahasia) {
    rahasia = totp.buatRahasia();
    const data = { rahasia: totp.enkripsiRahasia(rahasia), langkah_terakhir: BigInt(0) };
    await prisma.user_totp.upsert({ where, create: { ...where, ...data }, update: data });
  }

  const otpauthUrl = totp.tautanOtpauth(rahasia, email);
  return { rahasia, otpauth_url: otpauthUrl, qr: await QRCode.toDataURL(otpauthUrl, { margin: 1, width: 240 }) };
};

/**
 * Konfirmasi pemasangan dengan kode pertama dari aplikasi. true bila berhasil.
 * Tidak ada kode cadangan: HP hilang/ganti dipulihkan lewat Reset 2FA oleh superadmin.
 */
const aktifkan = async (userId, kode) => {
  const where = { user_id: idUser(userId) };
  const baris = await prisma.user_totp.findUnique({ where });
  if (!baris || baris.aktif_at) return false;

  const langkah = totp.cocokkanKode(totp.dekripsiRahasia(baris.rahasia), kode);
  if (langkah === null) return false;

  // Bersyarat `aktif_at: null`: dua permintaan aktifkan yang bersamaan hanya satu yang menang.
  const { count } = await prisma.user_totp.updateMany({
    where: { ...where, aktif_at: null },
    data: { aktif_at: new Date(), langkah_terakhir: BigInt(langkah) },
  });
  return count === 1;
};

/**
 * Periksa kode 6 digit untuk akun yang 2FA-nya aktif. Setiap kode hanya berlaku
 * sekali lewat `langkah_terakhir`; pembaruannya bersyarat sehingga dua permintaan
 * bersamaan dengan kode yang sama tidak bisa sama-sama lolos.
 */
const verifikasi = async (userId, kode) => {
  const where = { user_id: idUser(userId) };
  const baris = await prisma.user_totp.findUnique({ where });
  if (!baris?.aktif_at) return false;

  const langkah = totp.cocokkanKode(totp.dekripsiRahasia(baris.rahasia), kode);
  if (langkah === null) return false;
  const { count } = await prisma.user_totp.updateMany({
    where: { ...where, langkah_terakhir: { lt: BigInt(langkah) } },
    data: { langkah_terakhir: BigInt(langkah) },
  });
  return count === 1;
};

/** Hapus 2FA akun (HP hilang/ganti). Pegawai memasang ulang saat login berikutnya. */
const reset = async (userId) => {
  const { count } = await prisma.user_totp.deleteMany({ where: { user_id: idUser(userId) } });
  return count > 0;
};

module.exports = {
  MAKS_PERCOBAAN,
  wajib2fa,
  buatTiket,
  bacaTiket,
  catatGagal,
  habiskanTiket,
  sudahAktif,
  mulaiPemasangan,
  aktifkan,
  verifikasi,
  reset,
};
