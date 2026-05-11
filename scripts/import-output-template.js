#!/usr/bin/env node
/**
 * Import Output Template Pengurus Kelembagaan
 *
 * Reads `output_template_pengurus_kelembagaan_<kecamatan>.xlsx` files (the
 * post-mapping output produced by `BNBA ONLY/_TEMPLATE_IMPORT/build_template_from_bnba.py`)
 * and idempotently UPSERTs the rows into the DPMD database.
 *
 * Behaviour:
 *   - Each new lembaga / pengurus row is inserted with `imported = TRUE`.
 *   - Existing rows with `imported = TRUE` are UPDATEd from the template.
 *   - Existing rows with `imported = FALSE` are SKIPPED (manual edits via
 *     the web UI are preserved — the importer will not overwrite them).
 *
 * Usage:
 *   node scripts/import-output-template.js --workbook <path> [--mode plan|apply]
 *                                          [--include-sheet <name>] [--report-file <path>]
 *
 * Examples:
 *   # Dry-run preview (default)
 *   node scripts/import-output-template.js \
 *     --workbook "../BNBA ONLY/output template kecamatn/output_template_pengurus_kelembagaan_cileungsi.xlsx"
 *
 *   # Apply for real
 *   node scripts/import-output-template.js \
 *     --workbook "../BNBA ONLY/output template kecamatn/output_template_pengurus_kelembagaan_cileungsi.xlsx" \
 *     --mode apply
 */

const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
const { v4: uuidv4 } = require('uuid');
const xlsx = require('xlsx');

const SUPPORTED_MODES = new Set(['plan', 'apply']);

const DATA_SHEETS = [
  '01_RTRW',
  '02_POSYANDU',
  '03_LPM',
  '04_KARANG_TARUNA',
  '05_PKK',
  '06_LINMAS',
  '07_LEMBAGA_LAINNYA',
];

const PENGURUSABLE_BY_SHEET = {
  '01_RTRW': null, // resolved per-row (rws / rts depending on jenis_wilayah)
  '02_POSYANDU': 'posyandus',
  '03_LPM': 'lpms',
  '04_KARANG_TARUNA': 'karang_tarunas',
  '05_PKK': 'pkks',
  '06_LINMAS': 'satlinmas',
  '07_LEMBAGA_LAINNYA': 'lembaga-lainnya',
};

loadEnvironment();

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }

  const workbookPath = path.resolve(process.cwd(), options.workbook);
  if (!fs.existsSync(workbookPath)) {
    throw new Error(`Workbook tidak ditemukan: ${workbookPath}`);
  }

  console.log(`\n=== Import Output Template ===`);
  console.log(`Workbook : ${workbookPath}`);
  console.log(`Mode     : ${options.mode}`);
  console.log(`Sheets   : ${options.includeSheets.length ? options.includeSheets.join(', ') : 'ALL'}\n`);

  const workbook = xlsx.readFile(workbookPath, { raw: true, cellDates: false });
  const allRows = collectAllRows(workbook, options);
  console.log(`Total baris terbaca dari template: ${allRows.length}`);

  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL tidak ditemukan. Sediakan .env backend sebelum menjalankan import.');
  }

  const prisma = createPrismaClient();
  const stats = createStatsObject();
  const skipped = [];

  try {
    const desaCache = new Map(); // kode_desa → { id, nama }
    const lembagaCache = new Map(); // key → { id, imported, table } so we resolve only once per import session

    for (const row of allRows) {
      try {
        await processRow(prisma, row, options, desaCache, lembagaCache, stats, skipped);
      } catch (err) {
        stats.errors += 1;
        skipped.push({
          sheet: row.sheet,
          row: row.rowIndex,
          desa: row.kode_desa,
          nama: row.nama_lengkap,
          reason: `ERROR: ${err.message}`,
        });
      }
    }

    printSummary(stats, skipped, options);

    if (options.reportFile) {
      const report = { mode: options.mode, workbookPath, stats, skipped };
      fs.writeFileSync(path.resolve(process.cwd(), options.reportFile), JSON.stringify(report, null, 2), 'utf8');
      console.log(`\nReport JSON: ${options.reportFile}`);
    }
  } finally {
    await prisma.$disconnect();
  }
}

