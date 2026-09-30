/**
 * Penyimpanan Manajemen Server: konfigurasi (app_settings) dan tabel-tabel
 * server_* (jejak serangan, blokir IP, riwayat metrik).
 *
 * Tabel dipakai lewat SQL mentah, bukan model Prisma, supaya fitur pemantauan
 * tetap bisa berjalan walau `prisma generate` belum dijalankan ulang — alat
 * pemantau sebaiknya tidak ikut mati karena urusan skema.
 */

const fs = require('fs');
const path = require('path');
const prisma = require('../config/prisma');
const logger = require('../utils/logger');
const { CONFIG_KEY, DEFAULT_CONFIG, BACKEND_ROOT } = require('../config/serverManagement');

let cachedConfig = null;
let cachedAt = 0;
const CONFIG_TTL_MS = 30 * 1000;

let tablesReady = null;

/** BigInt/Decimal dari $queryRaw → angka biasa supaya aman di-JSON-kan. */
const normalisasi = (baris) =>
  baris.map((r) => {
    const o = {};
    for (const [k, v] of Object.entries(r)) {
      if (typeof v === 'bigint') o[k] = Number(v);
      else if (v !== null && typeof v === 'object' && typeof v.toNumber === 'function') o[k] = v.toNumber();
      else o[k] = v;
    }
    return o;
  });

const query = async (sql, ...params) => normalisasi(await prisma.$queryRawUnsafe(sql, ...params));
const execute = (sql, ...params) => prisma.$executeRawUnsafe(sql, ...params);

/** Buat tabel server_* bila belum ada (isi sama dengan berkas migrasi). */
const ensureTables = () => {
  if (!tablesReady) {
    tablesReady = (async () => {
      const berkas = path.join(BACKEND_ROOT, 'migrations/20260928_create_server_management.sql');
      const sql = fs.readFileSync(berkas, 'utf8')
        .split('\n')
        .filter((baris) => !baris.trim().startsWith('--'))
        .join('\n');
      for (const perintah of sql.split(';').map((s) => s.trim()).filter(Boolean)) {
        await execute(perintah);
      }
    })().catch((error) => {
      tablesReady = null; // coba lagi di pemanggilan berikutnya
      logger.warn(`[ServerManagement] Gagal menyiapkan tabel: ${error.message}`);
      throw error;
    });
  }
  return tablesReady;
};

const gabung = (bawaan, tersimpan) => {
  if (!tersimpan || typeof tersimpan !== 'object' || Array.isArray(tersimpan)) return bawaan;
  const hasil = { ...bawaan };
  for (const [k, v] of Object.entries(bawaan)) {
    if (v && typeof v === 'object' && !Array.isArray(v)) hasil[k] = gabung(v, tersimpan[k]);
    else if (tersimpan[k] !== undefined) hasil[k] = tersimpan[k];
  }
  return hasil;
};

const getConfig = async ({ segar = false } = {}) => {
  if (!segar && cachedConfig && Date.now() - cachedAt < CONFIG_TTL_MS) return cachedConfig;
  try {
    const baris = await prisma.app_settings.findUnique({ where: { setting_key: CONFIG_KEY } });
    const tersimpan = baris ? JSON.parse(baris.setting_value) : null;
    cachedConfig = gabung(DEFAULT_CONFIG, tersimpan);
  } catch (error) {
    logger.warn(`[ServerManagement] Konfigurasi tidak terbaca, pakai bawaan: ${error.message}`);
    cachedConfig = cachedConfig || DEFAULT_CONFIG;
  }
  cachedAt = Date.now();
  return cachedConfig;
};

/** Konfigurasi terakhir yang diketahui, tanpa menunggu database (untuk middleware). */
const getConfigSync = () => {
  if (!cachedConfig || Date.now() - cachedAt > CONFIG_TTL_MS) getConfig().catch(() => {});
  return cachedConfig || DEFAULT_CONFIG;
};

const saveConfig = async (perubahan, userId) => {
  const sekarang = await getConfig({ segar: true });
  const baru = gabung(DEFAULT_CONFIG, gabung(sekarang, perubahan));
  await prisma.app_settings.upsert({
    where: { setting_key: CONFIG_KEY },
    update: { setting_value: JSON.stringify(baru), updated_by_user_id: userId ? BigInt(userId) : null, updated_at: new Date() },
    create: {
      setting_key: CONFIG_KEY,
      setting_value: JSON.stringify(baru),
      description: 'Konfigurasi Manajemen Server (peringatan, kuota storage, keamanan)',
      updated_by_user_id: userId ? BigInt(userId) : null,
      updated_at: new Date(),
    },
  });
  cachedConfig = baru;
  cachedAt = Date.now();
  return baru;
};

module.exports = { query, execute, ensureTables, getConfig, getConfigSync, saveConfig, normalisasi };
