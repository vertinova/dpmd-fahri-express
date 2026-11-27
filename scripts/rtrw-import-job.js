/**
 * Job latar untuk fitur import Excel Persandingan RT/RW.
 *
 * Dijalankan sebagai child process oleh rtrwImport.controller.js. Semua kerja
 * berat ada di sini karena XLSX.readFile bersifat sinkron: membaca rtrwadd.xlsx
 * utuh butuh ~19 detik, dan kalau itu dilakukan di dalam request handler
 * seluruh API ikut membeku selama itu.
 *
 * BPJS: file disimpan dulu ke arsip database (per periode BLTH). Cache JSON
 * persandingan hanya diganti bila file memuat periode terbaru di arsip, supaya
 * meng-import bulan lama (backfill) tidak memundurkan persandingan.
 *
 * Mencetak satu objek JSON di baris terakhir stdout:
 *   { ms, summary: { sheetName, totalRows, periode[] }, arsip?, cacheDiperbarui, bpjs?/add?: {...} }
 *
 * Usage: node scripts/rtrw-import-job.js --only=bpjs --file=<xlsx> [--nama-file=..] [--user-id=..] [--user-name=..]
 *        node scripts/rtrw-import-job.js --only=add
 */
const fs = require('fs');
const { regenerate, BPJS_FILE } = require('./generate-rtrw-json-cache');

function argValue(name) {
  const prefix = `--${name}=`;
  const found = process.argv.find((arg) => arg.startsWith(prefix));
  return found ? found.slice(prefix.length) : null;
}

async function importBpjs(startedAt) {
  const arsipSvc = require('../src/services/bpjsArsip.service');
  const file = argValue('file');
  if (!file || !fs.existsSync(file)) throw new Error(`--file tidak ditemukan: ${file}`);

  const arsip = await arsipSvc.simpanExcelBpjs(file, {
    namaFile: argValue('nama-file'),
    userId: argValue('user-id') || null,
    userName: argValue('user-name') || null,
  });
  const terbaru = await arsipSvc.periodeTerbaru();
  const cacheDiperbarui = arsip.periode.some((p) => p.periode === terbaru);

  let result = {};
  if (cacheDiperbarui) {
    fs.copyFileSync(file, BPJS_FILE);
    result = regenerate({ only: 'bpjs' });
  }

  return {
    ...result,
    ms: Date.now() - startedAt,
    summary: { sheetName: arsip.sheetName, totalRows: arsip.totalRows, periode: arsip.periode.map((p) => p.periode) },
    arsip: arsip.periode,
    periodeTerbaru: terbaru,
    cacheDiperbarui,
  };
}

async function main() {
  const only = argValue('only');
  if (!['add', 'bpjs'].includes(only)) {
    console.error(`--only wajib 'add' atau 'bpjs', dapat: ${only}`);
    process.exit(1);
  }

  const startedAt = Date.now();
  let output;
  if (only === 'bpjs') {
    output = await importBpjs(startedAt);
    await require('../src/config/prisma').$disconnect();
  } else {
    const result = regenerate({ only });
    output = {
      ...result,
      ms: Date.now() - startedAt,
      summary: { sheetName: result.add?.sheetName ?? null, totalRows: result.add?.totalRows ?? null, periode: [] },
      cacheDiperbarui: true,
    };
  }

  // Baris terakhir stdout = hasil; log Prisma/logger bisa saja tercetak sebelumnya.
  // exit eksplisit: handle logger/pool yang tersisa tidak boleh menahan job.
  process.stdout.write(`\n${JSON.stringify(output)}\n`, () => process.exit(0));
}

main().catch((error) => {
  console.error(error?.stack || String(error));
  process.exit(1);
});