function loadEnvironment() {
  const backendRoot = path.resolve(__dirname, '..');
  for (const candidate of ['.env', '.env.production']) {
    const fullPath = path.join(backendRoot, candidate);
    if (fs.existsSync(fullPath)) {
      dotenv.config({ path: fullPath, override: false });
    }
  }
}

function createPrismaClient() {
  const { PrismaClient } = require('@prisma/client');
  return new PrismaClient({ log: [] });
}

function parseArgs(argv) {
  const options = {
    workbook: null,
    mode: 'plan',
    includeSheets: [],
    reportFile: null,
    help: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    switch (arg) {
      case '--workbook':
        options.workbook = argv[++i];
        break;
      case '--mode':
        options.mode = argv[++i];
        break;
      case '--include-sheet':
        options.includeSheets.push(argv[++i]);
        break;
      case '--report-file':
        options.reportFile = argv[++i];
        break;
      case '--help':
      case '-h':
        options.help = true;
        break;
      default:
        throw new Error(`Argumen tidak dikenali: ${arg}`);
    }
  }

  if (options.help) return options;
  if (!options.workbook) throw new Error('--workbook wajib diisi.');
  if (!SUPPORTED_MODES.has(options.mode)) {
    throw new Error(`--mode harus: ${[...SUPPORTED_MODES].join(', ')}`);
  }

  return options;
}

function printHelp() {
  console.log([
    'Import output_template_pengurus_kelembagaan_<kec>.xlsx ke database DPMD.',
    '',
    'Usage:',
    '  node scripts/import-output-template.js --workbook <path> [--mode plan|apply] [--include-sheet <name>] [--report-file <path>]',
    '',
    'Mode:',
    '  plan  (default) Hitung yang akan diinsert/update/skip tanpa mengubah DB.',
    '  apply           Eksekusi insert/update sesungguhnya.',
    '',
    'Pilihan sheet (boleh diulang):',
    '  --include-sheet 01_RTRW',
    '  --include-sheet 02_POSYANDU',
    '  --include-sheet 03_LPM ... 07_LEMBAGA_LAINNYA',
    '',
    'Catatan:',
    '  - Insert baru: imported = TRUE.',
    '  - Update: hanya mengupdate baris yang sebelumnya imported = TRUE.',
    '  - Skip: baris dengan imported = FALSE (dianggap sudah diedit manual via web).',
  ].join('\n'));
}

function createStatsObject() {
  const empty = () => ({ insert: 0, update: 0, skip_manual: 0, skip_invalid: 0 });
  return {
    desaResolved: 0,
    desaMissing: 0,
    lembaga: {
      rws: empty(), rts: empty(), posyandus: empty(),
      lpms: empty(), karang_tarunas: empty(), pkks: empty(),
      satlinmas: empty(), lembaga_lainnyas: empty(),
    },
    pengurus: empty(),
    errors: 0,
  };
}

// =====================================================================
// Workbook → flat rows
// =====================================================================

function collectAllRows(workbook, options) {
  const rows = [];
  const wantedSheets = options.includeSheets.length ? options.includeSheets : DATA_SHEETS;

  for (const sheetName of wantedSheets) {
    if (!workbook.SheetNames.includes(sheetName)) {
      console.warn(`  ! Sheet '${sheetName}' tidak ada di workbook. Dilewati.`);
      continue;
    }
    const sheet = workbook.Sheets[sheetName];
    const data = xlsx.utils.sheet_to_json(sheet, {
      header: 1,
      raw: true,
      defval: null,
      blankrows: false,
    });

    if (!data.length) continue;
    const headers = data[0].map((h) => (h == null ? '' : String(h).trim()));
    for (let i = 1; i < data.length; i += 1) {
      const row = data[i];
      if (!row || !row.some((cell) => cell !== null && cell !== '')) continue;
      const obj = { sheet: sheetName, rowIndex: i + 1 };
      headers.forEach((h, idx) => {
        if (h) obj[h] = row[idx];
      });
      // Skip rows without nama_lengkap (lembaga-only rows do not exist in the template)
      if (!textValue(obj.nama_lengkap)) continue;
      rows.push(obj);
    }
  }
  return rows;
}

