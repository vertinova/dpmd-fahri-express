/**
 * RT/RW Data Analytics Export
 * =====================================================================
 * Membangun file Excel analitik multi-sheet dari hasil persandingan
 * Database <-> ADD <-> BPJS. Logika persandingan diambil langsung dari
 * controller (computeComparison) supaya SELALU sinkron dengan aplikasi.
 *
 * Output ditulis ke root folder DPMD:  RTRW_Analytics_<tanggal>.xlsx
 *
 * Sheet yang dihasilkan:
 *   1. Ringkasan                    - summary + jumlah baris tiap sheet
 *   2. Cocok DB & BPJS              - semua data yang cocok DB <-> BPJS
 *   3. Cocok - NIK Berbeda          - cocok DB<->BPJS tapi NIK beda (fuzzy)
 *   4. Cocok - Desa Berbeda         - anomali BPJS Desa Tangkil (lokasi beda)
 *   5. BPJS Tidak Ada di DB         - BPJS tanpa padanan DB (+ Tangkil unresolved)
 *   6. DB Tidak Ada di BPJS         - data DB tanpa padanan BPJS
 *   7. BPJS Cocok ADD (Tanpa DB)    - BPJS tanpa DB tapi ada referensi ADD
 *
 * Jalankan:  node scripts/generate-rtrw-analytics.js
 * =====================================================================
 */

const path = require('path');
const XLSX = require('xlsx');
const prisma = require('../src/config/prisma');
const { computeComparison } = require('../src/controllers/kelembagaan/rtrwComparison.controller');

const TANGKIL_KODE = '32.01.03.2011';
const OUTPUT_DIR = path.join(__dirname, '..', '..'); // root folder DPMD

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const joinValues = (values) => {
  const filtered = (values || []).map((v) => (v ?? '').toString().trim()).filter(Boolean);
  return filtered.length > 0 ? [...new Set(filtered)].join('; ') : '';
};

const sumValues = (values) => (values || []).reduce((sum, v) => sum + Number(v || 0), 0);

const yesNo = (flag) => (flag ? 'Ya' : 'Tidak');

// Kunci pengurutan berdasarkan kodefikasi desa lalu jenis/RW/RT/nama
const sortKey = (row) => [
  row.__desaKode || '',
  row.__jenis || '',
  row.__rw || '',
  row.__rt || '',
  row.__nama || '',
].join('|');

const sortRows = (rows) => rows.sort((a, b) => sortKey(a).localeCompare(sortKey(b)));

// Buang kolom bantu (__*) sebelum ditulis ke sheet
const stripMeta = (rows) => rows.map((row) => {
  const clean = {};
  Object.keys(row).forEach((k) => {
    if (!k.startsWith('__')) clean[k] = row[k];
  });
  return clean;
});

function appendSheet(wb, name, rows, { autoNumber = true } = {}) {
  const clean = stripMeta(rows);
  const finalRows = autoNumber
    ? clean.map((row, i) => ({ 'NO': i + 1, ...row }))
    : clean;

  const ws = XLSX.utils.json_to_sheet(finalRows.length ? finalRows : [{ 'INFO': 'Tidak ada data' }]);

  if (finalRows.length) {
    const keys = Object.keys(finalRows[0]);
    ws['!cols'] = keys.map((key) => {
      const maxLen = Math.max(key.length, ...finalRows.map((row) => String(row[key] ?? '').length));
      return { wch: Math.min(Math.max(maxLen + 2, 6), 55) };
    });
    ws['!freeze'] = { xSplit: 0, ySplit: 1 };
  }

  // Excel membatasi nama sheet 31 karakter
  XLSX.utils.book_append_sheet(wb, ws, name.slice(0, 31));
  return finalRows.length;
}

