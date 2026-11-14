#!/usr/bin/env node
// Membangkitkan client Prisma dari prisma/schema.prisma (PostgreSQL). Dipanggil webhook deploy & postinstall.
// PRISMA_GENERATE_DRY=1 hanya mencetak perintah.
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..', '..');
if (process.env.PRISMA_GENERATE_DRY === '1') { console.log('prisma generate'); process.exit(0); }
// CLI Prisma dijalankan dengan node yang sama: webhook memanggil node lewat jalur penuh, npx belum tentu di PATH.
const cli = require.resolve('prisma/build/index.js', { paths: [ROOT] });
const r = spawnSync(process.execPath, [cli, 'generate'], { cwd: ROOT, stdio: 'inherit' });
process.exit(r.status === null ? 1 : r.status);
