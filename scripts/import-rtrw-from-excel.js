/**
 * Import RT/RW data from Excel files in data/datartrw/
 *
 * Supports 2 Excel formats:
 *   Format A: Has KECAMATAN + DESA columns in the data row itself
 *             (CISARUA, KEMANG, TAMANSARI, TENJOLAYA, TAJURHALANG)
 *   Format B: DESA & KECAMATAN read from the address section of the row
 *             (CISEENG, BABAKAN MADANG, CIGOMBONG)
 *
 * Rules applied:
 * - All text → UPPERCASE
 * - L → "Laki-laki", P → "Perempuan" (matches DB enum)
 * - Empty fields → "-" (to avoid null/empty DB errors)
 * - Alamat = jalan/gang + "RT XX" + "RW XX" + DESA + KECAMATAN + KODEPOS
 * - tanggal_akhir_jabatan = masa_bhakti_sampai_dengan (Excel date serial)
 * - tanggal_mulai_jabatan = tanggal_akhir_jabatan - 5 tahun (if not available)
 * - SK pengurus (produk_hukum_id) = null — input manual via sistem
 * - Duplicate check: skip if (NIK + pengurusable_id + pengurusable_type) exists
 *
 * Usage: node scripts/import-rtrw-from-excel.js [--dry-run] [--file=FILENAME.xlsx]
 */

'use strict';

const XLSX   = require('xlsx');
const path   = require('path');
const fs     = require('fs');
const crypto = require('crypto');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient({ log: [] });

const DATA_DIR = path.join(__dirname, '../data/datartrw');
const DRY_RUN  = process.argv.includes('--dry-run');
const FILE_ARG = process.argv.find(a => a.startsWith('--file='));
const ONLY_FILE = FILE_ARG ? FILE_ARG.split('=')[1] : null;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function uuid() {
  return crypto.randomUUID();
}

/** Convert Excel serial date to JS Date. Returns null for non-numeric or "-". */
function excelToDate(val) {
  if (!val || val === '-' || val === '' || val === 0) return null;
  if (typeof val === 'string') {
    // Try direct date strings: "03-03-1966", "14/09/1986", "06/08/1964"
    const cleaned = val.trim();
    if (!cleaned || cleaned === '-') return null;
    // dd-mm-yyyy or dd/mm/yyyy
    const m = cleaned.match(/^(\d{1,2})[-\/](\d{1,2})[-\/](\d{4})$/);
    if (m) return new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
    // yyyy-mm-dd
    const m2 = cleaned.match(/^(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})$/);
    if (m2) return new Date(Number(m2[1]), Number(m2[2]) - 1, Number(m2[3]));
    return null;
  }
  if (typeof val === 'number' && val > 1000) {
    // Excel date serial (Windows epoch: Dec 30, 1899)
    return new Date(Math.round((val - 25569) * 86400 * 1000));
  }
  return null;
}

/** Format JS Date to "YYYY-MM-DD" string for Prisma Date field */
function toDateStr(d) {
  if (!d || !(d instanceof Date) || isNaN(d)) return null;
  return d.toISOString().slice(0, 10);
}

/** Subtract N years from a Date */
function subtractYears(d, n) {
  if (!d) return null;
  const r = new Date(d);
  r.setFullYear(r.getFullYear() - n);
  return r;
}

/** Normalize to UPPERCASE, trimmed. Returns "-" for empty. */
function up(val, fallback = '-') {
  const s = String(val ?? '').trim().toUpperCase();
  return s || fallback;
}

/** Normalize but allow null (for optional nullable fields) */
function upOrNull(val) {
  const s = String(val ?? '').trim().toUpperCase();
  return s || null;
}

/** Parse jenis kelamin: L → "Laki-laki", P → "Perempuan", else null */
function parseGender(lp) {
  const v = String(lp ?? '').trim().toUpperCase();
  if (v === 'L') return 'Laki_laki';   // Prisma enum key
  if (v === 'P') return 'Perempuan';
  return null;
}

