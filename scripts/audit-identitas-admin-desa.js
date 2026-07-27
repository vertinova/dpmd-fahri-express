/**
 * Audit identitas Admin Desa.
 * Jalankan: node scripts/audit-identitas-admin-desa.js [--csv]
 *
 * Menjawab pertanyaan "desa mana yang akunnya masih pakai nama bawaan sistem?".
 * Akun yang masih memakai nama seperti "Admin Desa Mekarsari" — atau belum
 * mengisi jabatan/nomor HP — akan dipaksa mengisi identitas lewat popup saat
 * membuka aplikasi. Script ini hanya MEMBACA; tidak mengubah data apa pun.
 *
 * --csv mencetak daftar yang belum lengkap dalam format CSV supaya gampang
 * ditempel ke spreadsheet untuk ditagih ke kecamatan.
 */

const prisma = require('../src/config/prisma');
const { mustCompleteDesaProfile, isPlaceholderName, normalizePhone } = require('../src/config/desaProfile');

const asCsv = process.argv.includes('--csv');

// Alasan kenapa akun ini masih dianggap belum lengkap.
const alasan = (user) => {
  const kurang = [];
  if (isPlaceholderName(user.name)) kurang.push('nama masih bawaan sistem');
  else if (String(user.name || '').trim().length < 3) kurang.push('nama kosong');
  if (!String(user.jabatan_desa || '').trim()) kurang.push('jabatan kosong');
  if (!normalizePhone(user.no_hp)) kurang.push('nomor HP kosong/tidak valid');
  return kurang.join(', ');
};

async function main() {
  const users = await prisma.users.findMany({
    where: { role: 'admin_desa' },
    select: {
      id: true,
      name: true,
      email: true,
      // Wajib ikut: mustCompleteDesaProfile() memeriksa role lebih dulu dan
      // langsung mengembalikan false kalau field ini tidak ada.
      role: true,
      jabatan_desa: true,
      no_hp: true,
      is_active: true,
      desa_id: true,
    },
    orderBy: { id: 'asc' },
  });

  // Ambil nama desa & kecamatan sekali jalan, lalu petakan di memori.
  const desaIds = [...new Set(users.map((u) => u.desa_id).filter(Boolean))];
  const desas = desaIds.length
    ? await prisma.desas.findMany({
        where: { id: { in: desaIds } },
        select: { id: true, nama: true, status_pemerintahan: true, kecamatan_id: true },
      })
    : [];
  const kecamatanIds = [...new Set(desas.map((d) => d.kecamatan_id).filter(Boolean))];
  const kecamatans = kecamatanIds.length
    ? await prisma.kecamatans.findMany({
        where: { id: { in: kecamatanIds } },
        select: { id: true, nama: true },
      })
    : [];

  const kecamatanById = new Map(kecamatans.map((k) => [String(k.id), k.nama]));
  const desaById = new Map(
    desas.map((d) => [
      String(d.id),
      {
        nama: d.nama,
        label: d.status_pemerintahan === 'kelurahan' ? 'Kelurahan' : 'Desa',
        kecamatan: kecamatanById.get(String(d.kecamatan_id)) || '-',
      },
    ])
  );

  const belum = [];
  const sudah = [];
  for (const user of users) {
    (mustCompleteDesaProfile(user) ? belum : sudah).push(user);
  }

  const barisDesa = (user) => desaById.get(String(user.desa_id)) || { nama: '(tanpa desa)', label: '', kecamatan: '-' };

  if (asCsv) {
    console.log('Kecamatan,Desa,Email,Nama Sekarang,Jabatan,Nomor HP,Kekurangan');
    for (const user of belum) {
      const d = barisDesa(user);
      const kolom = [
        d.kecamatan,
        `${d.label} ${d.nama}`.trim(),
        user.email,
        user.name || '',
        user.jabatan_desa || '',
        user.no_hp || '',
        alasan(user),
      ];
      console.log(kolom.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(','));
    }
    return;
  }

  const total = users.length;
  const persen = total ? Math.round((sudah.length / total) * 100) : 0;

  console.log('\n📋 Audit identitas Admin Desa');
  console.log('────────────────────────────────────────');
  console.log(`Total akun Admin Desa : ${total}`);
  console.log(`Sudah pakai nama asli : ${sudah.length} (${persen}%)`);
  console.log(`Masih bawaan sistem   : ${belum.length}`);
  console.log('────────────────────────────────────────\n');

  if (belum.length === 0) {
    console.log('✅ Semua akun Admin Desa sudah memakai identitas petugas asli.\n');
    return;
  }

  // Kelompokkan per kecamatan supaya gampang ditagih lewat kecamatan masing-masing.
  const perKecamatan = new Map();
  for (const user of belum) {
    const d = barisDesa(user);
    if (!perKecamatan.has(d.kecamatan)) perKecamatan.set(d.kecamatan, []);
    perKecamatan.get(d.kecamatan).push({ user, desa: d });
  }

  for (const kecamatan of [...perKecamatan.keys()].sort()) {
    const daftar = perKecamatan.get(kecamatan);
    console.log(`Kec. ${kecamatan} — ${daftar.length} akun`);
    for (const { user, desa } of daftar) {
      const nonaktif = user.is_active ? '' : ' [NONAKTIF]';
      console.log(`  • ${desa.label} ${desa.nama}${nonaktif} — ${user.email}`);
      console.log(`    ${alasan(user)}`);
    }
    console.log('');
  }

  console.log('ℹ️  Akun di atas akan otomatis dihadang popup "Lengkapi Identitas Admin Desa"');
  console.log('   saat membuka aplikasi, dan tidak bisa memakai menu Manajemen Akun sebelum diisi.');
  console.log('   Jalankan dengan --csv untuk daftar siap tempel ke spreadsheet.\n');
}

main()
  .catch((error) => {
    console.error('❌ Gagal menjalankan audit:', error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