// ---------------------------------------------------------------------------
// Row builders per kategori
// ---------------------------------------------------------------------------
function baseLokasi(desa, item) {
  return {
    '__desaKode': desa.desaKode,
    '__jenis': item.jenis || '',
    '__rw': item.rwNomor || '',
    '__rt': item.rtNomor || '',
    '__nama': item.nama || '',
    'KODE DESA': desa.desaKode,
    'DESA': desa.desaNama,
    'KECAMATAN': desa.kecamatanNama,
    'JENIS': item.jenis || '',
    'RW': item.rwNomor || '',
    'RT': item.rtNomor || '',
  };
}

// Sheet: data cocok DB <-> BPJS (semua)
function rowMatchDbBpjs(desa, item) {
  const db = item.dbDetails || [];
  const bpjs = item.bpjsDetails || [];
  return {
    ...baseLokasi(desa, item),
    'NAMA DB': joinValues(db.map((d) => d.namaLengkap || d.nama)) || (item.dbNama || []).join('; '),
    'NIK DB': joinValues(db.map((d) => d.nik)) || (item.dbNik || []).join('; '),
    'TGL LAHIR DB': joinValues(db.map((d) => d.tglLahir)),
    'JABATAN DB': joinValues(db.map((d) => d.jabatan)),
    'NAMA BPJS': joinValues(bpjs.map((d) => d.namaLengkap)) || (item.bpjsNama || []).join('; '),
    'NIK BPJS': joinValues(bpjs.map((d) => d.nik)) || (item.bpjsNik || []).join('; '),
    'TGL LAHIR BPJS': joinValues(bpjs.map((d) => d.tglLahir)),
    'KPJ': joinValues(bpjs.map((d) => d.kpj)),
    'NIK COCOK': yesNo(item.nikMatch),
    'NIK BERBEDA (FUZZY)': yesNo(item.nikMismatch),
    'TGL LAHIR COCOK': yesNo(item.tglLahirMatch),
    'TGL LAHIR BERBEDA': yesNo(item.tglLahirMismatch),
    'DESA BPJS BERBEDA (TANGKIL)': yesNo(item.bpjsTangkilDbConfirmed),
    'KODE DESA BPJS ASAL': item.bpjsOriginalDesaKode
      || joinValues(bpjs.map((d) => d.bpjsOriginalDesaKode || d.originalIdPegawai))
      || (item.bpjsTangkilDbConfirmed ? TANGKIL_KODE : ''),
    'DESA BPJS ASAL': item.bpjsOriginalDesaNama
      || (item.bpjsTangkilDbConfirmed || item.bpjsTangkilSuspect ? 'Tangkil' : ''),
    'ADA DI ADD': yesNo(item.inAdd),
    'NILAI ADD': item.addNilai || 0,
    'UPAH BPJS': sumValues(bpjs.map((d) => d.upah)),
    'NAMA BANK DB': joinValues(db.map((d) => d.namaBank)),
    'NO REKENING DB': joinValues(db.map((d) => d.nomorRekening)),
    'STATUS': item.status,
    'KETERANGAN': item.keterangan || '',
  };
}

// Sheet: BPJS tidak ada di DB (only_bpjs murni)
function rowOnlyBpjs(desa, item) {
  const bpjs = item.bpjsDetails || [];
  return {
    ...baseLokasi(desa, item),
    'NAMA BPJS': joinValues(bpjs.map((d) => d.namaLengkap)) || (item.bpjsNama || []).join('; '),
    'NIK BPJS': joinValues(bpjs.map((d) => d.nik)) || (item.bpjsNik || []).join('; '),
    'TGL LAHIR BPJS': joinValues(bpjs.map((d) => d.tglLahir)),
    'KPJ': joinValues(bpjs.map((d) => d.kpj)),
    'KODE TK': joinValues(bpjs.map((d) => d.kodeTk)),
    'BLTH': joinValues(bpjs.map((d) => d.blth)),
    'UPAH BPJS': sumValues(bpjs.map((d) => d.upah)),
    'ID PEGAWAI ASAL': joinValues(bpjs.map((d) => d.originalIdPegawai || d.idPegawai)),
    'SUMBER': 'BPJS (tanpa DB & ADD)',
    'KANDIDAT DESA': '',
  };
}

