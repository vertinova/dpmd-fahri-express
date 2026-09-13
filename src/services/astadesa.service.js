/**
 * ASTA DESA Service
 *
 * Jembatan ke API super admin ASTA DESA (https://astadesa.rmlabs.id) untuk
 * halaman Core Dashboard "Asta Desa".
 *
 * MENGAPA LEWAT BACKEND, BUKAN LANGSUNG DARI BROWSER. API itu menuntut token
 * Sanctum milik akun ber-role `super_admin`. Token seperti itu tidak boleh
 * pernah sampai ke browser: siapa pun yang membuka DevTools akan memegang akses
 * baca SELURUH data sensus ASTA DESA, jauh melampaui apa yang halaman ini
 * tampilkan. Kredensialnya tinggal di .env server, tokennya tinggal di memori
 * proses ini, dan frontend hanya bicara dengan endpoint kita sendiri yang sudah
 * dilindungi JWT + peran internal DPMD.
 *
 * Pola cache-nya mengikuti sipanda.service.js: cache memori per-kunci dengan
 * TTL, plus penggabungan permintaan bersamaan (inflight) supaya lima pengunjung
 * yang membuka halaman pada detik yang sama tidak menjadi lima panggilan ke
 * server ASTA DESA.
 *
 * Seluruh endpoint di sana read-only; tidak ada operasi tulis di file ini.
 */

const axios = require('axios');

const BASE_URL = (process.env.ASTADESA_BASE_URL || 'https://astadesa.rmlabs.id/api/v1').replace(/\/+$/, '');
const IDENTITY = process.env.ASTADESA_IDENTITY || process.env.ASTADESA_EMAIL || '';
const PASSWORD = process.env.ASTADESA_PASSWORD || '';
// Token boleh dipasang langsung bila di server tidak ingin menyimpan password.
// Kalau ada, login dilewati sama sekali.
const STATIC_TOKEN = process.env.ASTADESA_TOKEN || '';

const TIMEOUT_MS = Number(process.env.ASTADESA_TIMEOUT_MS || 20000);
const TTL_MS = Number(process.env.ASTADESA_TTL_MS || 10 * 60 * 1000);
// Batas per_page di sisi ASTA DESA memang 200; nilai di atas itu diturunkan
// server mereka, jadi tidak ada gunanya meminta lebih.
const MAX_PER_PAGE = 200;
// Pagar pengaman saat menyusuri seluruh halaman. Tabel `sensuses` di sana
// berisi ribuan baris; tanpa batas, satu permintaan bisa menahan proses ini
// selama puluhan detik dan menghabiskan memori.
const MAX_ROWS_DEFAULT = Number(process.env.ASTADESA_MAX_ROWS || 20000);

/** Galat yang membawa status HTTP supaya controller bisa meneruskannya apa adanya. */
class AstaDesaError extends Error {
  constructor(message, status = 502, detail = null) {
    super(message);
    this.name = 'AstaDesaError';
    this.status = status;
    this.detail = detail;
  }
}

const terkonfigurasi = () => Boolean(STATIC_TOKEN || (IDENTITY && PASSWORD));

// ── Token ────────────────────────────────────────────────────────────────────
let tokenCache = STATIC_TOKEN || null;
let loginInflight = null;

const login = async () => {
  if (STATIC_TOKEN) return STATIC_TOKEN;
  if (!IDENTITY || !PASSWORD) {
    throw new AstaDesaError(
      'Integrasi ASTA DESA belum dikonfigurasi. Isi ASTADESA_IDENTITY dan ASTADESA_PASSWORD (atau ASTADESA_TOKEN) di .env server.',
      503
    );
  }
  if (loginInflight) return loginInflight;

  loginInflight = axios
    .post(
      `${BASE_URL}/login`,
      // Field-nya `identity` (bisa email/username), BUKAN `email` seperti tertulis
      // di dokumen API mereka — server membalas 422 "identity field is required"
      // bila dikirim sebagai `email`. Keduanya dikirim agar tetap jalan bila
      // suatu saat mereka menyeragamkannya.
      { identity: IDENTITY, email: IDENTITY, password: PASSWORD },
      { timeout: TIMEOUT_MS, headers: { Accept: 'application/json' } }
    )
    .then((res) => {
      const body = res.data || {};
      const token =
        body.token ||
        body.access_token ||
        body?.data?.token ||
        body?.data?.access_token ||
        body?.data?.plain_text_token;
      if (!token) {
        throw new AstaDesaError('Login ASTA DESA berhasil tetapi token tidak ditemukan pada respons.', 502);
      }
      tokenCache = token;
      loginInflight = null;
      return token;
    })
    .catch((err) => {
      loginInflight = null;
      if (err instanceof AstaDesaError) throw err;
      const status = err.response?.status;
      if (status === 401 || status === 422) {
        throw new AstaDesaError('Kredensial ASTA DESA ditolak. Periksa ASTADESA_IDENTITY dan ASTADESA_PASSWORD.', 502);
      }
      throw new AstaDesaError(`Login ASTA DESA gagal: ${err.message}`, 502);
    });

  return loginInflight;
};

const ambilToken = async () => tokenCache || login();

/**
 * GET ke ASTA DESA dengan token. Sekali 401, token dibuang lalu dicoba ulang —
 * token Sanctum bisa dicabut atau kedaluwarsa kapan saja, dan tanpa percobaan
 * ulang ini halaman akan gagal sampai proses backend di-restart.
 */