/** Build combined address string */
function buildAlamat(jalan, rtNo, rwNo, desa, kecamatan, kodepos) {
  const pad = (n) => n ? `0${String(n).replace(/^0+/, '')}`.slice(-3) : null;
  const parts = [
    up(jalan, null),
    rtNo ? `RT ${pad(rtNo)}` : null,
    rwNo ? `RW ${pad(rwNo)}` : null,
    up(desa, null),
    up(kecamatan, null),
    kodepos ? String(kodepos).trim() : null,
  ].filter(Boolean);
  return parts.length ? parts.join(', ') : '-';
}

/** Normalize desa/kecamatan name for lookup */
function normName(s) {
  return String(s ?? '').trim().toUpperCase().replace(/\s+/g, ' ');
}

/** Normalize RW/RT nomor: strip leading zeros → numeric string like "001" → "1", or keep if alpha */
function normalizeNomor(val) {
  const s = String(val ?? '').trim().replace(/^0+/, '') || '0';
  return s === '0' ? null : s;
}

// ─── Format Detection ─────────────────────────────────────────────────────────

/**
 * Find header rows (rows where col[0] === "NO"), then the first data row.
 * Returns { headerRowIndices, dataStartIdx, mergedHeaders, isFormatA }
 */
function analyzeSheet(rows) {
  const headerRowIndices = [];
  let dataStartIdx = -1;

  for (let i = 0; i < rows.length; i++) {
    const cell0 = String(rows[i][0] ?? '').toUpperCase().trim();
    if (cell0 === 'NO') {
      headerRowIndices.push(i);
    } else if (headerRowIndices.length > 0) {
      const v = rows[i][0];
      if (typeof v === 'number' && v >= 1) {
        dataStartIdx = i;
        break;
      }
    }
  }

  if (!headerRowIndices.length || dataStartIdx === -1) return null;

  const mainHeaderRow = rows[headerRowIndices[0]];
  const colCount = Math.max(...rows.slice(dataStartIdx, dataStartIdx + 5).map(r => r.length));

  // Build merged headers (combine all header rows for each column)
  const mergedHeaders = [];
  for (let c = 0; c < colCount; c++) {
    const parts = headerRowIndices
      .map(ri => String(rows[ri][c] ?? '').trim())
      .filter(s => s !== '');
    mergedHeaders.push(parts.join('|').toLowerCase());
  }

  // Format A: col[1] of header is "KECAMATAN"
  const isFormatA = String(mainHeaderRow[1] ?? '').toUpperCase().trim() === 'KECAMATAN'
    || String(mainHeaderRow[1] ?? '').toLowerCase().trim() === 'kecamatan';

  // Find BANK column (scan from right of headers)
  let bankCol = -1;
  for (let c = mergedHeaders.length - 1; c >= 0; c--) {
    if (mergedHeaders[c].includes('bank')) { bankCol = c; break; }
  }

  return { headerRowIndices, dataStartIdx, mergedHeaders, isFormatA, bankCol };
}

// ─── Row Parsers ──────────────────────────────────────────────────────────────

/**
 * Format A columns (has kecamatan col):
 * 0=NO, 1=KECAMATAN, 2=DESA, 3=NAMA, 4=NIK, 5=L/P,
 * 6=TEMPAT_LAHIR, 7=TGL_LAHIR, 8=JABATAN, 9=RW#, 10=RT#,
 * 11=SK(skip), 12=MASA_BHAKTI,
 * 13=JALAN, 14=RT_ALAMAT, 15=RW_ALAMAT, 16=DESA_ALAMAT,
 * 17=KEC_ALAMAT, 18=KODEPOS, 19=PENDIDIKAN, 20=STATUS_KAWIN,
 * 21=NO_HP, 22=BANK, 23=NO_REK, 24=NAMA_REK
 */