// =====================================================================
// Row processing
// =====================================================================

async function processRow(prisma, row, options, desaCache, lembagaCache, stats, skipped) {
  // 1. Resolve desa
  const desa = await resolveDesa(prisma, row.kode_desa, desaCache);
  if (!desa) {
    stats.desaMissing += 1;
    stats.pengurus.skip_invalid += 1;
    skipped.push({
      sheet: row.sheet,
      row: row.rowIndex,
      desa: row.kode_desa || row.desa,
      nama: row.nama_lengkap,
      reason: `kode_desa '${row.kode_desa}' tidak ditemukan di tabel desas`,
    });
    return;
  }

  // 2. Resolve / upsert lembaga
  const lembagaResult = await resolveLembaga(prisma, row, desa, lembagaCache, options, stats);
  if (!lembagaResult) {
    stats.pengurus.skip_invalid += 1;
    skipped.push({
      sheet: row.sheet,
      row: row.rowIndex,
      desa: desa.nama,
      nama: row.nama_lengkap,
      reason: 'Tidak bisa menentukan lembaga (data wilayah/nama lembaga kosong)',
    });
    return;
  }

  // 3. Upsert pengurus
  await upsertPengurus(prisma, row, desa, lembagaResult, options, stats, skipped);
}

async function resolveDesa(prisma, kodeDesa, cache) {
  const kode = textValue(kodeDesa);
  if (!kode) return null;
  if (cache.has(kode)) return cache.get(kode);

  const desa = await prisma.desas.findUnique({
    where: { kode },
    select: { id: true, nama: true },
  });
  cache.set(kode, desa || null);
  return desa;
}

// =====================================================================
// Lembaga upsert
// =====================================================================

async function resolveLembaga(prisma, row, desa, cache, options, stats) {
  const sheet = row.sheet;

  if (sheet === '01_RTRW') {
    return upsertRwOrRt(prisma, row, desa, cache, options, stats);
  }

  const tableMap = {
    '02_POSYANDU': { table: 'posyandus', pengurusableType: 'posyandus', nameField: 'nama_posyandu', addressField: 'alamat_posyandu' },
    '03_LPM': { table: 'lpms', pengurusableType: 'lpms', nameField: 'nama_lembaga', addressField: 'alamat_sekretariat', defaultNamePrefix: 'LPM DESA' },
    '04_KARANG_TARUNA': { table: 'karang_tarunas', pengurusableType: 'karang_tarunas', nameField: 'nama_lembaga', addressField: 'alamat_sekretariat', defaultNamePrefix: 'KARANG TARUNA DESA' },
    '05_PKK': { table: 'pkks', pengurusableType: 'pkks', nameField: 'nama_lembaga', addressField: 'alamat_sekretariat', defaultNamePrefix: 'PKK DESA' },
    '06_LINMAS': { table: 'satlinmas', pengurusableType: 'satlinmas', nameField: 'nama_lembaga', addressField: 'alamat_sekretariat', defaultNamePrefix: 'SATLINMAS DESA' },
    '07_LEMBAGA_LAINNYA': { table: 'lembaga_lainnyas', pengurusableType: 'lembaga-lainnya', nameField: 'nama_lembaga', addressField: 'alamat_sekretariat' },
  }[sheet];

  if (!tableMap) return null;

  let nama = upper(textValue(row[tableMap.nameField]));
  if (!nama && tableMap.defaultNamePrefix) {
    nama = `${tableMap.defaultNamePrefix} ${desa.nama.toUpperCase()}`;
  }
  if (!nama) return null;

  const cacheKey = `${tableMap.table}:${desa.id}:${nama}`;
  if (cache.has(cacheKey)) return cache.get(cacheKey);

  const alamat = upper(textValue(row[tableMap.addressField]));

  const existing = await prisma[tableMap.table].findFirst({
    where: { desa_id: desa.id, nama },
    select: { id: true, imported: true, alamat: true },
  });

  let lembagaId;
  let resultImported;

  if (existing) {
    lembagaId = existing.id;
    resultImported = existing.imported;
    if (existing.imported) {
      // Imported row → safe to refresh from template
      stats.lembaga[tableMap.table].update += 1;
      if (options.mode === 'apply' && alamat && alamat !== existing.alamat) {
        await prisma[tableMap.table].update({
          where: { id: existing.id },
          data: { alamat },
        });
      }
    } else {
      // Manual row → leave alone, but still attach pengurus to it
      stats.lembaga[tableMap.table].skip_manual += 1;
    }
  } else {
    lembagaId = uuidv4();
    stats.lembaga[tableMap.table].insert += 1;
    if (options.mode === 'apply') {
      await prisma[tableMap.table].create({
        data: {
          id: lembagaId,
          desa_id: desa.id,
          nama,
          alamat: alamat || null,
          status_kelembagaan: 'aktif',
          status_verifikasi: 'unverified',
          imported: true,
        },
      });
    }
    resultImported = true;
  }

  const result = { id: lembagaId, pengurusableType: tableMap.pengurusableType, imported: resultImported };
  cache.set(cacheKey, result);
  return result;
}

