#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
const { v4: uuidv4 } = require('uuid');
const xlsx = require('xlsx');

const SUPPORTED_MODES = new Set(['plan', 'check', 'apply']);
const SIMULATED_PREFIX = 'SIMULATED:';

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

  const plan = buildImportPlan(workbookPath, options);
  let report = {
    mode: options.mode,
    workbookPath,
    metadata: {
      desaId: options.desaId,
      desaName: plan.metadata.desaName,
      kecamatanName: plan.metadata.kecamatanName
    },
    planSummary: plan.summary,
    fullPlan: plan,
    warnings: [...plan.warnings]
  };

  if (options.mode === 'plan') {
    printPlanReport(report);
    writeReportIfNeeded(report, options.reportFile);
    return;
  }

  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL tidak ditemukan. Gunakan --mode plan atau siapkan env database backend.');
  }

  const prisma = createPrismaClient();

  try {
    if (options.defaultProdukHukumId) {
      const produkHukum = await prisma.produk_hukums.findUnique({
        where: { id: options.defaultProdukHukumId },
        select: { id: true }
      });

      if (!produkHukum) {
        throw new Error(`produk_hukum_id tidak ditemukan: ${options.defaultProdukHukumId}`);
      }
    }

    const existingState = await loadExistingState(prisma, options.desaId);

    if (!existingState.desa) {
      throw new Error(`Desa dengan id ${options.desaId} tidak ditemukan di database.`);
    }

    if (plan.metadata.desaName && !sameText(existingState.desa.nama, plan.metadata.desaName)) {
      plan.warnings.push(
        `Nama desa workbook (${plan.metadata.desaName}) berbeda dengan database (${existingState.desa.nama}).`
      );
    }

    const syncResult = options.mode === 'apply'
      ? await prisma.$transaction((tx) => executeImport(tx, plan, options, existingState, true))
      : await executeImport(prisma, plan, options, existingState, false);

    report = {
      ...report,
      existing: buildExistingSummary(existingState),
      sync: syncResult.stats,
      warnings: [...plan.warnings, ...syncResult.warnings]
    };

    printSyncReport(report);
    writeReportIfNeeded(report, options.reportFile);
  } finally {
    await prisma.$disconnect();
  }
}

function loadEnvironment() {
  const backendRoot = path.resolve(__dirname, '..');
  const candidates = ['.env', '.env.production'];

  for (const candidate of candidates) {
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
    desaId: null,
    mode: 'plan',
    inferRwChairs: false,
    defaultProdukHukumId: null,
    reportFile: null,
    help: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    switch (arg) {
      case '--workbook':
        options.workbook = argv[index + 1];
        index += 1;
        break;
      case '--desa-id':
        options.desaId = Number(argv[index + 1]);
        index += 1;
        break;
      case '--mode':
        options.mode = argv[index + 1];
        index += 1;
        break;
      case '--infer-rw-chairs':
        options.inferRwChairs = true;
        break;
      case '--default-produk-hukum-id':
        options.defaultProdukHukumId = argv[index + 1];
        index += 1;
        break;
      case '--report-file':
        options.reportFile = argv[index + 1];
        index += 1;
        break;
      case '--help':
      case '-h':
        options.help = true;
        break;
      default:
        throw new Error(`Argumen tidak dikenali: ${arg}`);
    }
  }

  if (options.help) {
    return options;
  }

  if (!options.workbook) {
    throw new Error('--workbook wajib diisi.');
  }

  if (!Number.isInteger(options.desaId) || options.desaId <= 0) {
    throw new Error('--desa-id wajib berupa angka positif.');
  }

  if (!SUPPORTED_MODES.has(options.mode)) {
    throw new Error(`--mode harus salah satu dari: ${Array.from(SUPPORTED_MODES).join(', ')}`);
  }

  return options;
}

function printHelp() {
  console.log([
    'Import Workbook Kelembagaan',
    '',
    'Usage:',
    '  node scripts/import-kelembagaan-workbook.js --workbook <path> --desa-id <id> [options]',
    '',
    'Options:',
    '  --mode <plan|check|apply>      Default: plan',
    '  --infer-rw-chairs             Perlakukan 9 baris RTRW ambigu sebagai ketua RW',
    '  --default-produk-hukum-id ID  Isi produk_hukum_id default untuk record baru/update',
    '  --report-file <path>          Simpan report JSON',
    '  --help                        Tampilkan bantuan',
    '',
    'Examples:',
    '  node scripts/import-kelembagaan-workbook.js --workbook "../BABAKAN MADANG_CIJAYANTI_BNBA.xlsx" --desa-id 51',
    '  node scripts/import-kelembagaan-workbook.js --workbook "../BABAKAN MADANG_CIJAYANTI_BNBA.xlsx" --desa-id 51 --mode check',
    '  node scripts/import-kelembagaan-workbook.js --workbook "../BABAKAN MADANG_CIJAYANTI_BNBA.xlsx" --desa-id 51 --mode apply --infer-rw-chairs'
  ].join('\n'));
}

