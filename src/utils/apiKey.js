/**
 * Penjaga API key untuk endpoint yang diserahkan ke pihak LUAR aplikasi ini
 * (Core Dashboard publik, API Asta Desa untuk Bupati).
 *
 * Dipisah ke satu berkas karena bagian yang mudah salah bukan pembandingan
 * kuncinya, melainkan tiga hal di sekelilingnya — dan ketiganya pernah terlupa
 * di implementasi API key yang ditulis sendiri:
 *
 *   1. Perbandingan yang tahan analisis waktu. `a === b` berhenti di karakter
 *      pertama yang berbeda, dan selisih waktunya bisa diukur dari jauh untuk
 *      menebak kunci karakter demi karakter.
 *   2. Menolak kunci bawaan yang belum diganti. Tanpa ini, server yang .env-nya
 *      masih berisi "REPLACE_WITH_..." tampak terlindungi padahal kuncinya
 *      tertulis di repositori — dan itu keadaan NYATA di .env.production repo
 *      ini saat berkas ini dibuat.
 *   3. Membalas 503, bukan 401, saat kuncinya belum dipasang di server. 401
 *      membuat pihak penerima mengira kuncinya salah lalu menagih kunci baru,
 *      padahal yang kurang ada di sisi kita.
 */

const crypto = require('crypto');

/** Perbandingan panjang-tetap; false bila salah satu kosong atau panjangnya beda. */
const timingSafeEquals = (actual, expected) => {
  if (!actual || !expected) return false;

  const actualBuffer = Buffer.from(String(actual));
  const expectedBuffer = Buffer.from(String(expected));

  if (actualBuffer.length !== expectedBuffer.length) return false;

  return crypto.timingSafeEqual(actualBuffer, expectedBuffer);
};

/**
 * Kunci yang TIDAK boleh dianggap sah walau terpasang: terlalu pendek, atau
 * masih berisi teks penanda dari berkas contoh.
 */
const isUnsafeConfiguredApiKey = (apiKey) => {
  if (!apiKey || apiKey.length < 32) return true;

  const normalized = apiKey.toLowerCase();
  return (
    normalized.includes('change-this') ||
    normalized.includes('change_to') ||
    normalized.includes('replace-with') ||
    normalized.includes('replace_with') ||
    normalized.includes('your_api') ||
    normalized.includes('password') ||
    normalized.includes('secret')
  );
};

/**
 * Kunci dari permintaan. Tiga tempat diterima karena pihak penerima biasanya
 * sudah punya kebiasaannya sendiri, dan menolak dua di antaranya hanya
 * memindahkan pekerjaan integrasi ke mereka tanpa menambah keamanan apa pun.
 */
const getRequestApiKey = (req) => {
  const authorization = req.get('authorization') || '';
  const bearerMatch = authorization.match(/^Bearer\s+(.+)$/i);

  return (
    req.get('x-api-key') ||
    req.get('x-core-dashboard-key') ||
    (bearerMatch ? bearerMatch[1] : '')
  );
};

/** Permintaan dari bilah alamat peramban, bukan dari program. */
const dariPeramban = (req) => {
  const accept = req.get('accept') || '';
  return req.method === 'GET' && accept.includes('text/html') && !getRequestApiKey(req);
};

/**
 * Middleware penjaga API key.
 *
 * @param env      nama variabel .env yang memuat kuncinya
 * @param realm    nama realm untuk header WWW-Authenticate
 * @param halaman  (opsional) (req,res) => void; dipanggil saat endpoint dibuka
 *                 dari peramban tanpa kunci, untuk menyajikan halaman petunjuk
 *                 alih-alih 401 JSON yang tidak memberi tahu apa pun
 */
const buatPenjagaApiKey = ({ env, realm, halaman = null }) => (req, res, next) => {
  if (halaman && dariPeramban(req)) return halaman(req, res);

  const kunci = process.env[env];

  if (isUnsafeConfiguredApiKey(kunci)) {
    console.error(`[apiKey] ${env} belum disetel dengan nilai yang aman`);
    return res.status(503).json({
      success: false,
      message: `API ini belum dikonfigurasi di server (${env} belum disetel).`,
    });
  }

  if (!timingSafeEquals(getRequestApiKey(req), kunci)) {
    res.set('WWW-Authenticate', `Bearer realm="${realm}"`);
    return res.status(401).json({ success: false, message: 'API key tidak valid' });
  }

  return next();
};

module.exports = {
  timingSafeEquals,
  isUnsafeConfiguredApiKey,
  getRequestApiKey,
  dariPeramban,
  buatPenjagaApiKey,
};
