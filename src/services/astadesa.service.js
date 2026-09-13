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
const requestBertoken = async (jalurPenuh, params = {}, sudahUlang = false) => {
  const token = await ambilToken();
  try {
    const res = await axios.get(`${BASE_URL}${jalurPenuh}`, {
      params,
      timeout: TIMEOUT_MS,
      headers: { Accept: 'application/json', Authorization: `Bearer ${token}` }
    });
    return res.data;
  } catch (err) {
    const status = err.response?.status;

    if (status === 401 && !sudahUlang && !STATIC_TOKEN) {
      tokenCache = null;
      return requestBertoken(jalurPenuh, params, true);
    }
    if (status === 401) {
      throw new AstaDesaError('Token ASTA DESA tidak diterima (401). Kredensial di .env perlu diperbarui.', 502);
    }
    if (status === 403) {
      throw new AstaDesaError('Akun ASTA DESA yang dipakai bukan super_admin, sehingga endpoint admin ditolak.', 502);
    }
    if (status === 404) {
      throw new AstaDesaError(`Endpoint ASTA DESA tidak ditemukan: ${jalurPenuh}`, 404);
    }
    if (err.code === 'ECONNABORTED' || err.code === 'ETIMEDOUT') {
      throw new AstaDesaError('Server ASTA DESA tidak merespons dalam batas waktu.', 504);
    }
    throw new AstaDesaError(`Permintaan ASTA DESA gagal: ${err.message}`, 502, err.response?.data || null);
  }
};

/** Endpoint grup admin — `/api/v1/admin/<path>`. Bentuk pemanggilan lama. */
const requestMentah = (path, params = {}) => requestBertoken(`/admin${path}`, params);

/**
 * Endpoint bertoken DI LUAR grup admin — `/api/v1/<path>`.
 *
 * MENGAPA INI ADA. `/admin/sensuses` memakai AdminSensusResource yang sengaja
 * ringkas: ~12 kolom identitas, dan koordinatnya HANYA `lokasi: {lat, lon}`.
 * Peta Sebaran super admin ASTA DESA menggambar `rumah_lat`/`rumah_lon` —
 * kolom yang tidak pernah ikut di resource itu. Sementara `/sensuses` (endpoint
 * pengguna biasa) membalas model Sensus apa adanya: `$guarded = ['id']`,
 * sehingga SELURUH ~104 kolom ikut, termasuk `rumah_*`, dan NIK/no. KK sudah
 * disamarkan di sana oleh `maskPrivacy`.
 *
 * Akun super_admin tidak ber-role surveyor/verifikator, jadi penyaringan per
 * peran di endpoint itu tidak mengenainya: yang terbaca seluruh kabupaten, sama
 * dengan yang dilihat panel. Itulah satu-satunya jalan mencapai paritas
 * koordinat tanpa meminta perubahan apa pun di sisi ASTA DESA.
 *
 * Harganya: baris di sini jauh lebih berat daripada versi admin. Jangan pakai
 * untuk tabel atau rekap yang sudah cukup dilayani `/admin/sensuses`.
 */
const requestPengguna = (path, params = {}) => requestBertoken(path, params);

/**
 * GET ke endpoint PUBLIK ASTA DESA — tanpa prefiks `/admin` dan tanpa token.
 *
 * Dipakai oleh batas wilayah (`/public/wilayah/*`) dan cuaca BMKG
 * (`/public/weather`), yang dibutuhkan peta sebaran tetapi TIDAK berada di bawah
 * grup admin. Memaksanya lewat `requestMentah` akan menghasilkan 404 karena
 * jalurnya jadi `/admin/public/...`.
 *
 * Token sengaja tidak dikirim. Endpoint wilayah di sana membaca pengguna lewat
 * guard `web` (session), bukan `sanctum`, sehingga token Bearer tidak
 * berpengaruh apa pun — dan tanpa pengguna terbaca, jawabannya justru mencakup
 * SELURUH kecamatan, yang memang yang dibutuhkan DPMD.
 *
 * Tetap diproksikan lewat backend, bukan dipanggil langsung dari browser, agar
 * halaman ini hanya pernah bicara dengan satu origin — tidak ada urusan CORS,
 * dan alamat server ASTA DESA tidak perlu ikut ke bundel frontend.
 */