function buildImportPlan(workbookPath, options) {
  const workbook = xlsx.readFile(workbookPath, { raw: true, cellDates: false });
  const warnings = [];

  const rtrwRows = parseRtrwSheet(workbook, warnings);
  const lpmRows = parseSingletonSheet(workbook, 'LPM', {
    secretariatIndex: 10,
    houseAddressIndex: 11,
    rtIndex: 12,
    rwIndex: 13,
    desaIndex: 14,
    kecamatanIndex: 15,
    educationIndex: 17,
    statusIndex: 18,
    phoneIndex: 19,
    birthPlaceIndex: 4,
    birthDateIndex: 5,
    positionIndex: 7,
    nikIndex: 2,
    genderIndex: 3,
    masaBhaktiIndex: 9,
    skIndex: 8
  });
  const karangTarunaRows = parseSingletonSheet(workbook, 'KATAR', {
    secretariatIndex: 11,
    houseAddressIndex: 12,
    rtIndex: 13,
    rwIndex: 14,
    desaIndex: 15,
    kecamatanIndex: 16,
    educationIndex: 18,
    statusIndex: 19,
    phoneIndex: 20,
    birthPlaceIndex: 4,
    birthDateIndex: 5,
    positionIndex: 8,
    nikIndex: 2,
    genderIndex: 3,
    masaBhaktiIndex: 10,
    skIndex: 9
  });
  const pkkRows = parseSingletonSheet(workbook, 'PKK', {
    secretariatIndex: 11,
    houseAddressIndex: 12,
    rtIndex: 13,
    rwIndex: 14,
    desaIndex: 15,
    kecamatanIndex: 16,
    educationIndex: 18,
    statusIndex: 19,
    phoneIndex: 20,
    birthPlaceIndex: 4,
    birthDateIndex: 5,
    positionIndex: 8,
    nikIndex: 2,
    genderIndex: 3,
    masaBhaktiIndex: 10,
    skIndex: 9
  });
  const posyanduRows = parsePosyanduSheet(workbook, warnings);
  const kaderPosyanduRows = parseKaderPosyanduSheet(workbook);
  const linmasRows = parseSingletonSheet(workbook, 'LINMAS', {
    secretariatIndex: 9,
    houseAddressIndex: 10,
    rtIndex: 11,
    rwIndex: 12,
    desaIndex: 13,
    kecamatanIndex: 14,
    educationIndex: 16,
    statusIndex: 17,
    phoneIndex: 18,
    birthPlaceIndex: 4,
    birthDateIndex: 5,
    positionIndex: 6,
    nikIndex: 2,
    genderIndex: 3,
    masaBhaktiIndex: 8,
    skIndex: 7
  });

  const desaName = firstNonEmpty([
    rtrwRows[0]?.desa,
    lpmRows[0]?.desa,
    karangTarunaRows[0]?.desa,
    pkkRows[0]?.desa,
    posyanduRows[0]?.desa,
    kaderPosyanduRows[0]?.desa,
    linmasRows[0]?.desa
  ]);
  const kecamatanName = firstNonEmpty([
    rtrwRows[0]?.kecamatan,
    lpmRows[0]?.kecamatan,
    karangTarunaRows[0]?.kecamatan,
    pkkRows[0]?.kecamatan,
    posyanduRows[0]?.kecamatan,
    kaderPosyanduRows[0]?.kecamatan,
    linmasRows[0]?.kecamatan
  ]);

  const desaTitle = toTitleCase(desaName || `Desa ${options.desaId}`);

  const rwPlans = buildRwPlans(rtrwRows, options, warnings);
  const rtPlans = buildRtPlans(rtrwRows);
  const singletonPlans = buildSingletonPlans({
    desaTitle,
    lpmRows,
    karangTarunaRows,
    pkkRows,
    linmasRows
  });
  const posyanduPlans = buildPosyanduPlans(posyanduRows);
  const pengurusPlans = buildPengurusPlans({
    options,
    warnings,
    rtrwRows,
    rwPlans,
    lpmRows,
    karangTarunaRows,
    pkkRows,
    posyanduPlans,
    kaderPosyanduRows,
    linmasRows
  });

  return {
    workbookPath,
    metadata: {
      desaName,
      kecamatanName
    },
    rwPlans,
    rtPlans,
    singletonPlans,
    posyanduPlans,
    pengurusPlans,
    warnings,
    summary: {
      workbookRows: {
        RTRW: rtrwRows.length,
        LPM: lpmRows.length,
        KATAR: karangTarunaRows.length,
        PKK: pkkRows.length,
        POSYANDU: posyanduRows.length,
        KADER_POSYANDU: kaderPosyanduRows.length,
        LINMAS: linmasRows.length
      },
      entities: {
        rws: rwPlans.length,
        rts: rtPlans.length,
        lpms: singletonPlans.filter((item) => item.table === 'lpms').length,
        karang_tarunas: singletonPlans.filter((item) => item.table === 'karang_tarunas').length,
        pkks: singletonPlans.filter((item) => item.table === 'pkks').length,
        posyandus: posyanduPlans.length,
        satlinmas: singletonPlans.filter((item) => item.table === 'satlinmas').length,
        pengurus: pengurusPlans.length
      }
    }
  };
}

function parseRtrwSheet(workbook, warnings) {
  const rows = getSheetRows(workbook, 'RTRW');
  const headerIndex = findHeaderRow(rows, (cells) => cells.includes('NO') && cells.includes('NAMA'));

  if (headerIndex === -1) {
    if (warnings) warnings.push('Header sheet RTRW tidak ditemukan atau sheet kosong.');
    return [];
  }

  return rows
    .slice(headerIndex + 2)
    .map((row, offset) => {
      const jabatan = cellText(row, 6);
      const rw = padWilayah(row[7]);
      const rt = padWilayah(row[8]);
      const sourceRow = headerIndex + offset + 3;

      return {
        sourceSheet: 'RTRW',
        sourceRow,
        nama: cellText(row, 1),
        nik: cellText(row, 2),
        jenisKelamin: parseGender(row[3]),
        tempatLahir: cellText(row, 4),
        tanggalLahir: parseWorkbookDate(row[5]),
        tanggalLahirRaw: row[5],
        jabatan,
        rw,
        rt,
        nomorSk: cellText(row, 9),
        masaBhakti: parseWorkbookDate(row[10]),
        masaBhaktiRaw: row[10],
        alamat: buildAddress([
          cellText(row, 11),
          row[12] ? `RT ${padWilayah(row[12])}` : '',
          row[13] ? `RW ${padWilayah(row[13])}` : '',
          cellText(row, 14) ? `DESA ${cellText(row, 14)}` : '',
          cellText(row, 15) ? `KECAMATAN ${cellText(row, 15)}` : ''
        ]),
        desa: cellText(row, 14),
        kecamatan: cellText(row, 15),
        pendidikan: cellText(row, 17),
        statusPerkawinan: cellText(row, 18),
        noTelepon: cellText(row, 19)
      };
    })
    .filter((item) => item.nama && /^KETUA R[WT]$/i.test(item.jabatan))
    .map((item) => {
      if (item.jabatan === 'KETUA RT' && item.rw && !item.rt) {
        warnings.push(
          `RTRW row ${item.sourceRow}: ${item.nama} bertuliskan KETUA RT tetapi kolom RT kosong untuk RW ${item.rw}.`
        );
      }
      return item;
    });
}

