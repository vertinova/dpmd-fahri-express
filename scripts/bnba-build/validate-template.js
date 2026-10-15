#!/usr/bin/env node
/**
 * Periksa output template sebelum diunggah, memakai aturan baca yang sama dengan
 * importer (importPengurus di pengurus.controller.js): sheet mana yang dibaca,
 * kolom mana yang dipakai, dan baris mana yang akan dilewati importer.
 *
 *   node scripts/bnba-build/validate-template.js <file.xlsx> [...]
 *
 * Keluar dengan status 1 bila ada baris yang pasti ditolak importer.
 */

const fs = require('fs');
const path = require('path');
const xlsx = require('xlsx');

const { loadReference } = require('./desa-reference');

// Disalin dari importer supaya validator ikut berubah kalau perilaku importer diuji ulang.
const DATA_SHEETS = ['01_RTRW', '02_POSYANDU', '03_LPM', '04_KARANG_TARUNA', '05_PKK', '06_LINMAS', '07_LEMBAGA_LAINNYA'];
const LEMBAGA_NAME_FIELD = {
  '02_POSYANDU': 'nama_posyandu',
  '03_LPM': 'nama_lembaga',
  '04_KARANG_TARUNA': 'nama_lembaga',
  '05_PKK': 'nama_lembaga',
  '06_LINMAS': 'nama_lembaga',
  '07_LEMBAGA_LAINNYA': 'nama_lembaga',
};
// Sheet yang importer isi otomatis namanya bila dikosongkan.
const AUTO_NAMED = new Set(['03_LPM', '04_KARANG_TARUNA', '05_PKK', '06_LINMAS']);

function textVal(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  return String(v).trim();
}

function padNomor(v) {
  const d = textVal(v).replace(/\D+/g, '');
  return d ? d.padStart(3, '0').slice(-3) : '';
}

function parseDateImport(v) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number' && Number.isFinite(v)) return new Date(Date.UTC(1899, 11, 30) + Math.round(v * 86400000));
  const t = String(v).trim();
  if (!t) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) { const d = new Date(`${t}T00:00:00Z`); return Number.isNaN(d.getTime()) ? null : d; }
  const d = new Date(t);
  return Number.isNaN(d.getTime()) ? null : d;
}

function collectRows(workbook) {
  const rows = [];
  for (const sheetName of DATA_SHEETS) {
    if (!workbook.SheetNames.includes(sheetName)) continue;
    const data = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName], {
      header: 1, raw: true, defval: null, blankrows: false,
    });
    if (!data.length) continue;
    const headers = data[0].map((h) => (h == null ? '' : String(h).trim()));
    for (let i = 1; i < data.length; i += 1) {
      const row = data[i];
      if (!row || !row.some((c) => c !== null && c !== '')) continue;
      const obj = { sheet: sheetName, rowIndex: i + 1 };
      headers.forEach((h, idx) => { if (h) obj[h] = row[idx]; });
      if (!textVal(obj.nama_lengkap)) continue;
      rows.push(obj);
    }
  }
  return rows;
}

