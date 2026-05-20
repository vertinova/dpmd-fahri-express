/**
 * Seeder: Anggaran Master Kegiatan dari list_belanja.json
 * Mapping: 2.13.01 → Sekretariat (bidang_id=2), 2.13.02/03/04 → Pemdes (bidang_id=6), 2.13.05 → PMD (bidang_id=5)
 */

require('dotenv').config();
const mysql = require('mysql2/promise');
const path = require('path');
const listBelanja = require('../data/anggaran/list_belanja.json');

// Parse DATABASE_URL jika ada, fallback ke individual env vars
function parseDbConfig() {
  const url = process.env.DATABASE_URL;
  if (url) {
    const m = url.match(/mysql:\/\/([^:]+):([^@]*)@([^:]+):(\d+)\/([^?]+)/);
    if (m) return { user: m[1], password: m[2], host: m[3], port: Number(m[4]), database: m[5] };
  }
  return {
    host:     process.env.DB_HOST     || 'localhost',
    port:     Number(process.env.DB_PORT) || 3306,
    user:     process.env.DB_USER     || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME     || 'dpmd',
  };
}

const DB_CONFIG = parseDbConfig();

// Mapping kode_program → bidang_id
const PROGRAM_BIDANG_MAP = {
  '2.13.01': 2, // Sekretariat
  '2.13.02': 6, // Pemerintahan Desa
  '2.13.03': 6, // Pemerintahan Desa
  '2.13.04': 6, // Pemerintahan Desa
  '2.13.05': 5, // Pemberdayaan Masyarakat Desa
};

// Mapping kode_giat → bidang_unit kode (hanya untuk Sekretariat 2.13.01)
function getUnitKode(kode_giat) {
  if (kode_giat === '2.13.01.2.01') return 'SPL'; // Sub Bagian Program dan Laporan
  if (kode_giat === '2.13.01.2.02') return 'SKU'; // Sub Bagian Keuangan
  return 'SUK'; // Semua kegiatan 2.13.01 lainnya → Sub Bagian Umum dan Kepegawaian
}

async function main() {
  const conn = await mysql.createConnection(DB_CONFIG);
  console.log('Connected to MySQL\n');

  // 1. Ambil sub-unit yang sudah di-seed (bidang_id=2)
  const [units] = await conn.query(
    'SELECT id, kode FROM anggaran_bidang_units WHERE bidang_id = 2'
  );
  const unitMap = {}; // kode → id
  units.forEach(u => { unitMap[u.kode] = u.id; });
  console.log('Bidang units (Sekretariat):', unitMap);

  // 2. Ambil superadmin user id (created_by)
  const [admins] = await conn.query(
    "SELECT id FROM users WHERE role = 'superadmin' LIMIT 1"
  );
  if (!admins.length) {
    console.error('No superadmin user found. Aborted.');
    process.exit(1);
  }
  const createdBy = admins[0].id;
  console.log('Using created_by:', createdBy, '\n');

  // 3. Deduplikasi sub-kegiatan dari JSON (setiap baris = 1 sub_giat)
  //    Kita ambil unique berdasarkan id_sub_giat (per sub kegiatan)
  const subGiatMap = new Map(); // id_sub_giat → row
  for (const row of listBelanja.data) {
    if (!subGiatMap.has(row.id_sub_giat)) {
      subGiatMap.set(row.id_sub_giat, row);
    }
  }

  console.log(`Total unique sub-kegiatan: ${subGiatMap.size}`);

  let insertedMaster = 0;
  let insertedPagu = 0;
  let skipped = 0;

  for (const [id_sub_giat, row] of subGiatMap) {
    const bidang_id = PROGRAM_BIDANG_MAP[row.kode_program];
    if (!bidang_id) {
      console.warn(`  SKIP: kode_program ${row.kode_program} tidak ada mapping`);
      skipped++;
      continue;
    }

    let bidang_unit_id = null;
    if (row.kode_program === '2.13.01') {
      const unitKode = getUnitKode(row.kode_giat);
      bidang_unit_id = unitMap[unitKode] || null;
    }

    // Upsert master kegiatan based on id_sub_giat
    const [existingMaster] = await conn.query(
      'SELECT id FROM anggaran_master_kegiatan WHERE id_sub_giat = ?',
      [id_sub_giat]
    );

    let masterId;
    if (existingMaster.length > 0) {
      masterId = existingMaster[0].id;
      console.log(`  EXISTS master: ${row.kode_sub_giat} (id=${masterId})`);
    } else {
      const [result] = await conn.query(
        `INSERT INTO anggaran_master_kegiatan
          (bidang_id, bidang_unit_id, kode_program, nama_program, kode_kegiatan, nama_kegiatan,
           kode_sub_kegiatan, nama_sub_kegiatan, id_giat, id_sub_giat, urutan, is_active, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 1, ?)`,
        [
          bidang_id,
          bidang_unit_id,
          row.kode_program,
          row.nama_program,
          row.kode_giat,
          row.nama_giat,
          row.kode_sub_giat,
          row.nama_sub_giat,
          row.id_giat,
          row.id_sub_giat,
          createdBy,
        ]
      );
      masterId = result.insertId;
      insertedMaster++;
      console.log(`  INSERT master: ${row.kode_sub_giat} → bidang_id=${bidang_id}, unit_id=${bidang_unit_id}`);
    }

    // Upsert pagu untuk tahun 2026
    const [existingPagu] = await conn.query(
      'SELECT id FROM anggaran_pagu WHERE master_kegiatan_id = ? AND tahun = 2026',
      [masterId]
    );

    const paguVal = row.pagu || 0;
    const paguIndikatif = row.pagu_indikatif || 0;

    if (existingPagu.length > 0) {
      await conn.query(
        'UPDATE anggaran_pagu SET pagu = ?, pagu_indikatif = ? WHERE id = ?',
        [paguVal, paguIndikatif, existingPagu[0].id]
      );
      console.log(`    UPSERT pagu 2026: ${paguVal}`);
    } else {
      await conn.query(
        'INSERT INTO anggaran_pagu (master_kegiatan_id, tahun, pagu, pagu_indikatif, created_by) VALUES (?, 2026, ?, ?, ?)',
        [masterId, paguVal, paguIndikatif, createdBy]
      );
      insertedPagu++;
      console.log(`    INSERT pagu 2026: ${paguVal}`);
    }
  }

  console.log(`\n========================================`);
  console.log(`Master kegiatan inserted: ${insertedMaster}`);
  console.log(`Pagu 2026 inserted: ${insertedPagu}`);
  console.log(`Skipped: ${skipped}`);
  console.log(`========================================`);

  await conn.end();
}

main().catch(err => {
  console.error('Seeder error:', err);
  process.exit(1);
});
