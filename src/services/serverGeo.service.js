/**
 * Geolokasi IP untuk Manajemen Server: peta ancaman (globe) dan blokir negara.
 *
 * Sumber data: ip-api.com endpoint batch (gratis, tanpa kunci, maks 100 IP per
 * permintaan dan 15 permintaan per menit). Hasil disimpan di memori dan di
 * tabel server_ip_geo selama 30 hari, jadi satu IP hanya ditanyakan sekali
 * sebulan. Bila layanan tidak terjangkau, semua fungsi tetap berjalan — titik
 * di peta saja yang kosong.
 *
 * Yang dikirim ke ip-api hanya IP publik (bukan IP internal) dan hanya bila
 * `security.geo_lookup` aktif.
 */

const axios = require('axios');
const logger = require('../utils/logger');
const store = require('./serverStore.service');

const TTL_MS = 30 * 24 * 3600 * 1000;
const MAX_CACHE = 20000;
const BATCH = 100;
const JEDA_BATCH_MS = 4500; // ±13 permintaan/menit, di bawah batas 15
const FIELDS = 'status,message,query,country,countryCode,regionName,city,lat,lon,isp,org,as,proxy,hosting';

const cache = new Map(); // ip → { cc, country, region, city, lat, lon, isp, org, asn, proxy, hosting, t }
const antrean = new Set();
let sibuk = false;
let jedaSampai = 0;
let tabelSiap = null;
let terakhirGagal = null;

const privat = (ip) => {
  if (!ip) return true;
  if (ip === '::1' || ip.startsWith('127.') || ip === 'unknown') return true;
  if (/^10\./.test(ip) || /^192\.168\./.test(ip) || /^172\.(1[6-9]|2\d|3[01])\./.test(ip)) return true;
  if (/^169\.254\./.test(ip) || /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(ip)) return true;
  if (/^f[cd][0-9a-f]{2}:/i.test(ip) || /^fe80:/i.test(ip)) return true;
  return false;
};

const aktif = () => store.getConfigSync().security?.geo_lookup !== false;

const siapkanTabel = () => {
  if (!tabelSiap) {
    tabelSiap = store.execute(`
      CREATE TABLE IF NOT EXISTS server_ip_geo (
        ip_address VARCHAR(45) NOT NULL,
        country_code CHAR(2) NULL,
        country VARCHAR(80) NULL,
        region VARCHAR(120) NULL,
        city VARCHAR(120) NULL,
        lat DECIMAL(8,4) NULL,
        lon DECIMAL(8,4) NULL,
        isp VARCHAR(200) NULL,
        org VARCHAR(200) NULL,
        asn VARCHAR(200) NULL,
        proxy TINYINT(1) NOT NULL DEFAULT 0,
        hosting TINYINT(1) NOT NULL DEFAULT 0,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (ip_address),
        KEY idx_sig_cc (country_code)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`)
      .catch((error) => {
        tabelSiap = null;
        throw error;
      });
  }
  return tabelSiap;
};

const dariBaris = (b) => ({
  cc: b.country_code || null,
  country: b.country || null,
  region: b.region || null,
  city: b.city || null,
  lat: b.lat === null ? null : Number(b.lat),
  lon: b.lon === null ? null : Number(b.lon),
  isp: b.isp || null,
  org: b.org || null,
  asn: b.asn || null,
  proxy: !!b.proxy,
  hosting: !!b.hosting,
  t: new Date(b.updated_at).getTime() || Date.now(),
});

const simpanCache = (ip, data) => {
  cache.delete(ip);
  cache.set(ip, data);
  if (cache.size > MAX_CACHE) cache.delete(cache.keys().next().value);
};

const segar = (d) => d && Date.now() - d.t < TTL_MS;

/** Muat dari tabel untuk IP yang belum ada di memori. */
const muatDariDb = async (ips) => {
  const kurang = ips.filter((ip) => !segar(cache.get(ip)));
  if (!kurang.length) return;
  try {
    await siapkanTabel();
    for (let i = 0; i < kurang.length; i += 500) {
      const potong = kurang.slice(i, i + 500);
      const baris = await store.query(
        `SELECT * FROM server_ip_geo WHERE ip_address IN (${potong.map(() => '?').join(',')})`,
        ...potong,
      );
      for (const b of baris) {
        const d = dariBaris(b);
        if (segar(d)) simpanCache(b.ip_address, d);
      }
    }
  } catch (error) {
    logger.warn(`[ServerGeo] Gagal membaca cache geo: ${error.message}`);
  }
};

const tanyaIpApi = async (ips) => {
  const res = await axios.post(`http://ip-api.com/batch?fields=${FIELDS}`, ips.map((query) => ({ query })), {
    timeout: 8000,
    validateStatus: () => true,
  });
  if (res.status === 429) {
    jedaSampai = Date.now() + 60000;
    throw new Error('Batas permintaan ip-api tercapai, dicoba lagi dalam 1 menit');
  }
  if (res.status !== 200 || !Array.isArray(res.data)) throw new Error(`ip-api merespons ${res.status}`);
  // Header X-Rl = sisa jatah, X-Ttl = detik sampai jatah dipulihkan.
  if (Number(res.headers['x-rl']) === 0) jedaSampai = Date.now() + (Number(res.headers['x-ttl']) || 60) * 1000;
  return res.data;
};

