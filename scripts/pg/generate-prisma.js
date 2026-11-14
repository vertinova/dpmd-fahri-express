#!/usr/bin/env node
// Memilih skema Prisma menurut DATABASE_URL: postgres* -> prisma/postgres/schema.prisma, selain itu skema MySQL bawaan.
// PRISMA_GENERATE_DRY=1 hanya mencetak perintah.
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..', '..');
try { require('dotenv').config({ path: path.join(ROOT, '.env') }); } catch (_) { /* dotenv/.env tidak ada: lanjut */ }

const pg = /^postgres/i.test(process.env.DATABASE_URL || '');
const args = ['generate'].concat(pg ? ['--schema', 'prisma/postgres/schema.prisma'] : []);
if (process.env.PRISMA_GENERATE_DRY === '1') { console.log('prisma ' + args.join(' ')); process.exit(0); }
// CLI Prisma dijalankan dengan node yang sama: webhook memanggil node lewat jalur penuh, npx belum tentu di PATH.
const cli = require.resolve('prisma/build/index.js', { paths: [ROOT] });
const r = spawnSync(process.execPath, [cli, ...args], { cwd: ROOT, stdio: 'inherit' });
process.exit(r.status === null ? 1 : r.status);
