/**
 * Verifikasi 2 langkah (TOTP, RFC 6238) untuk akun pegawai DPMD.
 *
 * Standar ini yang dipakai Google Authenticator, Microsoft Authenticator, dan
 * aplikasi Passwords bawaan iPhone, jadi satu implementasi melayani Android dan
 * iPhone. Ditulis langsung di atas `crypto` karena intinya hanya HMAC-SHA1 dan
 * base32; tidak perlu menambah dependensi.
 */
const crypto = require('crypto');

const ALFABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const DETIK_PER_LANGKAH = 30;
const PENERBIT = 'DPMD Kab Bogor';

const base32Encode = (buf) => {
  let bits = 0;
  let nilai = 0;
  let hasil = '';
  for (const b of buf) {
    nilai = (nilai << 8) | b;
    bits += 8;
    while (bits >= 5) {
      hasil += ALFABET[(nilai >>> (bits - 5)) & 31];
      bits -= 5;
      nilai &= (1 << bits) - 1;
    }
  }
  if (bits > 0) hasil += ALFABET[(nilai << (5 - bits)) & 31];
  return hasil;
};

const base32Decode = (teks) => {
  let bits = 0;
  let nilai = 0;
  const hasil = [];
  for (const c of String(teks).replace(/[\s=]/g, '').toUpperCase()) {
    const i = ALFABET.indexOf(c);
    if (i < 0) throw new Error('Rahasia base32 tidak sah');
    nilai = (nilai << 5) | i;
    bits += 5;
    if (bits >= 8) {
      hasil.push((nilai >>> (bits - 8)) & 255);
      bits -= 8;
      nilai &= (1 << bits) - 1;
    }
  }
  return Buffer.from(hasil);
};

/** Kode 6 digit untuk satu langkah waktu (HOTP, RFC 4226). */
const kodePadaLangkah = (rahasia, langkah) => {
  const pesan = Buffer.alloc(8);
  pesan.writeBigUInt64BE(BigInt(langkah));
  const h = crypto.createHmac('sha1', rahasia).update(pesan).digest();
  const o = h[h.length - 1] & 0xf;
  return String((h.readUInt32BE(o) & 0x7fffffff) % 1000000).padStart(6, '0');
};

const langkahSekarang = (ms = Date.now()) => Math.floor(ms / 1000 / DETIK_PER_LANGKAH);

/**
 * Cocokkan kode dengan toleransi ±1 langkah (±30 detik) untuk jam HP yang
 * sedikit meleset. Mengembalikan nomor langkah yang cocok, atau null.
 * Pemanggil WAJIB menolak langkah <= langkah terakhir yang sudah dipakai,
 * supaya kode yang sama tidak bisa dipakai dua kali.
 */
const cocokkanKode = (rahasiaBase32, kode, { sekarang = Date.now(), jendela = 1 } = {}) => {
  const bersih = String(kode || '').replace(/\s/g, '');
  if (!/^\d{6}$/.test(bersih)) return null;
  const rahasia = base32Decode(rahasiaBase32);
  const t = langkahSekarang(sekarang);
  const masukan = Buffer.from(bersih);
  let cocok = null;
  // Semua langkah diperiksa (tidak berhenti di yang pertama cocok) supaya
  // lama prosesnya tidak membocorkan langkah mana yang benar.
  for (let d = -jendela; d <= jendela; d++) {
    if (crypto.timingSafeEqual(Buffer.from(kodePadaLangkah(rahasia, t + d)), masukan)) cocok = t + d;
  }
  return cocok;
};

const buatRahasia = () => base32Encode(crypto.randomBytes(20));

/** Tautan yang dibaca QR code dan tombol "buka di aplikasi authenticator". */
const tautanOtpauth = (rahasiaBase32, email) =>
  `otpauth://totp/${encodeURIComponent(PENERBIT)}:${encodeURIComponent(email)}` +
  `?secret=${rahasiaBase32}&issuer=${encodeURIComponent(PENERBIT)}&algorithm=SHA1&digits=6&period=${DETIK_PER_LANGKAH}`;

// --- Penyimpanan rahasia: AES-256-GCM, supaya bocornya dump database saja
// tidak cukup untuk membuat kode. Kunci diturunkan dari TOTP_KUNCI bila ada,
// kalau tidak dari JWT_SECRET.
// shortcut: mengganti JWT_SECRET (tanpa TOTP_KUNCI) membuat semua rahasia tak terbaca
// sehingga 2FA tiap pegawai harus direset; set TOTP_KUNCI tersendiri bila JWT_SECRET akan dirotasi.
const kunciEnkripsi = () => {
  const bahan = process.env.TOTP_KUNCI || process.env.JWT_SECRET;
  if (!bahan) throw new Error('TOTP_KUNCI/JWT_SECRET belum diset');
  return crypto.createHash('sha256').update(`dpmd-totp:${bahan}`).digest();
};

const enkripsiRahasia = (teks) => {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', kunciEnkripsi(), iv);
  const isi = Buffer.concat([c.update(teks, 'utf8'), c.final()]);
  return [iv, c.getAuthTag(), isi].map((b) => b.toString('base64')).join('.');
};

const dekripsiRahasia = (tersimpan) => {
  const [iv, tag, isi] = String(tersimpan).split('.').map((b) => Buffer.from(b, 'base64'));
  const d = crypto.createDecipheriv('aes-256-gcm', kunciEnkripsi(), iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(isi), d.final()]).toString('utf8');
};

module.exports = {
  base32Encode,
  base32Decode,
  kodePadaLangkah,
  langkahSekarang,
  cocokkanKode,
  buatRahasia,
  tautanOtpauth,
  enkripsiRahasia,
  dekripsiRahasia,
};
