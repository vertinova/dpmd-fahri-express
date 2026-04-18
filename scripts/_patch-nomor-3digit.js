'use strict';
/**
 * Patch existing rws and rts nomor to always be 3-digit zero-padded.
 * E.g. "1" → "001", "12" → "012"
 * Safe to run multiple times (idempotent).
 */
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

async function padNomor(table) {
  // Get all rows where nomor is NOT yet 3-digit
  const rows = await p.$queryRawUnsafe(
    `SELECT id, nomor FROM ${table} WHERE nomor REGEXP '^[0-9]+$' AND CHAR_LENGTH(nomor) < 3`
  );

  console.log(`${table}: ${rows.length} rows to update`);
  let updated = 0;
  for (const row of rows) {
    const padded = String(Number(row.nomor)).padStart(3, '0');
    await p.$executeRawUnsafe(
      `UPDATE ${table} SET nomor = ? WHERE id = ?`, padded, row.id
    );
    updated++;
  }
  console.log(`${table}: updated ${updated} rows`);
}

async function run() {
  await padNomor('rws');
  await padNomor('rts');
  console.log('Done.');
}

run().catch(e => { console.error('ERR:', e.message); process.exit(1); })
     .finally(() => p.$disconnect());