function validateFile(filePath, reference) {
  const wb = xlsx.readFile(filePath, { raw: true, cellDates: false });
  const kodeSet = new Set(reference.desas.map((d) => d.kode));

  const problems = [];
  const warnings = [];
  const perSheet = {};
  const rows = collectRows(wb);

  const missingSheets = DATA_SHEETS.filter((s) => !wb.SheetNames.includes(s));

  for (const row of rows) {
    perSheet[row.sheet] = (perSheet[row.sheet] || 0) + 1;
    const where = `${row.sheet} baris ${row.rowIndex}`;
    const nama = textVal(row.nama_lengkap);

    const kode = textVal(row.kode_desa);
    if (!kode) problems.push(`${where}: kode_desa kosong (${nama})`);
    else if (!kodeSet.has(kode)) problems.push(`${where}: kode_desa '${kode}' tidak ada di referensi (${nama})`);

    if (!textVal(row.jabatan)) problems.push(`${where}: jabatan kosong (${nama}) — importer akan melewati baris ini`);

    if (row.sheet === '01_RTRW') {
      const jenis = textVal(row.jenis_wilayah).toUpperCase();
      if (jenis !== 'RW' && jenis !== 'RT') problems.push(`${where}: jenis_wilayah '${jenis}' harus RW atau RT (${nama})`);
      if (!padNomor(row.nomor_rw)) problems.push(`${where}: nomor_rw kosong (${nama})`);
      if (jenis === 'RT' && !padNomor(row.nomor_rt)) problems.push(`${where}: nomor_rt kosong untuk jenis RT (${nama})`);
    } else {
      const field = LEMBAGA_NAME_FIELD[row.sheet];
      if (field && !textVal(row[field]) && !AUTO_NAMED.has(row.sheet)) {
        problems.push(`${where}: ${field} kosong (${nama})`);
      }
    }

    for (const f of ['tanggal_lahir', 'tanggal_mulai_jabatan', 'tanggal_akhir_jabatan']) {
      const v = row[f];
      if (v !== null && v !== undefined && v !== '' && !parseDateImport(v)) {
        problems.push(`${where}: ${f} '${v}' tidak bisa dibaca importer (${nama})`);
      }
    }

    const nik = textVal(row.nik);
    if (nik && !/^\d{16}$/.test(nik)) warnings.push(`${where}: NIK '${nik}' bukan 16 digit (${nama})`);

    const jk = textVal(row.jenis_kelamin).toUpperCase();
    if (jk && !/^[LP]/.test(jk)) warnings.push(`${where}: jenis_kelamin '${jk}' akan dibaca kosong (${nama})`);

    const sj = textVal(row.status_jabatan).toLowerCase();
    if (sj && !['aktif', 'selesai'].includes(sj)) warnings.push(`${where}: status_jabatan '${sj}' akan jatuh ke 'aktif' (${nama})`);
  }

  return { filePath, total: rows.length, perSheet, missingSheets, problems, warnings };
}

function main() {
  const files = process.argv.slice(2);
  if (files.length === 0) {
    console.log('Penggunaan: node scripts/bnba-build/validate-template.js <file.xlsx> [...]');
    process.exitCode = 1;
    return;
  }

  const reference = loadReference();
  let bad = 0;

  for (const f of files) {
    const filePath = path.resolve(process.cwd(), f);
    if (!fs.existsSync(filePath)) {
      console.error(`GAGAL  ${f}: file tidak ditemukan`);
      bad += 1;
      continue;
    }
    const r = validateFile(filePath, reference);
    console.log(`\n=== ${path.basename(filePath)}`);
    console.log(`    Baris terbaca importer: ${r.total}`);
    for (const [s, n] of Object.entries(r.perSheet)) console.log(`      ${s.padEnd(22)}: ${n}`);
    if (r.missingSheets.length) console.log(`    Sheet tidak ada (dilewati importer): ${r.missingSheets.join(', ')}`);
    if (r.warnings.length) {
      console.log(`    Peringatan: ${r.warnings.length}`);
      r.warnings.slice(0, 10).forEach((w) => console.log(`      - ${w}`));
      if (r.warnings.length > 10) console.log(`      ... dan ${r.warnings.length - 10} lainnya`);
    }
    if (r.problems.length) {
      bad += 1;
      console.log(`    MASALAH: ${r.problems.length}`);
      r.problems.slice(0, 20).forEach((p) => console.log(`      - ${p}`));
      if (r.problems.length > 20) console.log(`      ... dan ${r.problems.length - 20} lainnya`);
    } else {
      console.log('    OK — semua baris memenuhi syarat importer.');
    }
  }

  if (bad > 0) process.exitCode = 1;
}

if (require.main === module) main();

module.exports = { validateFile };
