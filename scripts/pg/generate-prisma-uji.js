#!/usr/bin/env node
// Hanya untuk uji lokal: membangkitkan client ke <tujuan>/client tanpa menyentuh client di node_modules.
//   node scripts/pg/generate-prisma-uji.js <folderTujuan>
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const tujuan = process.argv[2];
if (!tujuan) { console.error('pakai: generate-prisma-uji.js <folderTujuan>'); process.exit(2); }
const ROOT = path.resolve(__dirname, '..', '..');
const dest = path.resolve(tujuan);
fs.mkdirSync(dest, { recursive: true });
const skema = fs.readFileSync(path.join(ROOT, 'prisma', 'schema.prisma'), 'utf8')
  .replace(/(generator client \{[^}]*?)\n\}/, `$1\n  output = ${JSON.stringify(path.join(dest, 'client').split(path.sep).join('/'))}\n}`);
if (!skema.includes('output =')) { console.error('blok generator tidak ditemukan'); process.exit(1); }
const f = path.join(dest, 'schema.prisma');
fs.writeFileSync(f, skema);
const r = spawnSync(process.execPath, [require.resolve('prisma/build/index.js', { paths: [ROOT] }), 'generate', '--schema', f],
  { cwd: ROOT, stdio: 'inherit', env: { ...process.env, DATABASE_URL: process.env.DATABASE_URL || 'postgresql://x@localhost/x' } });
if (r.status === 0) console.log('index.js: ' + path.join(dest, 'client', 'index.js'));
process.exit(r.status === null ? 1 : r.status);