const requestPublik = async (path, params = {}) => {
  try {
    const res = await axios.get(`${BASE_URL}${path}`, {
      params,
      timeout: TIMEOUT_MS,
      headers: { Accept: 'application/json' }
    });
    return res.data;
  } catch (err) {
    const status = err.response?.status;
    // 404 diteruskan apa adanya: untuk /wilayah/geojson itu jawaban yang sah —
    // "geometri wilayah itu tidak ada" — bukan kerusakan sambungan.
    if (status === 404) {
      throw new AstaDesaError('Geometri wilayah tidak ditemukan di ASTA DESA.', 404);
    }
    if (status === 422) {
      throw new AstaDesaError('Parameter wilayah tidak diterima ASTA DESA.', 422, err.response?.data || null);
    }
    if (err.code === 'ECONNABORTED' || err.code === 'ETIMEDOUT') {
      throw new AstaDesaError('Server ASTA DESA tidak merespons dalam batas waktu.', 504);
    }
    throw new AstaDesaError(`Permintaan publik ASTA DESA gagal: ${err.message}`, 502, err.response?.data || null);
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
 * Versi publik dari `ambil` — jalur tanpa `/admin`, tanpa token.
 *
 * Kuncinya diberi awalan `PUB ` supaya tidak pernah bertabrakan dengan kunci
 * endpoint admin: `/layers` (admin) dan `/public/weather` tidak akan pernah
 * menempati slot yang sama hanya karena jalurnya kebetulan serupa.
 *
 * TTL-nya sengaja bisa dilewati pemanggil. Batas wilayah praktis tidak pernah
 * berubah sehingga boleh disimpan lama; cuaca berubah tiap jam.
 */
const ambilPublik = async (path, params = {}, opts = {}) => {
  const kunci = `PUB ${buatKunci(path, params)}`;
  const ttl = opts.ttlMs ?? TTL_MS;

  const tersimpan = cache.get(kunci);
  if (!opts.force && tersimpan && Date.now() - tersimpan.at < ttl) return tersimpan.value;
  if (!opts.force && inflight.has(kunci)) return inflight.get(kunci);

  const promise = requestPublik(path, params)
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
  // Kunci cache dibedakan per jalur: `/sensuses` versi admin dan versi pengguna
  // punya jalur yang sama tetapi isi baris yang sama sekali berbeda, dan
  // menumpuknya di satu slot akan menyajikan bentuk yang salah ke salah satu
  // pemakainya.
  const kunci = `ALL${opts.pengguna ? ':PENGGUNA' : ''} ${buatKunci(path, params)}`;
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

    const minta = opts.pengguna ? requestPengguna : requestMentah;

    // eslint-disable-next-line no-constant-condition
    while (true) {
      const body = await minta(path, { ...params, page: halaman, per_page: MAX_PER_PAGE });

      // TIGA BENTUK PAGINATOR, semuanya nyata di ASTA DESA:
      //   a. `{data:[…], meta:{last_page}}`   — endpoint admin (/sensuses, /users)
      //   b. `{data:[…], last_page}`          — /messages, paginator rata
      //   c. `{data:{data:[…], last_page}}`   — /v1/sensuses, paginator Laravel
      //                                         utuh yang dibungkus lagi
      // Bentuk (c) adalah yang paling mudah meleset: `body.data` di situ OBJEK,
      // bukan array, sehingga pembacaan gaya (a) menghasilkan nol baris dan
      // penyusuran berhenti di halaman pertama tanpa satu pun galat.
      const amplop = body?.data && !Array.isArray(body.data) ? body.data : body;
      const data = Array.isArray(amplop?.data) ? amplop.data : Array.isArray(body?.data) ? body.data : [];
      baris.push(...data);

      halamanTerakhir = Number(
        amplop?.last_page ?? amplop?.meta?.last_page ?? body?.meta?.last_page ?? body?.last_page ?? halaman
      );
      const total = Number(amplop?.total ?? body?.meta?.total ?? body?.total ?? baris.length);

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
  ambilPublik,
  ambilSemua,
  bersihkanCache,
  terkonfigurasi,
  BASE_URL,
  MAX_PER_PAGE,
  TTL_MS
};