const prosesAntrean = async () => {
  if (sibuk || !antrean.size) return;
  if (Date.now() < jedaSampai) {
    setTimeout(prosesAntrean, jedaSampai - Date.now() + 100).unref();
    return;
  }
  sibuk = true;
  const ips = [...antrean].slice(0, BATCH);
  ips.forEach((ip) => antrean.delete(ip));
  try {
    const hasil = await tanyaIpApi(ips);
    const baris = [];
    for (const r of hasil) {
      if (!r?.query) continue;
      const d = r.status === 'success'
        ? {
          cc: r.countryCode || null, country: r.country || null, region: r.regionName || null, city: r.city || null,
          lat: Number.isFinite(r.lat) ? r.lat : null, lon: Number.isFinite(r.lon) ? r.lon : null,
          isp: r.isp || null, org: r.org || null, asn: r.as || null, proxy: !!r.proxy, hosting: !!r.hosting, t: Date.now(),
        }
        // IP reserved/tidak dikenal tetap disimpan supaya tidak ditanyakan terus.
        : { cc: null, country: null, region: null, city: null, lat: null, lon: null, isp: null, org: null, asn: null, proxy: false, hosting: false, t: Date.now() };
      simpanCache(r.query, d);
      baris.push([r.query, d.cc, d.country, d.region, d.city, d.lat, d.lon, d.isp, d.org, d.asn, d.proxy ? 1 : 0, d.hosting ? 1 : 0]);
    }
    terakhirGagal = null;
    if (baris.length) {
      await siapkanTabel();
      await store.execute(
        `INSERT INTO server_ip_geo (ip_address, country_code, country, region, city, lat, lon, isp, org, asn, proxy, hosting)
         VALUES ${baris.map(() => '(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').join(', ')}
         ON DUPLICATE KEY UPDATE country_code = VALUES(country_code), country = VALUES(country), region = VALUES(region),
           city = VALUES(city), lat = VALUES(lat), lon = VALUES(lon), isp = VALUES(isp), org = VALUES(org), asn = VALUES(asn),
           proxy = VALUES(proxy), hosting = VALUES(hosting), updated_at = NOW()`,
        ...baris.flat(),
      ).catch((e) => logger.warn(`[ServerGeo] Gagal menyimpan cache geo: ${e.message}`));
    }
  } catch (error) {
    terakhirGagal = { at: new Date(), message: error.message };
    logger.warn(`[ServerGeo] Lookup gagal: ${error.message}`);
    // Kembalikan ke antrean, coba lagi nanti.
    ips.forEach((ip) => antrean.add(ip));
    if (Date.now() >= jedaSampai) jedaSampai = Date.now() + 30000;
  } finally {
    sibuk = false;
    if (antrean.size) setTimeout(prosesAntrean, Math.max(JEDA_BATCH_MS, jedaSampai - Date.now())).unref();
  }
};

/** Masukkan IP ke antrean lookup (tanpa menunggu hasil). */
const antre = (ip) => {
  if (!ip || privat(ip) || !aktif() || segar(cache.get(ip)) || antrean.has(ip)) return;
  if (antrean.size >= 5000) return;
  antrean.add(ip);
  if (!sibuk) setTimeout(prosesAntrean, 50).unref();
};

/** Data geo dari memori saja — untuk middleware yang tidak boleh menunggu. */
const dariCache = (ip) => {
  const d = cache.get(ip);
  return segar(d) ? d : null;
};

/**
 * Ambil geo untuk banyak IP. Yang belum diketahui dimasukkan antrean dan
 * dikembalikan null; panggilan berikutnya akan berisi.
 * `tunggu` = tunggu satu putaran lookup (dipakai perintah whois satu IP).
 */
const resolveMany = async (ips, { tunggu = false } = {}) => {
  const unik = [...new Set(ips.filter((ip) => ip && !privat(ip)))];
  await muatDariDb(unik);
  const belum = unik.filter((ip) => !dariCache(ip));
  if (belum.length && aktif()) {
    if (tunggu && belum.length <= BATCH && Date.now() >= jedaSampai && !sibuk) {
      belum.forEach((ip) => antrean.add(ip));
      await prosesAntrean();
    } else {
      belum.forEach(antre);
    }
  }
  const hasil = {};
  for (const ip of unik) hasil[ip] = dariCache(ip);
  return hasil;
};

const status = () => ({
  enabled: aktif(),
  cached: cache.size,
  queued: antrean.size,
  paused_until: jedaSampai > Date.now() ? new Date(jedaSampai) : null,
  last_error: terakhirGagal,
});

module.exports = { resolveMany, antre, dariCache, privat, status };
