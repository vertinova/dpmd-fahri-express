/**
 * Update anggaran_master_kegiatan and anggaran_pagu (tahun 2026)
 * from data/anggaran/list_belanja.json
 *
 * Match key: id_sub_giat
 */

const { PrismaClient } = require('@prisma/client');
const fs = require('fs');
const path = require('path');

const prisma = new PrismaClient();

async function main() {
  const filePath = path.join(__dirname, '../data/anggaran/list_belanja.json');
  const json = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  const items = json.data;

  console.log(`\n📂 Loaded ${items.length} items from list_belanja.json`);

  // Load all masters indexed by id_sub_giat
  const masters = await prisma.anggaran_master_kegiatan.findMany({
    select: { id: true, id_sub_giat: true, kode_sub_kegiatan: true },
  });
  const masterBySubGiat = new Map(masters.filter(m => m.id_sub_giat).map(m => [m.id_sub_giat, m]));

  // Load all pagu indexed by master_kegiatan_id+tahun
  const paguList = await prisma.anggaran_pagu.findMany({
    where: { tahun: 2026 },
    select: { id: true, master_kegiatan_id: true, pagu: true, pagu_indikatif: true },
  });
  const paguByMaster = new Map(paguList.map(p => [p.master_kegiatan_id.toString(), p]));

  let masterUpdated = 0;
  let paguUpdated = 0;
  let skipped = 0;

  for (const item of items) {
    const master = masterBySubGiat.get(item.id_sub_giat);
    if (!master) {
      console.warn(`  ⚠️  id_sub_giat ${item.id_sub_giat} not found in DB — skipped`);
      skipped++;
      continue;
    }

    // 1. Update master kegiatan fields
    await prisma.anggaran_master_kegiatan.update({
      where: { id: master.id },
      data: {
        kode_program: item.kode_program,
        nama_program: item.nama_program,
        kode_kegiatan: item.kode_giat,
        nama_kegiatan: item.nama_giat,
        kode_sub_kegiatan: item.kode_sub_giat,
        nama_sub_kegiatan: item.nama_sub_giat,
        id_giat: item.id_giat,
        updated_at: new Date(),
      },
    });
    masterUpdated++;

    // 2. Upsert pagu for tahun 2026
    const pagu = paguByMaster.get(master.id.toString());
    const newPagu = item.pagu ?? 0;
    const newPaguIndikatif = item.pagu_indikatif ?? newPagu;

    if (pagu) {
      await prisma.anggaran_pagu.update({
        where: { id: pagu.id },
        data: {
          pagu: newPagu,
          pagu_indikatif: newPaguIndikatif,
          updated_at: new Date(),
        },
      });
    } else {
      // No pagu yet — create one (requires created_by; use first admin user)
      const adminUser = await prisma.users.findFirst({ where: { role: 'superadmin' }, select: { id: true } });
      if (adminUser) {
        await prisma.anggaran_pagu.create({
          data: {
            master_kegiatan_id: master.id,
            tahun: 2026,
            pagu: newPagu,
            pagu_indikatif: newPaguIndikatif,
            created_by: adminUser.id,
          },
        });
      }
    }
    paguUpdated++;
  }

  console.log(`\n✅ Done!`);
  console.log(`   Master kegiatan updated : ${masterUpdated}`);
  console.log(`   Pagu 2026 updated       : ${paguUpdated}`);
  if (skipped > 0) console.log(`   Skipped (no match)      : ${skipped}`);

  // Print summary of total pagu
  const total = await prisma.anggaran_pagu.aggregate({
    where: { tahun: 2026 },
    _sum: { pagu: true },
  });
  const totalPagu = Number(total._sum.pagu ?? 0);
  console.log(`\n💰 Total Pagu 2026: ${new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(totalPagu)}`);
}

main()
  .catch(e => {
    console.error('❌ Error:', e.message);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
