'use strict';
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

async function run() {
  const cols = await p.$queryRawUnsafe(
    `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='pengurus'
     AND COLUMN_NAME IN ('nama_bank','nomor_rekening','nama_rekening')`
  );
  const existing = cols.map(c => c.COLUMN_NAME);
  console.log('Existing cols:', existing);

  const sqls = [];
  if (!existing.includes('nama_bank'))
    sqls.push("ALTER TABLE pengurus ADD COLUMN nama_bank VARCHAR(100) NULL AFTER no_telepon");
  if (!existing.includes('nomor_rekening'))
    sqls.push("ALTER TABLE pengurus ADD COLUMN nomor_rekening VARCHAR(100) NULL AFTER nama_bank");
  if (!existing.includes('nama_rekening'))
    sqls.push("ALTER TABLE pengurus ADD COLUMN nama_rekening VARCHAR(255) NULL AFTER nomor_rekening");

  if (sqls.length === 0) {
    console.log('All columns already exist — skipping.');
    return;
  }
  for (const sql of sqls) {
    await p.$executeRawUnsafe(sql);
    console.log('Ran:', sql);
  }
  console.log('Migration done.');
}

run().catch(e => { console.error('ERR:', e.message); process.exit(1); })
     .finally(() => p.$disconnect());