function parseFormatA(row, bankCol) {
  const jabatan   = String(row[8]  ?? '').trim().toUpperCase();
  const rwColVal  = String(row[9]  ?? '').trim();
  const rtColVal  = String(row[10] ?? '').trim();

  // Determine RW/RT numbers
  // CISARUA anomaly: Ketua RW has RW# in col[10] instead of col[9]
  // KEMANG correct: Ketua RW has RW# in col[9], col[10] empty
  let rwNomor, rtNomor, kelembagaanType;
  if (jabatan.includes('RW') && !jabatan.includes('RT')) {
    // Ketua RW: take whichever is non-empty
    rwNomor = normalizeNomor(rwColVal || rtColVal);
    rtNomor = null;
    kelembagaanType = 'rws';
  } else {
    // Ketua RT: col[9]=parent RW, col[10]=RT number
    rwNomor = normalizeNomor(rwColVal);
    rtNomor = normalizeNomor(rtColVal);
    kelembagaanType = rtNomor ? 'rts' : 'rws';
  }

  const bk = bankCol > 0 ? bankCol : 22;

  return {
    kecamatanNama : normName(row[1]),
    desaNama      : normName(row[2]),
    nama          : up(row[3]),
    nik           : up(row[4]),
    jenisKelamin  : parseGender(row[5]),
    tempatLahir   : up(row[6]),
    tanggalLahir  : excelToDate(row[7]),
    jabatan,
    rwNomor,
    rtNomor,
    masaBhakti    : excelToDate(row[12]),
    jalan         : String(row[13] ?? '').trim(),
    rtAlamat      : String(row[14] ?? '').trim(),
    rwAlamat      : String(row[15] ?? '').trim(),
    desaAlamat    : String(row[16] ?? '').trim(),
    kecAlamat     : String(row[17] ?? '').trim(),
    kodepos       : String(row[18] ?? '').trim(),
    pendidikan    : upOrNull(row[19]),
    statusKawin   : upOrNull(row[20]),
    noTelepon     : upOrNull(row[21]),
    namaBank      : upOrNull(row[bk]),
    nomorRekening : upOrNull(row[bk + 1]),
    namaRekening  : upOrNull(row[bk + 2]),
    kelembagaanType,
  };
}

/**
 * Format B columns (no kecamatan col, uses address section for desa/kec):
 * 0=NO, 1=NAMA, 2=NIK, 3=L/P, 4=TEMPAT_LAHIR, 5=TGL_LAHIR,
 * 6=JABATAN, 7=RW#, 8=RT#, 9=SK(skip), 10=MASA_BHAKTI,
 * 11=JALAN, 12=RT_ALAMAT, 13=RW_ALAMAT, 14=DESA, 15=KECAMATAN,
 * 16=KODEPOS, 17=PENDIDIKAN, 18=STATUS_KAWIN, 19=NO_HP (maybe 20 too),
 * BANK/NO_REK/NAMA_REK = last 3 meaningful cols
 */
function parseFormatB(row, bankCol) {
  const jabatan  = String(row[6] ?? '').trim().toUpperCase();
  const rwColVal = String(row[7] ?? '').trim();
  const rtColVal = String(row[8] ?? '').trim();

  let rwNomor, rtNomor, kelembagaanType;
  if (jabatan.includes('RW') && !jabatan.includes('RT')) {
    rwNomor = normalizeNomor(rwColVal || rtColVal);
    rtNomor = null;
    kelembagaanType = 'rws';
  } else {
    rwNomor = normalizeNomor(rwColVal);
    rtNomor = normalizeNomor(rtColVal);
    kelembagaanType = rtNomor ? 'rts' : 'rws';
  }

  const bk = bankCol > 0 ? bankCol : 21;

  return {
    kecamatanNama : normName(row[15]),
    desaNama      : normName(row[14]),
    nama          : up(row[1]),
    nik           : up(row[2]),
    jenisKelamin  : parseGender(row[3]),
    tempatLahir   : up(row[4]),
    tanggalLahir  : excelToDate(row[5]),
    jabatan,
    rwNomor,
    rtNomor,
    masaBhakti    : excelToDate(row[10]),
    jalan         : String(row[11] ?? '').trim(),
    rtAlamat      : String(row[12] ?? '').trim(),
    rwAlamat      : String(row[13] ?? '').trim(),
    desaAlamat    : String(row[14] ?? '').trim(),
    kecAlamat     : String(row[15] ?? '').trim(),
    kodepos       : String(row[16] ?? '').trim(),
    pendidikan    : upOrNull(row[17]),
    statusKawin   : upOrNull(row[18]),
    noTelepon     : upOrNull(row[19]),
    namaBank      : upOrNull(row[bk]),
    nomorRekening : upOrNull(row[bk + 1]),
    namaRekening  : upOrNull(row[bk + 2]),
    kelembagaanType,
  };
}