function parseSingletonSheet(workbook, sheetLabel, config) {
  const rows = getSheetRows(workbook, sheetLabel);
  const headerIndex = findHeaderRow(rows, (cells) => cells.includes('NO') && cells.includes('NAMA'));

  if (headerIndex === -1) {
    return [];
  }

  return rows
    .slice(headerIndex + 2)
    .map((row, offset) => ({
      sourceSheet: sheetLabel,
      sourceRow: headerIndex + offset + 3,
      nama: cellText(row, 1),
      nik: cellText(row, config.nikIndex),
      jenisKelamin: parseGender(row[config.genderIndex]),
      tempatLahir: cellText(row, config.birthPlaceIndex),
      tanggalLahir: parseWorkbookDate(row[config.birthDateIndex]),
      tanggalLahirRaw: row[config.birthDateIndex],
      jabatan: cellText(row, config.positionIndex),
      nomorSk: cellText(row, config.skIndex),
      masaBhakti: parseWorkbookDate(row[config.masaBhaktiIndex]),
      masaBhaktiRaw: row[config.masaBhaktiIndex],
      alamatSekretariat: cellText(row, config.secretariatIndex),
      alamat: buildAddress([
        cellText(row, config.houseAddressIndex),
        row[config.rtIndex] ? `RT ${padWilayah(row[config.rtIndex])}` : '',
        row[config.rwIndex] ? `RW ${padWilayah(row[config.rwIndex])}` : '',
        cellText(row, config.desaIndex) ? `DESA ${cellText(row, config.desaIndex)}` : '',
        cellText(row, config.kecamatanIndex) ? `KECAMATAN ${cellText(row, config.kecamatanIndex)}` : ''
      ]),
      desa: cellText(row, config.desaIndex),
      kecamatan: cellText(row, config.kecamatanIndex),
      pendidikan: cellText(row, config.educationIndex),
      statusPerkawinan: cellText(row, config.statusIndex),
      noTelepon: cellText(row, config.phoneIndex)
    }))
    .filter((item) => item.nama && item.jabatan);
}

function parsePosyanduSheet(workbook, warnings) {
  const rows = getSheetRows(workbook, 'POSYANDU');
  const headerIndex = findHeaderRow(rows, (cells) => cells.includes('NO') && cells.includes('NAMA POSYANDU'));

  if (headerIndex === -1) {
    if (warnings) warnings.push('Header sheet POSYANDU tidak ditemukan atau kosong.');
    return [];
  }

  return rows
    .slice(headerIndex + 2)
    .map((row, offset) => ({
      sourceSheet: 'POSYANDU',
      sourceRow: headerIndex + offset + 3,
      nama: cellText(row, 1),
      alamat: buildAddress([
        cellText(row, 4),
        row[5] ? `RT ${padWilayah(row[5])}` : '',
        row[6] ? `RW ${padWilayah(row[6])}` : '',
        cellText(row, 7) ? `DESA ${cellText(row, 7)}` : '',
        cellText(row, 8) ? `KECAMATAN ${cellText(row, 8)}` : ''
      ]),
      desa: cellText(row, 7),
      kecamatan: cellText(row, 8),
      statusBangunan: cellText(row, 10),
      fallbackKetua: cellText(row, 11),
      fallbackPendidikan: cellText(row, 12),
      fallbackNoTelepon: cellText(row, 13)
    }))
    .filter((item) => item.nama)
    .filter((item) => {
      if (/^KETUA R[WT]$/i.test(item.nama)) {
        warnings.push(`POSYANDU row ${item.sourceRow}: ${item.nama} dikecualikan karena bukan nama posyandu.`);
        return false;
      }
      return true;
    });
}

function parseKaderPosyanduSheet(workbook) {
  const rows = getSheetRows(workbook, 'KADER POSYANDU');
  const headerIndex = findHeaderRow(rows, (cells) => cells.includes('NO') && cells.includes('NAMA'));

  if (headerIndex === -1) {
    return [];
  }

  return rows
    .slice(headerIndex + 2)
    .map((row, offset) => ({
      sourceSheet: 'KADER POSYANDU',
      sourceRow: headerIndex + offset + 3,
      nama: cellText(row, 1),
      nik: cellText(row, 2),
      jenisKelamin: parseGender(row[3]),
      tempatLahir: cellText(row, 4),
      tanggalLahir: parseWorkbookDate(row[5]),
      tanggalLahirRaw: row[5],
      jabatan: cellText(row, 6),
      posyanduNama: cellText(row, 7),
      nomorSk: cellText(row, 8),
      masaBhakti: parseWorkbookDate(row[9]),
      masaBhaktiRaw: row[9],
      alamat: buildAddress([
        cellText(row, 10),
        row[11] ? `RT ${padWilayah(row[11])}` : '',
        row[12] ? `RW ${padWilayah(row[12])}` : '',
        cellText(row, 13) ? `DESA ${cellText(row, 13)}` : '',
        cellText(row, 14) ? `KECAMATAN ${cellText(row, 14)}` : ''
      ]),
      desa: cellText(row, 13),
      kecamatan: cellText(row, 14),
      pendidikan: cellText(row, 16),
      statusPerkawinan: cellText(row, 17),
      noTelepon: cellText(row, 18)
    }))
    .filter((item) => item.nama && item.jabatan && item.posyanduNama);
}

function buildRwPlans(rtrwRows, options, warnings) {
  const plans = [];
  const byRw = groupBy(rtrwRows.filter((row) => row.rw), (row) => row.rw);

  for (const [rwNumber, rows] of byRw.entries()) {
    const explicitChair = rows.find((row) => row.jabatan === 'KETUA RW');
    const ambiguousChair = rows.find((row) => row.jabatan === 'KETUA RT' && !row.rt);
    let chair = explicitChair || null;
    let inferred = false;

    if (!chair && ambiguousChair && options.inferRwChairs) {
      chair = { ...ambiguousChair, jabatan: 'KETUA RW' };
      inferred = true;
      warnings.push(
        `RTRW row ${ambiguousChair.sourceRow}: ${ambiguousChair.nama} diinfer sebagai KETUA RW untuk RW ${rwNumber}.`
      );
    }

    plans.push({
      number: rwNumber,
      address: firstNonEmpty(rows.map((row) => row.alamat)),
      chair,
      inferred,
      hasAmbiguousChair: Boolean(ambiguousChair && !explicitChair)
    });
  }

  return plans.sort((left, right) => left.number.localeCompare(right.number));
}

