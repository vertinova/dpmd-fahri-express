/**
 * SIPANDA Service
 * Ambil data penyaluran dana desa (ADD, DD REGULER, BHPRD, BANKEU INFRAS DESA, BP)
 * langsung dari SIPANDA Kab. Bogor. Dipakai oleh core-dashboard API publik agar
 * angka keuangan desa "live" (bukan dari file JSON statis).
 *
 * Baris SIPANDA granular per-desa per-tahap(bulan); konsumen yang meringkas.
 * Response cache di memori (TTL 5 menit) supaya tidak memukul SIPANDA tiap request.
 */

const axios = require('axios');

const SIPANDA_TAHUN = process.env.SIPANDA_TAHUN || '2026';
const SIPANDA_BASE_URL =
  process.env.SIPANDA_BASE_URL || 'https://sipanda-bogorkab.smartvillage.info';
const DEFAULT_TIMEOUT_MS = Number(process.env.SIPANDA_TIMEOUT_MS || 12000);
const TTL_MS = Number(process.env.SIPANDA_TTL_MS || 5 * 60 * 1000);

const buildUrl = (tahun) =>
  `${SIPANDA_BASE_URL}/${tahun}/index.php/api/DashboardController/dashboard`;

// Cache per-tahun
const cache = new Map(); // tahun -> { rows, at }
const inflight = new Map(); // tahun -> Promise<rows>

/**
 * Ambil baris SIPANDA (array). Cache TTL 5 menit per tahun.
 * @param {object} opts
 * @param {string|number} [opts.tahun]      default env SIPANDA_TAHUN
 * @param {number}        [opts.timeoutMs]  override timeout axios (mis. mode preview)
 * @param {boolean}       [opts.force]      abaikan cache
 * @returns {Promise<Array>}
 */
const fetchSipandaRows = async (opts = {}) => {
  const tahun = String(opts.tahun || SIPANDA_TAHUN);
  const timeoutMs = opts.timeoutMs || DEFAULT_TIMEOUT_MS;

  const cached = cache.get(tahun);
  if (!opts.force && cached && Date.now() - cached.at < TTL_MS) {
    return cached.rows;
  }
  if (!opts.force && inflight.has(tahun)) {
    return inflight.get(tahun);
  }

  const promise = axios
    .get(buildUrl(tahun), {
      timeout: timeoutMs,
      headers: { Accept: 'application/json' }
    })
    .then((res) => {
      const json = res.data;
      if (!json || json.status !== true || !Array.isArray(json.data)) {
        throw new Error('Format data SIPANDA tidak valid');
      }
      cache.set(tahun, { rows: json.data, at: Date.now() });
      inflight.delete(tahun);
      return json.data;
    })
    .catch((err) => {
      inflight.delete(tahun);
      throw new Error(`SIPANDA fetch gagal: ${err.message}`);
    });

  inflight.set(tahun, promise);
  return promise;
};

module.exports = {
  fetchSipandaRows,
  SIPANDA_TAHUN,
  SIPANDA_BASE_URL
};