// Sheet: BPJS tidak ada di DB - dari pool Tangkil yang tak terselesaikan
function rowTangkilUnresolved(item) {
  const candidates = (item.bpjsCandidates || [])
    .map((c) => `${c.desaNama || c.desaKode}${c.kecamatanNama ? ` (${c.kecamatanNama})` : ''}`)
    .join('; ');
  return {
    '__desaKode': TANGKIL_KODE,
    '__jenis': '',
    '__rw': '',
    '__rt': '',
    '__nama': item.nama || '',
    'KODE DESA': TANGKIL_KODE,
    'DESA': 'Tangkil (asal BPJS)',
    'KECAMATAN': 'Citeureup',
    'JENIS': '',
    'RW': '',
    'RT': '',
    'NAMA BPJS': item.nama || '',
    'NIK BPJS': item.nik || '',
    'TGL LAHIR BPJS': item.tglLahir || '',
    'KPJ': item.kpj || '',
    'KODE TK': '',
    'BLTH': item.blth || '',
    'UPAH BPJS': item.upah || 0,
    'ID PEGAWAI ASAL': TANGKIL_KODE,
    'SUMBER': 'BPJS Tangkil (tak terkonfirmasi walau fuzzy)',
    'KANDIDAT DESA': candidates,
  };
}

// Sheet: DB tidak ada di BPJS (only_db + db_add)
function rowOnlyDb(desa, item) {
  const db = item.dbDetails || [];
  const add = item.addDetails || [];
  return {
    ...baseLokasi(desa, item),
    'NAMA DB': joinValues(db.map((d) => d.namaLengkap || d.nama)) || (item.dbNama || []).join('; '),
    'NIK DB': joinValues(db.map((d) => d.nik)) || (item.dbNik || []).join('; '),
    'TGL LAHIR DB': joinValues(db.map((d) => d.tglLahir)),
    'JABATAN DB': joinValues(db.map((d) => d.jabatan)),
    'NAMA BANK DB': joinValues(db.map((d) => d.namaBank)),
    'NO REKENING DB': joinValues(db.map((d) => d.nomorRekening)),
    'ADA DI ADD': yesNo(item.inAdd),
    'NILAI ADD': item.addNilai || 0,
    'NO REK COCOK ADD': yesNo(item.norekMatch),
    'NO REK BEDA ADD': yesNo(item.norekMismatch),
    'NO BUKTI ADD': joinValues(add.map((d) => d.noBukti)),
    'STATUS': item.status,
    'KETERANGAN': item.keterangan || '',
  };
}

