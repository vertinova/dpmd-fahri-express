'use strict';
/**
 * Rollback: delete all rws/rts/pengurus with unpadded nomor (1-2 digit)
 * that were created by the import script (which used non-padded nomors).
 * After this, re-run the import script to import with 3-digit nomors.
 */
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

async function run() {
  // 1. Find unpadded RW IDs
  const unpaddedRws = await p.$queryRawUnsafe(
    `SELECT id FROM rws WHERE nomor REGEXP '^[0-9]{1,2}$'`
  );
  const rwIds = unpaddedRws.map(r => r.id);
  console.log(`Unpadded RWs: ${rwIds.length}`);

  // 2. Find unpadded RT IDs (either standalone or children of unpadded RWs)
  const unpaddedRts = await p.$queryRawUnsafe(
    `SELECT id FROM rts WHERE nomor REGEXP '^[0-9]{1,2}$'`
  );
  const rtIds = unpaddedRts.map(r => r.id);
  console.log(`Unpadded RTs: ${rtIds.length}`);

  if (!rwIds.length && !rtIds.length) {
    console.log('Nothing to rollback.');
    return;
  }

  // 3. Delete pengurus linked to unpadded RTs
  if (rtIds.length) {
    const r = await p.pengurus.deleteMany({
      where: { pengurusable_id: { in: rtIds }, pengurusable_type: 'rts' },
    });
    console.log(`Deleted ${r.count} pengurus from unpadded RTs`);
  }

  // 4. Delete pengurus linked to unpadded RWs
  if (rwIds.length) {
    const r = await p.pengurus.deleteMany({
      where: { pengurusable_id: { in: rwIds }, pengurusable_type: 'rws' },
    });
    console.log(`Deleted ${r.count} pengurus from unpadded RWs`);
  }

  // 5. Delete unpadded RTs (children of unpadded RWs or standalone)
  if (rtIds.length) {
    const r = await p.rts.deleteMany({ where: { id: { in: rtIds } } });
    console.log(`Deleted ${r.count} unpadded RTs`);
  }

  // 6. Delete unpadded RWs
  if (rwIds.length) {
    const r = await p.rws.deleteMany({ where: { id: { in: rwIds } } });
    console.log(`Deleted ${r.count} unpadded RWs`);
  }

  console.log('\nRollback complete. Now re-run: node scripts/import-rtrw-from-excel.js');
}

run().catch(e => { console.error('ERR:', e.message); process.exit(1); })
     .finally(() => p.$disconnect());