async function upsertRwOrRt(prisma, row, desa, cache, options, stats) {
  const jenis = upper(textValue(row.jenis_wilayah));
  const nomorRw = padNomor(row.nomor_rw);
  const nomorRt = padNomor(row.nomor_rt);
  if (!jenis || !nomorRw) return null;

  const alamat = upper(textValue(row.alamat_lembaga));

  // 1. Ensure RW exists
  const rwCacheKey = `rws:${desa.id}:${nomorRw}`;
  let rw = cache.get(rwCacheKey);
  if (!rw) {
    const existingRw = await prisma.rws.findFirst({
      where: { desa_id: desa.id, nomor: nomorRw },
      select: { id: true, imported: true, alamat: true },
    });
    if (existingRw) {
      rw = { id: existingRw.id, imported: existingRw.imported };
      // For RW we only count an "update" when the row that landed here is RW itself
      // (jenis === 'RW'); otherwise we are just resolving the parent.
      if (jenis === 'RW') {
        if (existingRw.imported) {
          stats.lembaga.rws.update += 1;
          if (options.mode === 'apply' && alamat && alamat !== existingRw.alamat) {
            await prisma.rws.update({ where: { id: existingRw.id }, data: { alamat } });
          }
        } else {
          stats.lembaga.rws.skip_manual += 1;
        }
      }
    } else {
      const newId = uuidv4();
      rw = { id: newId, imported: true };
      if (jenis === 'RW') stats.lembaga.rws.insert += 1;
      if (options.mode === 'apply') {
        await prisma.rws.create({
          data: {
            id: newId,
            desa_id: desa.id,
            nomor: nomorRw,
            alamat: jenis === 'RW' ? alamat || null : null,
            status_kelembagaan: 'aktif',
            status_verifikasi: 'unverified',
            imported: true,
          },
        });
      }
    }
    cache.set(rwCacheKey, rw);
  }

  if (jenis === 'RW') {
    return { id: rw.id, pengurusableType: 'rws', imported: rw.imported };
  }

  if (jenis !== 'RT' || !nomorRt) return null;

  // 2. Ensure RT exists
  const rtCacheKey = `rts:${rw.id}:${nomorRt}`;
  let rt = cache.get(rtCacheKey);
  if (!rt) {
    const existingRt = await prisma.rts.findFirst({
      where: { rw_id: rw.id, nomor: nomorRt },
      select: { id: true, imported: true, alamat: true },
    });
    if (existingRt) {
      rt = { id: existingRt.id, imported: existingRt.imported };
      if (existingRt.imported) {
        stats.lembaga.rts.update += 1;
        if (options.mode === 'apply' && alamat && alamat !== existingRt.alamat) {
          await prisma.rts.update({ where: { id: existingRt.id }, data: { alamat } });
        }
      } else {
        stats.lembaga.rts.skip_manual += 1;
      }
    } else {
      const newId = uuidv4();
      rt = { id: newId, imported: true };
      stats.lembaga.rts.insert += 1;
      if (options.mode === 'apply') {
        await prisma.rts.create({
          data: {
            id: newId,
            rw_id: rw.id,
            desa_id: desa.id,
            nomor: nomorRt,
            alamat: alamat || null,
            status_kelembagaan: 'aktif',
            status_verifikasi: 'unverified',
            imported: true,
          },
        });
      }
    }
    cache.set(rtCacheKey, rt);
  }

  return { id: rt.id, pengurusableType: 'rts', imported: rt.imported };
}

