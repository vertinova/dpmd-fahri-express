/**
 * Job latar untuk fitur import Excel Persandingan RT/RW.
 *
 * Dijalankan sebagai child process oleh rtrwImport.controller.js. Semua kerja
 * berat ada di sini karena XLSX.readFile bersifat sinkron: membaca rtrwadd.xlsx
 * utuh butuh ~19 detik, dan kalau itu dilakukan di dalam request handler
 * seluruh API ikut membeku selama itu.
 *
 * Mencetak satu objek JSON ke stdout:
 *   { ms, summary: { sheetName, totalRows, periode[] }, bpjs?/add?: {...} }
 *
 * Usage: node scripts/rtrw-import-job.js --only=bpjs [--periode-column=BLTH]
 */
const XLSX = require('xlsx');
const { regenerate, ADD_FILE, BPJS_FILE } = require('./generate-rtrw-json-cache');

const SHEET_CANDIDATES = {
  bpjs: ['DATABASE', 'data_upah'],
  add: ['Sheet2'],
};

function argValue(name) {
  const prefix = `--${name}=`;
  const found = process.argv.find((arg) => arg.startsWith(prefix));
  return found ? found.slice(prefix.length) : null;
}

/**
 * Kumpulkan daftar periode (kolom BLTH) dari file sumber.
 *
 * Hanya dijalankan bila sumbernya punya kolom periode — praktisnya hanya BPJS
 * (~2 dtk). Untuk ADD ini dilewati: file 16MB-nya butuh ~19 dtk untuk dibaca
 * dan `regenerate` sudah membacanya sendiri, jadi menjalankan keduanya berarti
 * mem-parse file yang sama dua kali.
 */
function collectPeriode(filePath, candidates, periodeColumn) {
  const workbook = XLSX.readFile(filePath);
  const sheetName = candidates.find((name) => workbook.Sheets[name]) || workbook.SheetNames[0];
  const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { defval: '' });
  const periode = new Set();

  rows.forEach((row) => {
    const value = String(row[periodeColumn] ?? '').trim();
    if (value) periode.add(value);
  });

  return { sheetName, totalRows: rows.length, periode: [...periode].slice(0, 12) };
}

function main() {
  const only = argValue('only');
  if (!['add', 'bpjs'].includes(only)) {
    console.error(`--only wajib 'add' atau 'bpjs', dapat: ${only}`);
    process.exit(1);
  }

  const startedAt = Date.now();
  const periodeColumn = argValue('periode-column');
  const sourceFile = only === 'bpjs' ? BPJS_FILE : ADD_FILE;
  const summary = periodeColumn
    ? collectPeriode(sourceFile, SHEET_CANDIDATES[only], periodeColumn)
    : { sheetName: null, totalRows: null, periode: [] };

  const result = regenerate({ only });

  // Jumlah baris diambil dari generator kalau summarize dilewati.
  if (summary.totalRows === null) {
    summary.totalRows = result[only]?.totalRows ?? null;
    summary.sheetName = result[only]?.sheetName ?? null;
  }

  console.log(JSON.stringify({ ...result, ms: Date.now() - startedAt, summary }));
}

main();