const requestMentah = async (path, params = {}, sudahUlang = false) => {
  const token = await ambilToken();
  try {
    const res = await axios.get(`${BASE_URL}/admin${path}`, {
      params,
      timeout: TIMEOUT_MS,
      headers: { Accept: 'application/json', Authorization: `Bearer ${token}` }
    });
    return res.data;
  } catch (err) {
    const status = err.response?.status;

    if (status === 401 && !sudahUlang && !STATIC_TOKEN) {
      tokenCache = null;
      return requestMentah(path, params, true);
    }
    if (status === 401) {
      throw new AstaDesaError('Token ASTA DESA tidak diterima (401). Kredensial di .env perlu diperbarui.', 502);
    }
    if (status === 403) {
      throw new AstaDesaError('Akun ASTA DESA yang dipakai bukan super_admin, sehingga endpoint admin ditolak.', 502);
    }
    if (status === 404) {
      throw new AstaDesaError(`Endpoint ASTA DESA tidak ditemukan: ${path}`, 404);
    }
    if (err.code === 'ECONNABORTED' || err.code === 'ETIMEDOUT') {
      throw new AstaDesaError('Server ASTA DESA tidak merespons dalam batas waktu.', 504);
    }
    throw new AstaDesaError(`Permintaan ASTA DESA gagal: ${err.message}`, 502, err.response?.data || null);
  }
};

// ── Cache respons ────────────────────────────────────────────────────────────
const cache = new Map(); // key -> { value, at }
const inflight = new Map(); // key -> Promise

const buatKunci = (path, params) => {
  const rapi = Object.keys(params || {})
    .filter((k) => params[k] !== undefined && params[k] !== null && params[k] !== '')
    .sort()
    .map((k) => `${k}=${params[k]}`)
    .join('&');
  return rapi ? `${path}?${rapi}` : path;
};

/**
 * Ambil satu endpoint (satu halaman) dengan cache TTL.
 * @param {string} path    mis. '/summary', '/sensuses'
 * @param {object} params  query string
 * @param {object} opts    { ttlMs, force }
 */
const ambil = async (path, params = {}, opts = {}) => {
  const kunci = buatKunci(path, params);
  const ttl = opts.ttlMs ?? TTL_MS;

  const tersimpan = cache.get(kunci);
  if (!opts.force && tersimpan && Date.now() - tersimpan.at < ttl) return tersimpan.value;
  if (!opts.force && inflight.has(kunci)) return inflight.get(kunci);

  const promise = requestMentah(path, params)
    .then((value) => {
      cache.set(kunci, { value, at: Date.now() });
      inflight.delete(kunci);
      return value;
    })
    .catch((err) => {
      inflight.delete(kunci);
      throw err;
    });

  inflight.set(kunci, promise);
  return promise;
};

/**
 * Susuri seluruh halaman satu endpoint berpaginasi dan kembalikan barisnya.
 *
 * Dipakai untuk agregasi (peta sebaran, rekap per kecamatan, demografi) yang
 * mustahil dihitung dari satu halaman 200 baris. Hasilnya di-cache utuh karena
 * mahal: sekali susuri, banyak kartu di halaman memakainya.
 */
const ambilSemua = async (path, params = {}, opts = {}) => {
  const kunci = `ALL ${buatKunci(path, params)}`;
  const ttl = opts.ttlMs ?? TTL_MS;

  const tersimpan = cache.get(kunci);
  if (!opts.force && tersimpan && Date.now() - tersimpan.at < ttl) return tersimpan.value;
  if (!opts.force && inflight.has(kunci)) return inflight.get(kunci);

  const batasBaris = opts.maxRows || MAX_ROWS_DEFAULT;

  const promise = (async () => {
    const baris = [];
    let halaman = 1;
    let halamanTerakhir = 1;
    let terpotong = false;

    // eslint-disable-next-line no-constant-condition
    while (true) {
      const body = await requestMentah(path, { ...params, page: halaman, per_page: MAX_PER_PAGE });
      const data = Array.isArray(body?.data) ? body.data : [];
      baris.push(...data);

      // Sebagian endpoint ASTA DESA membalas paginator bersarang (`meta.*`) dan
      // sebagian lagi rata (`last_page` di akar) — /messages contohnya. Keduanya
      // dibaca di sini; kalau hanya `meta` yang dibaca, penyusuran endpoint
      // bergaya rata berhenti di halaman 1 dan diam-diam melaporkan seluruh
      // datanya hanya sebanyak satu halaman.
      halamanTerakhir = Number(body?.meta?.last_page ?? body?.last_page ?? halaman);
      const total = Number(body?.meta?.total ?? body?.total ?? baris.length);

      if (baris.length >= batasBaris && halaman < halamanTerakhir) {
        terpotong = true;
        break;
      }
      if (halaman >= halamanTerakhir || data.length === 0) {
        // `total` dipakai apa adanya dari meta agar konsumen tahu ada berapa
        // baris sebenarnya, bukan hanya berapa yang berhasil terbaca.
        if (baris.length < total) terpotong = true;
        break;
      }
      halaman += 1;
    }

    const hasil = { rows: baris, truncated: terpotong, pages: halaman, last_page: halamanTerakhir };
    cache.set(kunci, { value: hasil, at: Date.now() });
    inflight.delete(kunci);
    return hasil;
  })().catch((err) => {
    inflight.delete(kunci);
    throw err;
  });

  inflight.set(kunci, promise);
  return promise;
};

/** Buang seluruh cache respons (dipakai tombol "muat ulang" di halaman). */
const bersihkanCache = () => {
  cache.clear();
};

module.exports = {
  AstaDesaError,
  ambil,
  ambilSemua,
  bersihkanCache,
  terkonfigurasi,
  BASE_URL,
  MAX_PER_PAGE,
  TTL_MS
};