function buildRtPlans(rtrwRows) {
  const keyed = new Map();

  for (const row of rtrwRows) {
    if (row.jabatan !== 'KETUA RT' || !row.rw || !row.rt) {
      continue;
    }

    const key = `${row.rw}/${row.rt}`;
    if (!keyed.has(key)) {
      keyed.set(key, {
        rwNumber: row.rw,
        number: row.rt,
        address: row.alamat
      });
    }
  }

  return Array.from(keyed.values()).sort((left, right) => {
    const rwCompare = left.rwNumber.localeCompare(right.rwNumber);
    return rwCompare !== 0 ? rwCompare : left.number.localeCompare(right.number);
  });
}

function buildSingletonPlans({ desaTitle, lpmRows, karangTarunaRows, pkkRows, linmasRows }) {
  return [
    {
      table: 'lpms',
      name: `LPM Desa ${desaTitle}`,
      address: firstNonEmpty(lpmRows.map((row) => row.alamatSekretariat))
    },
    {
      table: 'karang_tarunas',
      name: `Karang Taruna Desa ${desaTitle}`,
      address: firstNonEmpty(karangTarunaRows.map((row) => row.alamatSekretariat))
    },
    {
      table: 'pkks',
      name: `PKK Desa ${desaTitle}`,
      address: firstNonEmpty(pkkRows.map((row) => row.alamatSekretariat))
    },
    {
      table: 'satlinmas',
      name: `Satlinmas Desa ${desaTitle}`,
      address: firstNonEmpty(linmasRows.map((row) => row.alamatSekretariat))
    }
  ];
}

function buildPosyanduPlans(posyanduRows) {
  const keyed = new Map();

  for (const row of posyanduRows) {
    const key = normalizeKey(row.nama);
    if (!keyed.has(key)) {
      keyed.set(key, {
        key,
        name: row.nama,
        address: row.alamat,
        fallbackKetua: row.fallbackKetua,
        fallbackPendidikan: row.fallbackPendidikan,
        fallbackNoTelepon: row.fallbackNoTelepon
      });
    }
  }

  return Array.from(keyed.values()).sort((left, right) => left.key.localeCompare(right.key));
}

function buildPengurusPlans({
  options,
  warnings,
  rtrwRows,
  rwPlans,
  lpmRows,
  karangTarunaRows,
  pkkRows,
  posyanduPlans,
  kaderPosyanduRows,
  linmasRows
}) {
  const plans = [];
  const posyanduKeys = new Set(posyanduPlans.map((item) => item.key));

  for (const rwPlan of rwPlans) {
    if (!rwPlan.chair) {
      if (rwPlan.hasAmbiguousChair) {
        warnings.push(`RW ${rwPlan.number} belum diimpor pengurusnya karena row ketua masih ambigu.`);
      }
      continue;
    }

    plans.push(buildPengurusPlan(rwPlan.chair, {
      pengurusableType: 'rws',
      parentRef: { kind: 'rw', number: rwPlan.number },
      inferred: rwPlan.inferred
    }));
  }

  for (const row of rtrwRows) {
    if (row.jabatan !== 'KETUA RT' || !row.rw || !row.rt) {
      continue;
    }

    plans.push(buildPengurusPlan(row, {
      pengurusableType: 'rts',
      parentRef: { kind: 'rt', rwNumber: row.rw, number: row.rt }
    }));
  }

  appendSingletonPengurus(plans, lpmRows, 'lpms');
  appendSingletonPengurus(plans, karangTarunaRows, 'karang_tarunas');
  appendSingletonPengurus(plans, pkkRows, 'pkks');
  appendSingletonPengurus(plans, linmasRows, 'satlinmas');

  for (const row of kaderPosyanduRows) {
    const posyanduKey = normalizeKey(row.posyanduNama);
    if (!posyanduKeys.has(posyanduKey)) {
      warnings.push(
        `KADER POSYANDU row ${row.sourceRow}: parent posyandu ${row.posyanduNama} tidak ditemukan di sheet POSYANDU.`
      );
      continue;
    }

    plans.push(buildPengurusPlan(row, {
      pengurusableType: 'posyandus',
      parentRef: { kind: 'posyandu', key: posyanduKey, name: row.posyanduNama }
    }));
  }

  return dedupePengurusPlans(plans, warnings, options);
}

function appendSingletonPengurus(target, rows, table) {
  for (const row of rows) {
    target.push(buildPengurusPlan(row, {
      pengurusableType: table,
      parentRef: { kind: 'singleton', table }
    }));
  }
}

function buildPengurusPlan(row, { pengurusableType, parentRef, inferred = false }) {
  return {
    sourceSheet: row.sourceSheet,
    sourceRow: row.sourceRow,
    pengurusableType,
    parentRef,
    namaLengkap: row.nama,
    jabatan: row.jabatan,
    nik: row.nik || null,
    tempatLahir: row.tempatLahir || null,
    tanggalLahir: row.tanggalLahir,
    tanggalLahirRaw: row.tanggalLahirRaw,
    jenisKelamin: row.jenisKelamin,
    statusPerkawinan: row.statusPerkawinan || null,
    alamat: row.alamat || null,
    noTelepon: row.noTelepon || null,
    pendidikan: row.pendidikan || null,
    tanggalAkhirJabatan: row.masaBhakti,
    tanggalAkhirJabatanRaw: row.masaBhaktiRaw,
    nomorSk: row.nomorSk || null,
    inferred
  };
}

function dedupePengurusPlans(plans, warnings) {
  const keyed = new Map();

  for (const plan of plans) {
    const key = [
      plan.pengurusableType,
      buildParentRefKey(plan.parentRef),
      normalizeKey(plan.namaLengkap),
      normalizeKey(plan.jabatan)
    ].join('::');

    if (!keyed.has(key)) {
      keyed.set(key, plan);
      continue;
    }

    warnings.push(
      `${plan.sourceSheet} row ${plan.sourceRow}: duplikat pengurus ${plan.namaLengkap} (${plan.jabatan}) dilewati.`
    );
  }

  return Array.from(keyed.values());
}