// =====================================================================
// Pengurus upsert
// =====================================================================

async function upsertPengurus(prisma, row, desa, lembaga, options, stats, skipped) {
  const namaLengkap = upper(textValue(row.nama_lengkap));
  const jabatan = upper(textValue(row.jabatan));
  if (!namaLengkap || !jabatan) {
    stats.pengurus.skip_invalid += 1;
    return;
  }

  const nik = textValue(row.nik) || null;

  // Find existing pengurus by (pengurusable, nik) first (most stable),
  // then fall back to (pengurusable, nama_lengkap, jabatan).
  let existing = null;
  if (nik) {
    existing = await prisma.pengurus.findFirst({
      where: {
        pengurusable_type: lembaga.pengurusableType,
        pengurusable_id: lembaga.id,
        nik,
      },
      select: { id: true, imported: true },
    });
  }
  if (!existing) {
    existing = await prisma.pengurus.findFirst({
      where: {
        pengurusable_type: lembaga.pengurusableType,
        pengurusable_id: lembaga.id,
        nama_lengkap: namaLengkap,
        jabatan,
      },
      select: { id: true, imported: true },
    });
  }

  const data = buildPengurusData({ row, desa, lembaga, namaLengkap, jabatan, nik });

  if (!existing) {
    stats.pengurus.insert += 1;
    if (options.mode === 'apply') {
      await prisma.pengurus.create({
        data: { id: uuidv4(), ...data, imported: true },
      });
    }
    return;
  }

  if (!existing.imported) {
    stats.pengurus.skip_manual += 1;
    skipped.push({
      sheet: row.sheet,
      row: row.rowIndex,
      desa: desa.nama,
      nama: namaLengkap,
      reason: 'Pengurus sudah ada dengan imported=FALSE (data manual). Diabaikan.',
    });
    return;
  }

  stats.pengurus.update += 1;
  if (options.mode === 'apply') {
    await prisma.pengurus.update({
      where: { id: existing.id },
      data, // imported tetap TRUE (tidak ditimpa karena tidak masuk di data)
    });
  }
}

function buildPengurusData({ row, desa, lembaga, namaLengkap, jabatan, nik }) {
  return {
    desa_id: desa.id,
    pengurusable_type: lembaga.pengurusableType,
    pengurusable_id: lembaga.id,
    nama_lengkap: namaLengkap,
    jabatan,
    nik,
    tempat_lahir: upper(textValue(row.tempat_lahir)) || null,
    tanggal_lahir: parseDate(row.tanggal_lahir),
    jenis_kelamin: parseGender(row.jenis_kelamin),
    status_perkawinan: upper(textValue(row.status_perkawinan)) || null,
    pendidikan: upper(textValue(row.pendidikan)) || null,
    agama: upper(textValue(row.agama)) || null,
    golongan_darah: upper(textValue(row.golongan_darah)) || null,
    nomor_buku_nikah: upper(textValue(row.nomor_buku_nikah)) || null,
    alamat: buildAlamat(row),
    no_telepon: textValue(row.no_telepon) || null,
    nama_bank: textValue(row.nama_bank) || null,
    nomor_rekening: textValue(row.nomor_rekening) || null,
    nama_rekening: textValue(row.nama_rekening) || null,
    tanggal_mulai_jabatan: parseDate(row.tanggal_mulai_jabatan),
    tanggal_akhir_jabatan: parseDate(row.tanggal_akhir_jabatan),
    status_jabatan: lowerEnum(row.status_jabatan, ['aktif', 'selesai']) || 'aktif',
    status_verifikasi: lowerEnum(row.status_verifikasi_pengurus, ['verified', 'unverified']) || 'unverified',
    produk_hukum_id: textValue(row.produk_hukum_id_pengurus) || null,
  };
}