/** Read one Excel file and return array of parsed records */
function readExcelFile(filepath) {
  const wb   = XLSX.readFile(filepath);
  const ws   = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

  const info = analyzeSheet(rows);
  if (!info) {
    console.warn(`  ⚠️  Could not find header/data rows in: ${path.basename(filepath)}`);
    return [];
  }

  const { dataStartIdx, isFormatA, bankCol } = info;
  const records = [];

  for (let i = dataStartIdx; i < rows.length; i++) {
    const row = rows[i];
    // Skip completely empty rows
    if (!row || !row.some(c => c !== '')) continue;
    // Skip rows where col[0] is not a positive number
    const rowNo = row[0];
    if (typeof rowNo !== 'number' || rowNo < 1) continue;

    const rec = isFormatA
      ? parseFormatA(row, bankCol)
      : parseFormatB(row, bankCol);

    if (!rec) continue;

    // Validate minimum required fields
    if (!rec.nama || rec.nama === '-') continue;
    if (!rec.jabatan) continue;
    if (!rec.rwNomor) {
      console.warn(`  ⚠️  Row ${rowNo}: no RW number found for "${rec.nama}" (${rec.jabatan}), skipping`);
      continue;
    }

    records.push(rec);
  }

  return records;
}

// ─── Database Helpers ─────────────────────────────────────────────────────────

/** Build a lookup map: "DESANAMA|KECAMATANNAMA" → desa_id */
async function buildDesaLookup() {
  const desas = await prisma.desas.findMany({
    select: {
      id: true,
      nama: true,
      kecamatans: { select: { nama: true } },
    },
  });
  const map = new Map();
  for (const d of desas) {
    const kecNama = normName(d.kecamatans?.nama ?? '');
    const desaNama = normName(d.nama);
    const key = `${desaNama}|${kecNama}`;
    map.set(key, d.id);
  }
  return map;
}

/** Cache: "desaId|rwNomor" → rwId */
const rwCache = new Map();

async function getOrCreateRW(desaId, rwNomor) {
  const cacheKey = `${desaId}|${rwNomor}`;
  if (rwCache.has(cacheKey)) return rwCache.get(cacheKey);

  const existing = await prisma.rws.findFirst({
    where: { desa_id: desaId, nomor: rwNomor },
    select: { id: true },
  });

  if (existing) {
    rwCache.set(cacheKey, existing.id);
    return existing.id;
  }

  if (DRY_RUN) {
    const fakeId = `dry-rw-${cacheKey}`;
    rwCache.set(cacheKey, fakeId);
    return fakeId;
  }

  const newId = uuid();
  await prisma.rws.create({
    data: {
      id                : newId,
      desa_id           : desaId,
      nomor             : rwNomor,
      alamat            : null,
      status_kelembagaan: 'aktif',
      status_verifikasi : 'unverified',
      created_at        : new Date(),
      updated_at        : new Date(),
    },
  });
  rwCache.set(cacheKey, newId);
  return newId;
}

/** Cache: "rwId|rtNomor" → rtId */
const rtCache = new Map();