async function loadExistingState(prisma, desaId) {
  const desaIdBigInt = BigInt(desaId);

  const [desa, rws, rts, lpms, karangTarunas, pkks, posyandus, satlinmas, pengurus] = await Promise.all([
    prisma.desas.findUnique({
      where: { id: desaIdBigInt },
      select: {
        id: true,
        nama: true,
        kecamatans: {
          select: {
            id: true,
            nama: true
          }
        }
      }
    }),
    prisma.rws.findMany({ where: { desa_id: desaIdBigInt } }),
    prisma.rts.findMany({ where: { desa_id: desaIdBigInt } }),
    prisma.lpms.findMany({ where: { desa_id: desaIdBigInt } }),
    prisma.karang_tarunas.findMany({ where: { desa_id: desaIdBigInt } }),
    prisma.pkks.findMany({ where: { desa_id: desaIdBigInt } }),
    prisma.posyandus.findMany({ where: { desa_id: desaIdBigInt } }),
    prisma.satlinmas.findMany({ where: { desa_id: desaIdBigInt } }),
    prisma.pengurus.findMany({ where: { desa_id: desaIdBigInt } })
  ]);

  return {
    desa,
    rws,
    rts,
    lpms,
    karang_tarunas: karangTarunas,
    pkks,
    posyandus,
    satlinmas,
    pengurus
  };
}

function buildExistingSummary(existingState) {
  return {
    rws: existingState.rws.length,
    rts: existingState.rts.length,
    lpms: existingState.lpms.length,
    karang_tarunas: existingState.karang_tarunas.length,
    pkks: existingState.pkks.length,
    posyandus: existingState.posyandus.length,
    satlinmas: existingState.satlinmas.length,
    pengurus: existingState.pengurus.length
  };
}

async function executeImport(prismaClient, plan, options, existingState, write) {
  const runtime = {
    write,
    desaId: options.desaId,
    desaIdBigInt: BigInt(options.desaId),
    defaultProdukHukumId: options.defaultProdukHukumId,
    stats: createStats(),
    warnings: detectExistingWarnings(existingState)
  };
  const state = buildMutableState(existingState);

  for (const rwPlan of plan.rwPlans) {
    await syncRwPlan(prismaClient, rwPlan, state, runtime);
  }

  for (const rtPlan of plan.rtPlans) {
    await syncRtPlan(prismaClient, rtPlan, state, runtime);
  }

  for (const singletonPlan of plan.singletonPlans) {
    await syncSingletonPlan(prismaClient, singletonPlan, state, runtime);
  }

  for (const posyanduPlan of plan.posyanduPlans) {
    await syncPosyanduPlan(prismaClient, posyanduPlan, state, runtime);
  }

  for (const pengurusPlan of plan.pengurusPlans) {
    await syncPengurusPlan(prismaClient, pengurusPlan, state, runtime);
  }

  return {
    stats: runtime.stats,
    warnings: runtime.warnings
  };
}

function buildMutableState(existingState) {
  const rwByNumber = new Map();
  const rwIdToNumber = new Map();

  for (const record of existingState.rws) {
    const number = padWilayah(record.nomor);
    rwByNumber.set(number, record);
    rwIdToNumber.set(record.id, number);
  }

  const rtByComposite = new Map();
  for (const record of existingState.rts) {
    const rwNumber = rwIdToNumber.get(record.rw_id) || normalizeKey(record.rw_id);
    const rtKey = `${rwNumber}/${padWilayah(record.nomor)}`;
    rtByComposite.set(rtKey, record);
  }

  const posyanduByKey = new Map();
  for (const record of existingState.posyandus) {
    const key = normalizeKey(record.nama);
    if (!posyanduByKey.has(key)) {
      posyanduByKey.set(key, record);
    }
  }

  const pengurusByKey = new Map();
  for (const record of existingState.pengurus) {
    const key = buildResolvedPengurusKey(
      record.pengurusable_type,
      record.pengurusable_id,
      record.nama_lengkap,
      record.jabatan
    );
    if (!pengurusByKey.has(key)) {
      pengurusByKey.set(key, record);
    }
  }

  return {
    rwByNumber,
    rwIdToNumber,
    rtByComposite,
    singletonRecords: {
      lpms: [...existingState.lpms],
      karang_tarunas: [...existingState.karang_tarunas],
      pkks: [...existingState.pkks],
      satlinmas: [...existingState.satlinmas]
    },
    singletonResolved: new Map(),
    posyanduByKey,
    pengurusByKey
  };
}

function createStats() {
  return {
    rws: createTableStats(),
    rts: createTableStats(),
    lpms: createTableStats(),
    karang_tarunas: createTableStats(),
    pkks: createTableStats(),
    posyandus: createTableStats(),
    satlinmas: createTableStats(),
    pengurus: createTableStats()
  };
}

function createTableStats() {
  return { create: 0, update: 0, noop: 0 };
}

function detectExistingWarnings(existingState) {
  const warnings = [];

  for (const tableName of ['lpms', 'karang_tarunas', 'pkks', 'satlinmas']) {
    if (existingState[tableName].length > 1) {
      warnings.push(`Database memiliki lebih dari satu record di tabel ${tableName} untuk desa ini.`);
    }
  }

  const posyanduCounts = countBy(existingState.posyandus, (item) => normalizeKey(item.nama));
  for (const [key, count] of posyanduCounts.entries()) {
    if (count > 1) {
      warnings.push(`Database memiliki ${count} record posyandu bernama ${key}.`);
    }
  }

  return warnings;
}

async function syncRwPlan(prismaClient, plan, state, runtime) {
  const existing = state.rwByNumber.get(plan.number) || null;
  const createData = {
    id: uuidv4(),
    desa_id: runtime.desaIdBigInt,
    nomor: plan.number,
    alamat: plan.address || '',
    status_kelembagaan: 'aktif',
    status_verifikasi: 'unverified'
  };

  if (runtime.defaultProdukHukumId) {
    createData.produk_hukum_id = runtime.defaultProdukHukumId;
  }

  if (!existing) {
    runtime.stats.rws.create += 1;
    const created = runtime.write
      ? await prismaClient.rws.create({ data: createData })
      : { ...createData, id: `${SIMULATED_PREFIX}RW:${plan.number}` };
    state.rwByNumber.set(plan.number, created);
    state.rwIdToNumber.set(created.id, plan.number);
    return created;
  }

  const updateData = {};
  if (plan.address && !sameText(existing.alamat, plan.address)) {
    updateData.alamat = plan.address;
  }
  if (runtime.defaultProdukHukumId && !sameText(existing.produk_hukum_id, runtime.defaultProdukHukumId)) {
    updateData.produk_hukum_id = runtime.defaultProdukHukumId;
  }

  if (Object.keys(updateData).length === 0) {
    runtime.stats.rws.noop += 1;
    return existing;
  }

  runtime.stats.rws.update += 1;
  const updated = runtime.write
    ? await prismaClient.rws.update({ where: { id: existing.id }, data: updateData })
    : { ...existing, ...updateData };
  state.rwByNumber.set(plan.number, updated);
  state.rwIdToNumber.set(updated.id, plan.number);
  return updated;
}

