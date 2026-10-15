#!/usr/bin/env node
/**
 * Segarkan desa-reference.json dari database (tabel desas + kecamatans).
 * Jalankan setiap ada perubahan wilayah, lalu commit hasilnya supaya
 * build-template.js tetap bisa dipakai offline di PC operator.
 *
 *   node scripts/bnba-build/refresh-desa-reference.js
 */

const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

const { REFERENCE_PATH } = require('./desa-reference');

function loadEnvironment() {
  for (const name of ['.env', '.env.production']) {
    const p = path.resolve(__dirname, '..', '..', name);
    if (fs.existsSync(p)) dotenv.config({ path: p });
  }
}

async function main() {
  loadEnvironment();
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL tidak ditemukan di .env');

  const { PrismaClient } = require('@prisma/client');
  const prisma = new PrismaClient();

  try {
    const kecamatans = await prisma.kecamatans.findMany({
      select: { id: true, kode: true, nama: true },
      orderBy: { kode: 'asc' },
    });
    const kecMap = new Map(kecamatans.map((k) => [String(k.id), k]));

    const desas = await prisma.desas.findMany({
      select: { kode: true, nama: true, status_pemerintahan: true, kecamatan_id: true },
      orderBy: { kode: 'asc' },
    });

    const payload = {
      generated_at: new Date().toISOString(),
      kecamatans: kecamatans.map((k) => ({ kode: k.kode, nama: k.nama })),
      desas: desas.map((d) => {
        const kec = kecMap.get(String(d.kecamatan_id));
        return {
          kode: d.kode,
          nama: d.nama,
          status: d.status_pemerintahan,
          kecamatan_kode: kec ? kec.kode : null,
          kecamatan: kec ? kec.nama : null,
        };
      }),
    };

    fs.writeFileSync(REFERENCE_PATH, JSON.stringify(payload, null, 1), 'utf8');
    console.log(`Referensi diperbarui: ${REFERENCE_PATH}`);
    console.log(`  ${payload.kecamatans.length} kecamatan, ${payload.desas.length} desa/kelurahan`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exitCode = 1;
});