async function getOrCreateRT(desaId, rwId, rtNomor) {
  const cacheKey = `${rwId}|${rtNomor}`;
  if (rtCache.has(cacheKey)) return rtCache.get(cacheKey);

  const existing = await prisma.rts.findFirst({
    where: { rw_id: rwId, nomor: rtNomor },
    select: { id: true },
  });

  if (existing) {
    rtCache.set(cacheKey, existing.id);
    return existing.id;
  }

  if (DRY_RUN) {
    const fakeId = `dry-rt-${cacheKey}`;
    rtCache.set(cacheKey, fakeId);
    return fakeId;
  }

  const newId = uuid();
  await prisma.rts.create({
    data: {
      id                : newId,
      rw_id             : rwId,
      desa_id           : desaId,
      nomor             : rtNomor,
      alamat            : null,
      status_kelembagaan: 'aktif',
      status_verifikasi : 'unverified',
      created_at        : new Date(),
      updated_at        : new Date(),
    },
  });
  rtCache.set(cacheKey, newId);
  return newId;
}

/** Check if pengurus already exists (by NIK + pengurusable). Returns boolean. */
async function pengurusExists(nik, pengurusableId, pengurusableType) {
  if (nik === '-' || !nik) return false;
  const found = await prisma.pengurus.findFirst({
    where: {
      nik,
      pengurusable_id  : pengurusableId,
      pengurusable_type: pengurusableType,
    },
    select: { id: true },
  });
  return !!found;
}

// ─── Main Import Logic ────────────────────────────────────────────────────────