async function syncRtPlan(prismaClient, plan, state, runtime) {
  const rwRecord = state.rwByNumber.get(plan.rwNumber);
  if (!rwRecord) {
    runtime.warnings.push(`RT ${plan.rwNumber}/${plan.number} dilewati karena parent RW belum tersedia.`);
    return null;
  }

  const compositeKey = `${plan.rwNumber}/${plan.number}`;
  const existing = state.rtByComposite.get(compositeKey) || null;
  const createData = {
    id: uuidv4(),
    rw_id: rwRecord.id,
    desa_id: runtime.desaIdBigInt,
    nomor: plan.number,
    alamat: plan.address || rwRecord.alamat || '',
    status_kelembagaan: 'aktif',
    status_verifikasi: 'unverified'
  };

  if (runtime.defaultProdukHukumId) {
    createData.produk_hukum_id = runtime.defaultProdukHukumId;
  }

  if (!existing) {
    runtime.stats.rts.create += 1;
    const created = runtime.write
      ? await prismaClient.rts.create({ data: createData })
      : { ...createData, id: `${SIMULATED_PREFIX}RT:${compositeKey}` };
    state.rtByComposite.set(compositeKey, created);
    return created;
  }

  const updateData = {};
  if (existing.rw_id !== rwRecord.id) {
    updateData.rw_id = rwRecord.id;
  }
  if (createData.alamat && !sameText(existing.alamat, createData.alamat)) {
    updateData.alamat = createData.alamat;
  }
  if (runtime.defaultProdukHukumId && !sameText(existing.produk_hukum_id, runtime.defaultProdukHukumId)) {
    updateData.produk_hukum_id = runtime.defaultProdukHukumId;
  }

  if (Object.keys(updateData).length === 0) {
    runtime.stats.rts.noop += 1;
    return existing;
  }

  runtime.stats.rts.update += 1;
  const updated = runtime.write
    ? await prismaClient.rts.update({ where: { id: existing.id }, data: updateData })
    : { ...existing, ...updateData };
  state.rtByComposite.set(compositeKey, updated);
  return updated;
}

async function syncSingletonPlan(prismaClient, plan, state, runtime) {
  const existing = pickSingletonRecord(state.singletonRecords[plan.table], plan.name);
  const createData = {
    id: uuidv4(),
    desa_id: runtime.desaIdBigInt,
    nama: plan.name,
    alamat: plan.address || '',
    status_kelembagaan: 'aktif',
    status_verifikasi: 'unverified'
  };

  if (runtime.defaultProdukHukumId) {
    createData.produk_hukum_id = runtime.defaultProdukHukumId;
  }

  if (!existing) {
    runtime.stats[plan.table].create += 1;
    const created = runtime.write
      ? await prismaClient[plan.table].create({ data: createData })
      : { ...createData, id: `${SIMULATED_PREFIX}${plan.table}:${normalizeKey(plan.name)}` };
    state.singletonRecords[plan.table] = [created];
    state.singletonResolved.set(plan.table, created);
    return created;
  }

  const updateData = {};
  if (plan.name && !sameText(existing.nama, plan.name)) {
    updateData.nama = plan.name;
  }
  if (plan.address && !sameText(existing.alamat, plan.address)) {
    updateData.alamat = plan.address;
  }
  if (runtime.defaultProdukHukumId && !sameText(existing.produk_hukum_id, runtime.defaultProdukHukumId)) {
    updateData.produk_hukum_id = runtime.defaultProdukHukumId;
  }

  if (Object.keys(updateData).length === 0) {
    runtime.stats[plan.table].noop += 1;
    state.singletonResolved.set(plan.table, existing);
    return existing;
  }

  runtime.stats[plan.table].update += 1;
  const updated = runtime.write
    ? await prismaClient[plan.table].update({ where: { id: existing.id }, data: updateData })
    : { ...existing, ...updateData };
  state.singletonRecords[plan.table] = [updated];
  state.singletonResolved.set(plan.table, updated);
  return updated;
}

async function syncPosyanduPlan(prismaClient, plan, state, runtime) {
  const existing = state.posyanduByKey.get(plan.key) || null;
  const createData = {
    id: uuidv4(),
    desa_id: runtime.desaIdBigInt,
    nama: plan.name,
    alamat: plan.address || '',
    status_kelembagaan: 'aktif',
    status_verifikasi: 'unverified'
  };

  if (runtime.defaultProdukHukumId) {
    createData.produk_hukum_id = runtime.defaultProdukHukumId;
  }

  if (!existing) {
    runtime.stats.posyandus.create += 1;
    const created = runtime.write
      ? await prismaClient.posyandus.create({ data: createData })
      : { ...createData, id: `${SIMULATED_PREFIX}POSYANDU:${plan.key}` };
    state.posyanduByKey.set(plan.key, created);
    return created;
  }

  const updateData = {};
  if (plan.name && !sameText(existing.nama, plan.name)) {
    updateData.nama = plan.name;
  }
  if (plan.address && !sameText(existing.alamat, plan.address)) {
    updateData.alamat = plan.address;
  }
  if (runtime.defaultProdukHukumId && !sameText(existing.produk_hukum_id, runtime.defaultProdukHukumId)) {
    updateData.produk_hukum_id = runtime.defaultProdukHukumId;
  }

  if (Object.keys(updateData).length === 0) {
    runtime.stats.posyandus.noop += 1;
    return existing;
  }

  runtime.stats.posyandus.update += 1;
  const updated = runtime.write
    ? await prismaClient.posyandus.update({ where: { id: existing.id }, data: updateData })
    : { ...existing, ...updateData };
  state.posyanduByKey.set(plan.key, updated);
  return updated;
}

