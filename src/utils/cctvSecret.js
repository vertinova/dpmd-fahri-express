/**
 * Enkripsi kredensial RTSP Smart CCTV.
 *
 * Password kamera disimpan dalam keadaan terenkripsi AES-256-GCM di kolom
 * cctv_cameras.password_enc — berbeda dengan dashboard lama yang menyimpannya
 * polos. Kunci diturunkan dari JWT_SECRET supaya tidak perlu env baru dan
 * otomatis sama di semua instance yang memakai JWT yang sama.
 *
 * Format: base64(iv):base64(tag):base64(ciphertext)
 */

const crypto = require('crypto');

const ALGO = 'aes-256-gcm';

const getKey = () =>
  crypto.createHash('sha256').update(`${process.env.JWT_SECRET || ''}:smart-cctv`).digest();

/** Enkripsi teks polos. null/undefined diteruskan apa adanya. */
const encrypt = (plain) => {
  if (plain === null || plain === undefined || plain === '') return null;
  try {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv(ALGO, getKey(), iv);
    const ct = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
    return `${iv.toString('base64')}:${cipher.getAuthTag().toString('base64')}:${ct.toString('base64')}`;
  } catch (err) {
    console.error('[CCTVSecret] Gagal mengenkripsi:', err.message);
    return null;
  }
};

/**
 * Dekripsi. Nilai lama yang tersimpan polos (warisan dashboard) atau format
 * yang tidak dikenali dikembalikan mentah supaya tetap terpakai.
 */
const decrypt = (value) => {
  if (value === null || value === undefined || value === '') return null;
  try {
    const parts = String(value).split(':');
    if (parts.length !== 3) return value;
    const [ivB64, tagB64, ctB64] = parts;
    const decipher = crypto.createDecipheriv(ALGO, getKey(), Buffer.from(ivB64, 'base64'));
    decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
    return Buffer.concat([
      decipher.update(Buffer.from(ctB64, 'base64')),
      decipher.final()
    ]).toString('utf8');
  } catch (err) {
    // Bukan ciphertext (kemungkinan besar nilai lama yang polos).
    return String(value);
  }
};

/*
 * Token media: izin menonton satu stream kamera tanpa header Authorization
 * (<img>/<video>/WebSocket tidak bisa mengirimnya). Diterbitkan endpoint
 * stream-url yang mewajibkan login, diperiksa nginx lewat auth_request
 * sebelum permintaan diteruskan ke go2rtc. Bentuk: "<exp detik>.<hmac>".
 */
const UMUR_TOKEN_MEDIA = 12 * 60 * 60;
const kunciMedia = () =>
  crypto.createHash('sha256').update(`${process.env.JWT_SECRET || ''}:smart-cctv-media`).digest();
const tandaMedia = (src, exp) =>
  crypto.createHmac('sha256', kunciMedia()).update(`${src}.${exp}`).digest('base64url');

const tokenMedia = (src) => {
  const exp = Math.floor(Date.now() / 1000) + UMUR_TOKEN_MEDIA;
  return { token: `${exp}.${tandaMedia(src, exp)}`, exp };
};

const tokenMediaSah = (src, token) => {
  const [exp, tanda] = String(token || '').split('.');
  if (!src || !/^\d+$/.test(exp || '') || !tanda) return false;
  if (Number(exp) < Math.floor(Date.now() / 1000)) return false;
  const harap = Buffer.from(tandaMedia(src, exp));
  const dapat = Buffer.from(tanda);
  return harap.length === dapat.length && crypto.timingSafeEqual(harap, dapat);
};

module.exports = { encrypt, decrypt, tokenMedia, tokenMediaSah };