// Sheet: BPJS tanpa DB tapi ada referensi ADD (add_bpjs)
function rowAddBpjs(desa, item) {
  const bpjs = item.bpjsDetails || [];
  const add = item.addDetails || [];
  return {
    ...baseLokasi(desa, item),
    'NAMA BPJS': joinValues(bpjs.map((d) => d.namaLengkap)) || (item.bpjsNama || []).join('; '),
    'NIK BPJS': joinValues(bpjs.map((d) => d.nik)) || (item.bpjsNik || []).join('; '),
    'TGL LAHIR BPJS': joinValues(bpjs.map((d) => d.tglLahir)),
    'KPJ': joinValues(bpjs.map((d) => d.kpj)),
    'UPAH BPJS': sumValues(bpjs.map((d) => d.upah)),
    'NAMA ADD': (item.addNama || []).join('; '),
    'NILAI ADD': item.addNilai || 0,
    'NO BUKTI ADD': joinValues(add.map((d) => d.noBukti)),
    'TGL BUKTI ADD': joinValues(add.map((d) => d.tglBukti)),
    'KETERANGAN ADD': joinValues(add.map((d) => d.keterangan)),
    'REK BANK ADD': joinValues(add.map((d) => d.rekBank)),
    'NAMA COCOK (FUZZY)': yesNo(item.isFuzzy),
    'STATUS': item.status,
    'KETERANGAN': item.keterangan || '',
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  const startedAt = Date.now();
  console.log('⏳ Menghitung persandingan RT/RW (fuzzy ON, dengan detail)...');

  const { summary, comparison, tangkilUnresolved } = await computeComparison({
    enableFuzzy: true,
    includeDetails: true,
  });

  // Urutkan desa berdasarkan kodefikasi desa
  const sortedComparison = [...comparison].sort((a, b) => a.desaKode.localeCompare(b.desaKode));

  const matchDbBpjs = [];   // sheet 2
  const nikBerbeda = [];    // sheet 3
  const desaBerbeda = [];   // sheet 4
  const bpjsNoDb = [];      // sheet 5 (only_bpjs)
  const dbNoBpjs = [];      // sheet 6 (only_db + db_add)
  const bpjsCocokAdd = [];  // sheet 7 (add_bpjs)

  sortedComparison.forEach((desa) => {
    desa.items.forEach((item) => {
      const inDb = item.inDb;
      const inBpjs = item.inBpjs;
      const inAdd = item.inAdd;

      // Cocok DB <-> BPJS (all_three atau db_bpjs)
      if (inDb && inBpjs) {
        matchDbBpjs.push(rowMatchDbBpjs(desa, item));
        if (item.nikMismatch) nikBerbeda.push(rowMatchDbBpjs(desa, item));
        if (item.bpjsTangkilDbConfirmed) desaBerbeda.push(rowMatchDbBpjs(desa, item));
      }

      // BPJS tanpa DB
      if (inBpjs && !inDb) {
        if (inAdd) {
          bpjsCocokAdd.push(rowAddBpjs(desa, item)); // ada referensi ADD -> sheet 7
        } else {
          bpjsNoDb.push(rowOnlyBpjs(desa, item));    // murni BPJS -> sheet 5
        }
      }

      // DB tanpa BPJS
      if (inDb && !inBpjs) {
        dbNoBpjs.push(rowOnlyDb(desa, item));
      }
    });
  });

  // Tambahkan pool Tangkil yang tak terselesaikan ke sheet BPJS tanpa DB
  (tangkilUnresolved || []).forEach((item) => bpjsNoDb.push(rowTangkilUnresolved(item)));

  // Urutkan tiap sheet berdasarkan kodefikasi desa
  [matchDbBpjs, nikBerbeda, desaBerbeda, bpjsNoDb, dbNoBpjs, bpjsCocokAdd].forEach(sortRows);

  // -------------------------------------------------------------------------
  // Build workbook
  // -------------------------------------------------------------------------
  const wb = XLSX.utils.book_new();

  // Sheet 1: Ringkasan (dibangun setelah menghitung jumlah baris tiap sheet)
  const ringkasan = [
    { 'METRIK': 'Tanggal Dibuat', 'NILAI': new Date().toLocaleString('id-ID') },
    { 'METRIK': '', 'NILAI': '' },
    { 'METRIK': '== SUMBER DATA ==', 'NILAI': '' },
    { 'METRIK': 'Total Desa', 'NILAI': summary.totalDesa },
    { 'METRIK': 'Total Pengurus Database (RT/RW)', 'NILAI': summary.totalDbPengurus },
    { 'METRIK': 'Total Penerima ADD', 'NILAI': summary.totalAddPenerima },
    { 'METRIK': 'Total Peserta BPJS', 'NILAI': summary.totalBpjsPenerima },
    { 'METRIK': 'Desa Terdata Database', 'NILAI': summary.totalDbDesa },
    { 'METRIK': 'Desa Terdata ADD', 'NILAI': summary.totalAddDesa },
    { 'METRIK': 'Desa Terdata BPJS', 'NILAI': summary.totalBpjsDesa },
    { 'METRIK': '', 'NILAI': '' },
    { 'METRIK': '== HASIL PERSANDINGAN ==', 'NILAI': '' },
    { 'METRIK': 'Cocok DB + ADD + BPJS (lengkap)', 'NILAI': summary.totalAllThree },
    { 'METRIK': 'Cocok DB + ADD', 'NILAI': summary.totalDbAdd },
    { 'METRIK': 'Cocok DB + BPJS', 'NILAI': summary.totalDbBpjs },
    { 'METRIK': 'Cocok ADD + BPJS', 'NILAI': summary.totalAddBpjs },
    { 'METRIK': 'Hanya Database', 'NILAI': summary.totalOnlyDb },
    { 'METRIK': 'Hanya ADD', 'NILAI': summary.totalOnlyAdd },
    { 'METRIK': 'Hanya BPJS', 'NILAI': summary.totalOnlyBpjs },
    { 'METRIK': 'Cocok via Fuzzy Match', 'NILAI': summary.totalFuzzyMatched },
    { 'METRIK': 'NIK Berbeda (disamakan fuzzy)', 'NILAI': summary.totalNikMismatch },
    { 'METRIK': '', 'NILAI': '' },
    { 'METRIK': '== ANOMALI BPJS DESA TANGKIL ==', 'NILAI': '' },
    { 'METRIK': 'Pool BPJS Tangkil', 'NILAI': summary.totalBpjsTangkilPool },
    { 'METRIK': 'Terkonfirmasi via NIK DB (lokasi beda)', 'NILAI': summary.totalBpjsTangkilConfirmed },
    { 'METRIK': 'Tak terselesaikan (walau fuzzy)', 'NILAI': summary.totalBpjsTangkilUnresolved },
    { 'METRIK': '', 'NILAI': '' },
    { 'METRIK': '== JUMLAH BARIS PER SHEET ==', 'NILAI': '' },
    { 'METRIK': '2. Cocok DB & BPJS', 'NILAI': matchDbBpjs.length },
    { 'METRIK': '3. Cocok - NIK Berbeda', 'NILAI': nikBerbeda.length },
    { 'METRIK': '4. Cocok - Desa Berbeda (Tangkil)', 'NILAI': desaBerbeda.length },
    { 'METRIK': '5. BPJS Tidak Ada di DB', 'NILAI': bpjsNoDb.length },
    { 'METRIK': '6. DB Tidak Ada di BPJS', 'NILAI': dbNoBpjs.length },
    { 'METRIK': '7. BPJS Cocok ADD (Tanpa DB)', 'NILAI': bpjsCocokAdd.length },
  ];
  appendSheet(wb, 'Ringkasan', ringkasan, { autoNumber: false });

  appendSheet(wb, '2. Cocok DB & BPJS', matchDbBpjs);
  appendSheet(wb, '3. Cocok - NIK Berbeda', nikBerbeda);
  appendSheet(wb, '4. Cocok - Desa Berbeda', desaBerbeda);
  appendSheet(wb, '5. BPJS Tidak Ada di DB', bpjsNoDb);
  appendSheet(wb, '6. DB Tidak Ada di BPJS', dbNoBpjs);
  appendSheet(wb, '7. BPJS Cocok ADD Tanpa DB', bpjsCocokAdd);

  const stamp = new Date().toISOString().split('T')[0];
  const filename = `RTRW_Analytics_${stamp}.xlsx`;
  const outPath = path.join(OUTPUT_DIR, filename);
  XLSX.writeFile(wb, outPath);

  console.log('✅ Selesai dalam', Date.now() - startedAt, 'ms');
  console.log('📊 Ringkasan baris:');
  console.log('   Cocok DB & BPJS          :', matchDbBpjs.length);
  console.log('   - NIK Berbeda            :', nikBerbeda.length);
  console.log('   - Desa Berbeda (Tangkil) :', desaBerbeda.length);
  console.log('   BPJS Tidak Ada di DB     :', bpjsNoDb.length, `(termasuk ${(tangkilUnresolved || []).length} Tangkil unresolved)`);
  console.log('   DB Tidak Ada di BPJS     :', dbNoBpjs.length);
  console.log('   BPJS Cocok ADD (Tanpa DB):', bpjsCocokAdd.length);
  console.log('📁 File:', outPath);
}

main()
  .catch((err) => {
    console.error('❌ Gagal membuat analitik:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
    process.exit(process.exitCode || 0);
  });