async function syncPengurusPlan(prismaClient, plan, state, runtime) {
  const parent = resolveParentRecord(plan.parentRef, state);
  if (!parent) {
    runtime.warnings.push(
      `${plan.sourceSheet} row ${plan.sourceRow}: parent pengurus belum tersedia, row dilewati.`
    );
    return null;
  }

  const key = buildResolvedPengurusKey(
    plan.pengurusableType,
    parent.id,
    plan.namaLengkap,
    plan.jabatan
  );
  const existing = state.pengurusByKey.get(key) || null;
  const createData = {
    id: uuidv4(),
    desa_id: runtime.desaIdBigInt,
    pengurusable_type: plan.pengurusableType,
    pengurusable_id: parent.id,
    jabatan: plan.jabatan,
    nama_lengkap: plan.namaLengkap,
    status_jabatan: 'aktif',
    status_verifikasi: 'unverified'
  };

  assignIfPresent(createData, 'nik', plan.nik);
  assignIfPresent(createData, 'tempat_lahir', plan.tempatLahir);
  assignIfPresent(createData, 'tanggal_lahir', plan.tanggalLahir);
  assignIfPresent(createData, 'jenis_kelamin', plan.jenisKelamin);
  assignIfPresent(createData, 'status_perkawinan', plan.statusPerkawinan);
  assignIfPresent(createData, 'alamat', plan.alamat);
  assignIfPresent(createData, 'no_telepon', plan.noTelepon);
  assignIfPresent(createData, 'pendidikan', plan.pendidikan);
  assignIfPresent(createData, 'tanggal_akhir_jabatan', plan.tanggalAkhirJabatan);
  if (runtime.defaultProdukHukumId) {
    createData.produk_hukum_id = runtime.defaultProdukHukumId;
  }

  if (!existing) {
    runtime.stats.pengurus.create += 1;
    const created = runtime.write
      ? await prismaClient.pengurus.create({ data: createData })
      : { ...createData, id: `${SIMULATED_PREFIX}PENGURUS:${key}` };
    state.pengurusByKey.set(key, created);
    return created;
  }

  const updateData = {};
  if (plan.nik && !sameText(existing.nik, plan.nik)) updateData.nik = plan.nik;
  if (plan.tempatLahir && !sameText(existing.tempat_lahir, plan.tempatLahir)) updateData.tempat_lahir = plan.tempatLahir;
  if (plan.tanggalLahir && !sameDate(existing.tanggal_lahir, plan.tanggalLahir)) updateData.tanggal_lahir = plan.tanggalLahir;
  if (plan.jenisKelamin && existing.jenis_kelamin !== plan.jenisKelamin) updateData.jenis_kelamin = plan.jenisKelamin;
  if (plan.statusPerkawinan && !sameText(existing.status_perkawinan, plan.statusPerkawinan)) updateData.status_perkawinan = plan.statusPerkawinan;
  if (plan.alamat && !sameText(existing.alamat, plan.alamat)) updateData.alamat = plan.alamat;
  if (plan.noTelepon && !sameText(existing.no_telepon, plan.noTelepon)) updateData.no_telepon = plan.noTelepon;
  if (plan.pendidikan && !sameText(existing.pendidikan, plan.pendidikan)) updateData.pendidikan = plan.pendidikan;
  if (plan.tanggalAkhirJabatan && !sameDate(existing.tanggal_akhir_jabatan, plan.tanggalAkhirJabatan)) {
    updateData.tanggal_akhir_jabatan = plan.tanggalAkhirJabatan;
  }
  if (runtime.defaultProdukHukumId && !sameText(existing.produk_hukum_id, runtime.defaultProdukHukumId)) {
    updateData.produk_hukum_id = runtime.defaultProdukHukumId;
  }

  if (Object.keys(updateData).length === 0) {
    runtime.stats.pengurus.noop += 1;
    return existing;
  }

  runtime.stats.pengurus.update += 1;
  const updated = runtime.write
    ? await prismaClient.pengurus.update({ where: { id: existing.id }, data: updateData })
    : { ...existing, ...updateData };
  state.pengurusByKey.set(key, updated);
  return updated;
}

function resolveParentRecord(parentRef, state) {
  switch (parentRef.kind) {
    case 'rw':
      return state.rwByNumber.get(parentRef.number) || null;
    case 'rt':
      return state.rtByComposite.get(`${parentRef.rwNumber}/${parentRef.number}`) || null;
    case 'singleton':
      return state.singletonResolved.get(parentRef.table)
        || pickSingletonRecord(state.singletonRecords[parentRef.table], '')
        || null;
    case 'posyandu':
      return state.posyanduByKey.get(parentRef.key) || null;
    default:
      return null;
  }
}

function pickSingletonRecord(records, preferredName) {
  if (!records || records.length === 0) {
    return null;
  }

  return records.find((record) => sameText(record.nama, preferredName)) || records[0];
}

function getSheetRows(workbook, sheetLabel) {
  const normLabel = normalizeKey(sheetLabel);
  const sheetName = workbook.SheetNames.find(
    (name) => {
      const n = normalizeKey(name);
      return n === normLabel || n.includes(normLabel) || (normLabel === 'RTRW' && n.replace(/\s+/g, '').includes('RTRW'));
    }
  );

  if (!sheetName) {
    return [];
  }

  return xlsx.utils.sheet_to_json(workbook.Sheets[sheetName], {
    header: 1,
    raw: true,
    defval: ''
  });
}

function findHeaderRow(rows, predicate) {
  for (let index = 0; index < rows.length; index += 1) {
    const cells = rows[index].map((cell) => normalizeText(cell).toUpperCase());
    if (predicate(cells)) {
      return index;
    }
  }
  return -1;
}

function cellText(row, index) {
  return normalizeText(row[index]);
}

