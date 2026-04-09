/**
 * Seed System Roles
 * Jalankan: node scripts/seed-system-roles.js
 * 
 * Script ini akan INSERT IGNORE system roles ke tabel `roles`.
 * Aman dijalankan berkali-kali karena pakai upsert (skip jika sudah ada).
 */

const prisma = require('../src/config/prisma');

const SYSTEM_ROLES = [
  { name: 'superadmin', label: 'Super Admin', color: 'red', description: 'Administrator sistem dengan akses penuh', category: 'admin', is_system: true, needs_entity: false },
  { name: 'kepala_dinas', label: 'Kepala Dinas', color: 'blue', description: 'Kepala Dinas DPMD', category: 'pimpinan', is_system: true, needs_entity: false },
  { name: 'sekretaris_dinas', label: 'Sekretaris Dinas', color: 'indigo', description: 'Sekretaris Dinas DPMD', category: 'pimpinan', is_system: true, needs_entity: false },
  { name: 'kepala_bidang', label: 'Kepala Bidang', color: 'green', description: 'Kepala Bidang di DPMD', category: 'struktural', is_system: true, needs_entity: false },
  { name: 'ketua_tim', label: 'Ketua Tim', color: 'teal', description: 'Ketua Tim di DPMD', category: 'struktural', is_system: true, needs_entity: false },
  { name: 'pegawai', label: 'Pegawai/Staff', color: 'gray', description: 'Pegawai atau staff DPMD', category: 'pegawai', is_system: true, needs_entity: false },
  { name: 'sekretariat', label: 'Sekretariat', color: 'purple', description: 'Bagian Sekretariat', category: 'bidang', is_system: true, needs_entity: false },
  { name: 'sarana_prasarana', label: 'Sarana Prasarana', color: 'cyan', description: 'Bidang Sarana dan Prasarana', category: 'bidang', is_system: true, needs_entity: false },
  { name: 'kekayaan_keuangan', label: 'Kekayaan Keuangan', color: 'pink', description: 'Bidang Kekayaan dan Keuangan', category: 'bidang', is_system: true, needs_entity: false },
  { name: 'pemberdayaan_masyarakat', label: 'Pemberdayaan Masyarakat', color: 'yellow', description: 'Bidang Pemberdayaan Masyarakat', category: 'bidang', is_system: true, needs_entity: false },
  { name: 'pemerintahan_desa', label: 'Pemerintahan Desa', color: 'indigo', description: 'Bidang Pemerintahan Desa', category: 'bidang', is_system: true, needs_entity: false },
  { name: 'desa', label: 'Admin Desa', color: 'emerald', description: 'Administrator tingkat desa', category: 'wilayah', is_system: true, needs_entity: true },
  { name: 'kecamatan', label: 'Admin Kecamatan', color: 'violet', description: 'Administrator tingkat kecamatan', category: 'wilayah', is_system: true, needs_entity: true },
  { name: 'dinas_terkait', label: 'Dinas Terkait', color: 'amber', description: 'Dinas terkait lainnya', category: 'other', is_system: true, needs_entity: false },
  { name: 'verifikator_dinas', label: 'Verifikator Dinas', color: 'orange', description: 'Verifikator dari dinas terkait', category: 'other', is_system: true, needs_entity: false },
];

async function seedRoles() {
  console.log('🔄 Seeding system roles...\n');

  let created = 0;
  let skipped = 0;

  for (const role of SYSTEM_ROLES) {
    try {
      await prisma.roles.upsert({
        where: { name: role.name },
        update: {}, // Jangan update jika sudah ada
        create: role,
      });

      const existing = await prisma.roles.findUnique({ where: { name: role.name } });
      if (existing.is_system) {
        console.log(`  ✅ ${role.name} - ${role.label}`);
        created++;
      }
    } catch (err) {
      console.log(`  ⏭️  ${role.name} - sudah ada, skip`);
      skipped++;
    }
  }

  console.log(`\n📊 Hasil: ${created} roles OK, ${skipped} skipped`);

  const total = await prisma.roles.count();
  const systemCount = await prisma.roles.count({ where: { is_system: true } });
  console.log(`📋 Total roles di database: ${total} (${systemCount} sistem)\n`);
}

seedRoles()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