function buildAlamat(row) {
  const parts = [
    textValue(row.alamat_rumah),
    row.rt_rumah ? `RT ${padNomor(row.rt_rumah)}` : null,
    row.rw_rumah ? `RW ${padNomor(row.rw_rumah)}` : null,
    textValue(row.desa_alamat) ? `DESA ${textValue(row.desa_alamat)}` : null,
    textValue(row.kecamatan_alamat) ? `KECAMATAN ${textValue(row.kecamatan_alamat)}` : null,
    textValue(row.kode_pos),
  ].filter(Boolean);
  const joined = parts.join(' ').trim().replace(/\s+/g, ' ');
  return joined ? upper(joined) : null;
}

// =====================================================================
// Helpers
// =====================================================================

function textValue(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return String(value).trim();
}

function upper(value) {
  return value ? value.toUpperCase() : value;
}

function padNomor(value) {
  const text = textValue(value);
  if (!text) return '';
  const digits = text.replace(/\D+/g, '');
  if (!digits) return '';
  return digits.padStart(3, '0').slice(-3);
}

function parseGender(value) {
  const v = upper(textValue(value));
  if (!v) return null;
  if (v.startsWith('L') || v === 'LAKI-LAKI' || v === 'LAKI LAKI' || v === 'LAKI_LAKI') return 'Laki_laki';
  if (v.startsWith('P') || v === 'PEREMPUAN') return 'Perempuan';
  return null;
}

function parseDate(value) {
  if (value === null || value === undefined || value === '') return null;
  if (value instanceof Date && !isNaN(value)) return value;
  if (typeof value === 'number' && Number.isFinite(value)) {
    // Excel serial date
    const epoch = new Date(Date.UTC(1899, 11, 30));
    const ms = Math.round(value * 24 * 60 * 60 * 1000);
    const d = new Date(epoch.getTime() + ms);
    return isNaN(d) ? null : d;
  }
  const text = String(value).trim();
  if (!text) return null;
  // ISO yyyy-mm-dd
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    const d = new Date(`${text}T00:00:00Z`);
    return isNaN(d) ? null : d;
  }
  const d = new Date(text);
  return isNaN(d) ? null : d;
}

function lowerEnum(value, allowed) {
  const v = textValue(value).toLowerCase();
  if (!v) return null;
  return allowed.includes(v) ? v : null;
}

// =====================================================================
// Reporting
// =====================================================================

function printSummary(stats, skipped, options) {
  console.log(`\n=== Ringkasan (${options.mode.toUpperCase()}) ===`);
  console.log(`Desa berhasil di-resolve : count via cache (lihat per-row)`);
  console.log(`Desa tidak ditemukan     : ${stats.desaMissing}`);
  console.log(`Errors                   : ${stats.errors}`);

  console.log(`\nLembaga (insert / update / skip_manual / skip_invalid):`);
  for (const [table, c] of Object.entries(stats.lembaga)) {
    if (c.insert + c.update + c.skip_manual + c.skip_invalid === 0) continue;
    console.log(`  ${table.padEnd(20)} ${String(c.insert).padStart(5)}  ${String(c.update).padStart(5)}  ${String(c.skip_manual).padStart(5)}  ${String(c.skip_invalid).padStart(5)}`);
  }

  console.log(`\nPengurus:`);
  console.log(`  insert        : ${stats.pengurus.insert}`);
  console.log(`  update        : ${stats.pengurus.update}`);
  console.log(`  skip (manual) : ${stats.pengurus.skip_manual}`);
  console.log(`  skip (invalid): ${stats.pengurus.skip_invalid}`);

  if (skipped.length) {
    console.log(`\nDetail ${skipped.length} skip/error (max 25 ditampilkan):`);
    for (const item of skipped.slice(0, 25)) {
      console.log(`  [${item.sheet} row ${item.row}] desa=${item.desa} nama=${item.nama}: ${item.reason}`);
    }
    if (skipped.length > 25) console.log(`  ... dan ${skipped.length - 25} lainnya (lihat --report-file).`);
  }

  if (options.mode === 'plan') {
    console.log(`\n*** Mode PLAN — tidak ada perubahan ke database. Jalankan dengan --mode apply untuk eksekusi. ***`);
  }
}

main().catch((err) => {
  console.error('\nFATAL:', err.message);
  console.error(err.stack);
  process.exit(1);
});