function normalizeText(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function normalizeKey(value) {
  return normalizeText(value).toUpperCase();
}

function firstNonEmpty(values) {
  return values.find((value) => normalizeText(value)) || '';
}

function padWilayah(value) {
  const digits = normalizeText(value).replace(/\D+/g, '');
  if (!digits) {
    return '';
  }
  return digits.padStart(3, '0');
}

function buildAddress(parts) {
  return parts.map(normalizeText).filter(Boolean).join(' ').trim();
}

function parseGender(value) {
  const normalized = normalizeKey(value);
  if (normalized === 'L') return 'Laki_laki';
  if (normalized === 'P') return 'Perempuan';
  return null;
}

function parseWorkbookDate(rawValue) {
  if (rawValue === null || rawValue === undefined || rawValue === '') {
    return null;
  }

  if (rawValue instanceof Date && !Number.isNaN(rawValue.valueOf())) {
    return asDateOnly(rawValue.getUTCFullYear(), rawValue.getUTCMonth() + 1, rawValue.getUTCDate());
  }

  if (typeof rawValue === 'number') {
    return parseExcelSerial(rawValue);
  }

  const normalized = normalizeText(rawValue);
  if (!normalized) {
    return null;
  }

  if (/^\d{4}$/.test(normalized)) {
    return null;
  }

  if (/^\d{4,5}$/.test(normalized)) {
    return parseExcelSerial(Number(normalized));
  }

  const slashMatch = normalized.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (slashMatch) {
    const day = Number(slashMatch[1]);
    const month = Number(slashMatch[2]);
    let year = Number(slashMatch[3]);

    if (year < 100) {
      year += 2000;
    }

    if (isValidDateParts(year, month, day)) {
      return asDateOnly(year, month, day);
    }
    return null;
  }

  const isoCandidate = new Date(normalized);
  if (!Number.isNaN(isoCandidate.valueOf())) {
    return asDateOnly(
      isoCandidate.getUTCFullYear(),
      isoCandidate.getUTCMonth() + 1,
      isoCandidate.getUTCDate()
    );
  }

  return null;
}

function parseExcelSerial(serial) {
  if (!Number.isFinite(serial) || serial < 1) {
    return null;
  }

  const parsed = xlsx.SSF.parse_date_code(serial);
  if (!parsed || !parsed.y || !parsed.m || !parsed.d) {
    return null;
  }

  return asDateOnly(parsed.y, parsed.m, parsed.d);
}

function asDateOnly(year, month, day) {
  if (!isValidDateParts(year, month, day)) {
    return null;
  }
  return new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
}

function isValidDateParts(year, month, day) {
  if (year < 1900 || year > 2100 || month < 1 || month > 12 || day < 1 || day > 31) {
    return false;
  }
  const candidate = new Date(Date.UTC(year, month - 1, day));
  return candidate.getUTCFullYear() === year
    && candidate.getUTCMonth() === month - 1
    && candidate.getUTCDate() === day;
}

function toTitleCase(value) {
  return normalizeText(value)
    .toLowerCase()
    .split(' ')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function sameText(left, right) {
  return normalizeKey(left) === normalizeKey(right);
}

function sameDate(left, right) {
  if (!left && !right) {
    return true;
  }
  if (!left || !right) {
    return false;
  }
  return formatDate(left) === formatDate(right);
}

function formatDate(value) {
  const date = value instanceof Date ? value : new Date(value);
  return date.toISOString().slice(0, 10);
}

function assignIfPresent(target, key, value) {
  if (value !== null && value !== undefined && value !== '') {
    target[key] = value;
  }
}

function groupBy(items, keySelector) {
  const groups = new Map();

  for (const item of items) {
    const key = keySelector(item);
    if (!groups.has(key)) {
      groups.set(key, []);
    }
    groups.get(key).push(item);
  }

  return groups;
}

function countBy(items, keySelector) {
  const counts = new Map();
  for (const item of items) {
    const key = keySelector(item);
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return counts;
}

function buildParentRefKey(parentRef) {
  switch (parentRef.kind) {
    case 'rw':
      return `RW:${parentRef.number}`;
    case 'rt':
      return `RT:${parentRef.rwNumber}/${parentRef.number}`;
    case 'singleton':
      return `SINGLETON:${parentRef.table}`;
    case 'posyandu':
      return `POSYANDU:${parentRef.key}`;
    default:
      return 'UNKNOWN';
  }
}

function buildResolvedPengurusKey(type, parentId, namaLengkap, jabatan) {
  return [type, parentId, normalizeKey(namaLengkap), normalizeKey(jabatan)].join('::');
}

function printPlanReport(report) {
  console.log(`Mode: ${report.mode}`);
  console.log(`Workbook: ${report.workbookPath}`);
  console.log(`Desa target: ${report.metadata.desaId} - ${report.metadata.desaName || '(tidak terbaca)'}`);
  console.log(`Kecamatan: ${report.metadata.kecamatanName || '(tidak terbaca)'}`);
  console.log('');
  console.log('Ringkasan workbook:');
  for (const [sheet, count] of Object.entries(report.planSummary.workbookRows)) {
    console.log(`- ${sheet}: ${count} row valid`);
  }
  console.log('');
  console.log('Rencana entitas:');
  for (const [entity, count] of Object.entries(report.planSummary.entities)) {
    console.log(`- ${entity}: ${count}`);
  }
  printWarnings(report.warnings);
}

function printSyncReport(report) {
  console.log(`Mode: ${report.mode}`);
  console.log(`Workbook: ${report.workbookPath}`);
  console.log(`Desa target: ${report.metadata.desaId} - ${report.metadata.desaName || '(tidak terbaca)'}`);
  console.log(`Kecamatan: ${report.metadata.kecamatanName || '(tidak terbaca)'}`);
  console.log('');
  console.log('Data existing:');
  for (const [entity, count] of Object.entries(report.existing)) {
    console.log(`- ${entity}: ${count}`);
  }
  console.log('');
  console.log('Hasil sinkronisasi:');
  for (const [entity, stats] of Object.entries(report.sync)) {
    console.log(`- ${entity}: create=${stats.create}, update=${stats.update}, noop=${stats.noop}`);
  }
  printWarnings(report.warnings);
}

function printWarnings(warnings) {
  if (!warnings.length) {
    console.log('Warnings: tidak ada');
    return;
  }

  console.log('');
  console.log('Warnings:');
  for (const warning of warnings) {
    console.log(`- ${warning}`);
  }
}

function writeReportIfNeeded(report, reportFile) {
  if (!reportFile) {
    return;
  }

  const outputPath = path.resolve(process.cwd(), reportFile);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify(report, bigintReplacer, 2));
  console.log('');
  console.log(`Report tersimpan di ${outputPath}`);
}

function bigintReplacer(_key, value) {
  if (typeof value === 'bigint') {
    return value.toString();
  }
  if (value instanceof Date) {
    return formatDate(value);
  }
  return value;
}

main().catch((error) => {
  console.error(`Error: ${error.message}`);
  process.exitCode = 1;
});