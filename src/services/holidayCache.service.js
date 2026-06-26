/**
 * Cache hari libur nasional / cuti bersama untuk fitur absensi.
 *
 * Sumber kebenaran tunggal: tabel `hari_libur` (dikelola lewat menu Hari Libur /
 * tombol Sync kalender) — sama dengan yang dipakai modul Bankeu, sehingga tidak
 * ada lagi dua daftar libur yang bisa berbeda.
 *
 * Data di-cache di memori agar checkHoliday() tetap SINKRON dan tidak menembak DB
 * tiap request absensi. Cache:
 *   - dimuat saat modul pertama kali di-require (warm start),
 *   - di-refresh otomatis bila sudah lewat TTL (refresh latar, non-blocking),
 *   - bisa di-invalidate langsung lewat clearHolidayCache() saat admin mengubah data.
 *
 * Bila tabel belum terisi (cold start / DB kosong), dipakai FALLBACK statis
 * SKB 3 Menteri 2026 supaya tidak ada regresi (tanggal merah tetap terdeteksi).
 *
 * Catatan: weekend (Sabtu/Minggu) TIDAK disimpan di sini — itu logika, bukan data,
 * dan tetap dihitung di checkHoliday().
 */

const { sequelize } = require('../models');
const logger = require('../utils/logger');

// Fallback statis bila tabel hari_libur kosong/belum ter-load (format: MM-DD).
// Sumber: SKB 3 Menteri (Menag, Menaker, Menpan-RB), 19 September 2025.
// 17 hari libur nasional + 8 hari cuti bersama.
const FALLBACK_2026 = {
  // --- Hari Libur Nasional ---
  '01-01': 'Tahun Baru Masehi 2026',
  '01-16': 'Isra Mi\'raj Nabi Muhammad SAW',
  '02-17': 'Tahun Baru Imlek 2577 Kongzili',
  '03-19': 'Hari Suci Nyepi Tahun Baru Saka 1948',
  '03-21': 'Hari Raya Idul Fitri 1447 H', // Sabtu
  '03-22': 'Hari Raya Idul Fitri 1447 H', // Minggu
  '04-03': 'Wafat Isa Al Masih',
  '04-05': 'Hari Paskah / Kebangkitan Isa Al Masih', // Minggu
  '05-01': 'Hari Buruh Internasional',
  '05-14': 'Kenaikan Isa Al Masih',
  '05-27': 'Hari Raya Idul Adha 1447 H',
  '05-31': 'Hari Raya Waisak 2570 BE', // Minggu
  '06-01': 'Hari Lahir Pancasila',
  '06-16': 'Tahun Baru Islam 1448 H (1 Muharam)',
  '08-17': 'Proklamasi Kemerdekaan RI',
  '08-25': 'Maulid Nabi Muhammad SAW',
  '12-25': 'Hari Raya Natal',
  // --- Cuti Bersama ---
  '02-16': 'Cuti Bersama Tahun Baru Imlek',
  '03-18': 'Cuti Bersama Hari Suci Nyepi',
  '03-20': 'Cuti Bersama Idul Fitri 1447 H',
  '03-23': 'Cuti Bersama Idul Fitri 1447 H',
  '03-24': 'Cuti Bersama Idul Fitri 1447 H',
  '05-15': 'Cuti Bersama Kenaikan Isa Al Masih',
  '05-28': 'Cuti Bersama Idul Adha 1447 H',
  '12-24': 'Cuti Bersama Hari Raya Natal',
};

const TTL_MS = 6 * 60 * 60 * 1000; // 6 jam

let _byDate = new Map(); // 'YYYY-MM-DD' -> keterangan
let _loadedAt = 0;
let _loading = null; // Promise saat sedang load, untuk hindari load ganda

async function load() {
  try {
    const rows = await sequelize.query(
      `SELECT DATE_FORMAT(tanggal, '%Y-%m-%d') AS tanggal, keterangan
         FROM hari_libur WHERE is_active = 1`,
      { type: sequelize.QueryTypes.SELECT }
    );
    const map = new Map();
    for (const r of rows) map.set(r.tanggal, r.keterangan);
    _byDate = map;
    _loadedAt = Date.now();
  } catch (e) {
    // Pertahankan cache lama; bila belum pernah ter-load, getHolidayReason() pakai fallback.
    logger.error('Gagal memuat cache hari libur dari DB:', e);
  } finally {
    _loading = null;
  }
}

function refreshIfStale() {
  if (_loading) return;
  if (Date.now() - _loadedAt > TTL_MS) {
    _loading = load(); // fire-and-forget; request berjalan pakai cache saat ini
  }
}

/**
 * Sinkron: kembalikan keterangan libur untuk sebuah tanggal, atau null bila hari kerja.
 * @param {string} ymd       Tanggal 'YYYY-MM-DD' (WIB)
 * @param {string} monthDay  'MM-DD' untuk pencocokan fallback statis
 * @returns {string|null}
 */
function getHolidayReason(ymd, monthDay) {
  refreshIfStale();
  // DB dianggap sumber kebenaran HANYA bila sudah terisi. Bila kosong (cold start
  // atau tabel belum diisi), pakai fallback SKB 2026 agar tidak ada regresi.
  if (_byDate.size > 0) {
    return _byDate.get(ymd) || null;
  }
  return FALLBACK_2026[monthDay] || null;
}

/** Paksa muat ulang cache (panggil setelah admin tambah/ubah/hapus/sync hari libur). */
function clearHolidayCache() {
  _loadedAt = 0;
  _loading = load();
}

// Warm cache saat modul dimuat (non-blocking).
_loading = load();

module.exports = { getHolidayReason, clearHolidayCache, FALLBACK_2026 };
