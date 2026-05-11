#!/usr/bin/env node
/**
 * Wrapper kecil: jalankan import-output-template.js secara batch untuk
 * semua output_template_pengurus_kelembagaan_*.xlsx di folder yang
 * dispesifikasikan, dengan filter range kecamatan opsional.
 *
 * Usage:
 *   node scripts/import-output-template-batch.js \
 *     --dir "../BNBA ONLY/output template kecamatn" \
 *     --start 11 --end 39 \
 *     --mode plan|apply
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

function parseArgs(argv) {
  const opts = { dir: null, start: null, end: null, mode: 'plan', reportDir: null };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    switch (a) {
      case '--dir': opts.dir = argv[++i]; break;
      case '--start': opts.start = Number(argv[++i]); break;
      case '--end': opts.end = Number(argv[++i]); break;
      case '--mode': opts.mode = argv[++i]; break;
      case '--report-dir': opts.reportDir = argv[++i]; break;
      default: throw new Error(`Argumen tidak dikenali: ${a}`);
    }
  }
  if (!opts.dir) throw new Error('--dir wajib diisi.');
  return opts;
}

// Load slug → kecamatan number from BNBA ONLY folder layout.
function buildKecOrderMap(bnbaRoot) {
  const map = new Map();
  if (!fs.existsSync(bnbaRoot)) return map;
  for (const name of fs.readdirSync(bnbaRoot)) {
    const m = name.match(/^(\d+)_KECAMATAN\s+(.+?)-?$/i);
    if (!m) continue;
    const num = Number(m[1]);
    const slug = m[2]
      .replace(/-$/g, '')
      .replace(/[^A-Za-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .toLowerCase();
    map.set(slug, num);
  }
  return map;
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const dir = path.resolve(process.cwd(), opts.dir);
  if (!fs.existsSync(dir)) throw new Error(`Folder tidak ditemukan: ${dir}`);

  const bnbaRoot = path.resolve(dir, '..');
  const kecMap = buildKecOrderMap(bnbaRoot);

  const candidates = fs.readdirSync(dir)
    .filter((n) => n.startsWith('output_template_pengurus_kelembagaan_') && n.endsWith('.xlsx') && !n.includes('_rerun') && !n.includes('_cek_'))
    .map((n) => {
      const slug = n.replace('output_template_pengurus_kelembagaan_', '').replace('.xlsx', '');
      return { file: n, slug, num: kecMap.get(slug) ?? null };
    })
    .filter((it) => {
      if (it.num === null) return false;
      if (opts.start != null && it.num < opts.start) return false;
      if (opts.end != null && it.num > opts.end) return false;
      return true;
    })
    .sort((a, b) => a.num - b.num);

  if (!candidates.length) {
    console.log('Tidak ada workbook yang cocok dengan filter.');
    return;
  }

  console.log(`Akan memproses ${candidates.length} kecamatan:`);
  for (const it of candidates) console.log(`  [${it.num}] ${it.slug}`);
  console.log('');

  const aggregate = { ok: [], failed: [] };

  for (const it of candidates) {
    const wbPath = path.join(dir, it.file);
    const args = [
      'scripts/import-output-template.js',
      '--workbook', wbPath,
      '--mode', opts.mode,
    ];
    if (opts.reportDir) {
      const rdir = path.resolve(process.cwd(), opts.reportDir);
      if (!fs.existsSync(rdir)) fs.mkdirSync(rdir, { recursive: true });
      args.push('--report-file', path.join(rdir, `import-${it.slug}-${opts.mode}.json`));
    }
    console.log(`\n>>> [${it.num}] ${it.slug} (${opts.mode}) ...`);
    const res = spawnSync(process.execPath, args, { stdio: 'inherit' });
    if (res.status === 0) aggregate.ok.push(it.slug);
    else aggregate.failed.push({ slug: it.slug, code: res.status });
  }

  console.log('\n===== SUMMARY BATCH =====');
  console.log(`OK    : ${aggregate.ok.length} (${aggregate.ok.join(', ')})`);
  if (aggregate.failed.length) {
    console.log(`FAIL  : ${aggregate.failed.length}`);
    for (const f of aggregate.failed) console.log(`  ${f.slug} (exit ${f.code})`);
  }
}

main();