async function main() {
  console.log(`\n🚀 Import RT/RW from Excel${DRY_RUN ? ' [DRY RUN]' : ''}`);
  console.log('─'.repeat(60));

  // 1. Build desa lookup
  console.log('⏳ Loading desa lookup from database…');
  const desaMap = await buildDesaLookup();
  console.log(`✅ Loaded ${desaMap.size} desa records\n`);

  // 2. Find Excel files
  const allFiles = fs.readdirSync(DATA_DIR).filter(f => f.endsWith('.xlsx'));
  const files = ONLY_FILE ? allFiles.filter(f => f === ONLY_FILE) : allFiles;

  if (!files.length) {
    console.error(`❌ No Excel files found in ${DATA_DIR}`);
    process.exit(1);
  }

  const stats = {
    files      : 0,
    records    : 0,
    rwCreated  : 0,
    rtCreated  : 0,
    pengCreated: 0,
    pengSkipped: 0,
    notFound   : 0,
    errors     : 0,
  };

  // 3. Process each file
  for (const filename of files) {
    const filepath = path.join(DATA_DIR, filename);
    console.log(`📄 ${filename}`);
    stats.files++;

    let records;
    try {
      records = readExcelFile(filepath);
    } catch (e) {
      console.error(`  ❌ Failed to read file: ${e.message}`);
      stats.errors++;
      continue;
    }

    console.log(`  → ${records.length} rows parsed`);

    for (const rec of records) {
      stats.records++;

      // 4a. Find desa_id
      const desaKey = `${normName(rec.desaNama)}|${normName(rec.kecamatanNama)}`;
      let desaId = desaMap.get(desaKey);

      if (!desaId) {
        // Try matching desa only (in case kecamatan name differs slightly)
        for (const [k, v] of desaMap) {
          if (k.startsWith(`${normName(rec.desaNama)}|`)) {
            desaId = v;
            break;
          }
        }
      }

      if (!desaId) {
        console.warn(`  ⚠️  Desa not found: "${rec.desaNama}" / "${rec.kecamatanNama}" — skipping "${rec.nama}"`);
        stats.notFound++;
        continue;
      }

      try {
        // 4b. Get or create RW
        const prevRwCount = rwCache.size;
        const rwId = await getOrCreateRW(desaId, rec.rwNomor);
        if (rwCache.size > prevRwCount && !DRY_RUN) stats.rwCreated++;

        // 4c. Get or create RT (if this is an RT-level position)
        let pengurusableId   = rwId;
        let pengurusableType = 'rws';

        if (rec.kelembagaanType === 'rts' && rec.rtNomor) {
          const prevRtCount = rtCache.size;
          const rtId = await getOrCreateRT(desaId, rwId, rec.rtNomor);
          if (rtCache.size > prevRtCount && !DRY_RUN) stats.rtCreated++;
          pengurusableId   = rtId;
          pengurusableType = 'rts';
        }

        // 4d. Duplicate check
        const nik = rec.nik === '-' ? null : rec.nik;
        if (nik && await pengurusExists(nik, pengurusableId, pengurusableType)) {
          stats.pengSkipped++;
          continue;
        }

        // 4e. Compute dates
        const tanggalAkhir = rec.masaBhakti;
        const tanggalMulai = tanggalAkhir ? subtractYears(tanggalAkhir, 5) : null;

        // 4f. Build alamat
        const alamat = buildAlamat(
          rec.jalan,
          rec.rtAlamat || rec.rtNomor,
          rec.rwAlamat || rec.rwNomor,
          rec.desaAlamat || rec.desaNama,
          rec.kecAlamat  || rec.kecamatanNama,
          rec.kodepos,
        );

        if (DRY_RUN) {
          console.log(`  [DRY] Would create pengurus: ${rec.nama} (${rec.jabatan}) → ${pengurusableType} ${pengurusableId}`);
          stats.pengCreated++;
          continue;
        }

        // 4g. Insert pengurus
        await prisma.$executeRaw`
          INSERT INTO pengurus (
            id, desa_id, pengurusable_id, pengurusable_type,
            jabatan, tanggal_mulai_jabatan, tanggal_akhir_jabatan,
            status_jabatan, status_verifikasi, produk_hukum_id,
            nama_lengkap, nik, tempat_lahir, tanggal_lahir, jenis_kelamin,
            status_perkawinan, alamat, no_telepon,
            nama_bank, nomor_rekening, nama_rekening,
            pendidikan, created_at, updated_at
          ) VALUES (
            ${uuid()},
            ${desaId},
            ${pengurusableId},
            ${pengurusableType},
            ${rec.jabatan},
            ${toDateStr(tanggalMulai)},
            ${toDateStr(tanggalAkhir)},
            'aktif',
            'unverified',
            NULL,
            ${rec.nama},
            ${nik ?? '-'},
            ${rec.tempatLahir},
            ${toDateStr(rec.tanggalLahir)},
            ${rec.jenisKelamin},
            ${rec.statusKawin ?? '-'},
            ${alamat},
            ${rec.noTelepon},
            ${rec.namaBank},
            ${rec.nomorRekening},
            ${rec.namaRekening},
            ${rec.pendidikan},
            NOW(),
            NOW()
          )
        `;

        stats.pengCreated++;
      } catch (e) {
        console.error(`  ❌ Error processing "${rec.nama}": ${e.message}`);
        stats.errors++;
      }
    }
  }

  // 5. Summary
  console.log('\n' + '═'.repeat(60));
  console.log('📊 Import Summary');
  console.log('─'.repeat(60));
  console.log(`  Files processed  : ${stats.files}`);
  console.log(`  Rows parsed      : ${stats.records}`);
  console.log(`  RW created       : ${stats.rwCreated}`);
  console.log(`  RT created       : ${stats.rtCreated}`);
  console.log(`  Pengurus created : ${stats.pengCreated}`);
  console.log(`  Pengurus skipped : ${stats.pengSkipped} (duplicate)`);
  console.log(`  Desa not found   : ${stats.notFound}`);
  console.log(`  Errors           : ${stats.errors}`);
  if (DRY_RUN) console.log('\n  ⚠️  DRY RUN — no data was written to database');
  console.log('═'.repeat(60) + '\n');
}

main()
  .catch(e => { console.error('Fatal:', e); process.exit(1); })
  .finally(() => prisma.$disconnect());
