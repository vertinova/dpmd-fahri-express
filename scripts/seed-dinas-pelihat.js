/**
 * Seeder akun dinas PELIHAT: BPKAD & Inspektorat.
 *
 * Keduanya adalah akun `dinas_terkait` yang hanya boleh melihat & mengunduh
 * Bantuan Keuangan Perubahan (lihat KODE_DINAS_PELIHAT di src/middlewares/auth.js).
 * Skrip ini idempoten: baris master_dinas dan akunnya dibuat kalau belum ada,
 * dan kalau sudah ada hanya dipastikan tertaut ke dinas yang benar.
 *
 * Kata sandinya diambil dari env BPKAD_PASSWORD / INSPEKTORAT_PASSWORD. Kalau
 * tidak diisi, dipakai SANDI DEFAULT aplikasi — yang berarti akunnya langsung
 * bisa dipakai masuk dan pemiliknya WAJIB mengganti sandi di login pertama.
 * Sandi acak sempat dipakai di sini, tapi keliru untuk jalur otomatis: hasilnya
 * hanya tercetak di log deploy, yang tidak dibaca siapa pun.
 *
 * Skrip ini dipanggil webhook auto-deploy setiap kali backend di-deploy. Karena
 * idempoten, memanggilnya berulang tidak berefek apa-apa selain satu query.
 *
 * Jalankan manual: node scripts/seed-dinas-pelihat.js
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const bcrypt = require('bcryptjs');
const prisma = require('../src/config/prisma');
const { SANDI_DEFAULT } = require('../src/config/sandiDefault');

const DAFTAR = [
  {
    kode_dinas: 'BPKAD',
    nama_dinas: 'Badan Pengelolaan Keuangan dan Aset Daerah',
    singkatan: 'BPKAD',
    email: process.env.BPKAD_EMAIL || 'bpkad@bogorkab.go.id',
    password: process.env.BPKAD_PASSWORD || SANDI_DEFAULT,
  },
  {
    kode_dinas: 'INSPEKTORAT',
    nama_dinas: 'Inspektorat Daerah',
    singkatan: 'INSPEKTORAT',
    email: process.env.INSPEKTORAT_EMAIL || 'inspektorat@bogorkab.go.id',
    password: process.env.INSPEKTORAT_PASSWORD || SANDI_DEFAULT,
  },
];

async function pastikanDinas(item) {
  const adaKode = await prisma.master_dinas.findUnique({ where: { kode_dinas: item.kode_dinas } });
  if (adaKode) return { dinas: adaKode, baru: false };

  const dinas = await prisma.master_dinas.create({
    data: {
      kode_dinas: item.kode_dinas,
      nama_dinas: item.nama_dinas,
      singkatan: item.singkatan,
      is_active: true,
    },
  });
  return { dinas, baru: true };
}

async function pastikanAkun(item, dinas) {
  // Sudah punya akun dinas_terkait? Cukup pastikan tautannya benar.
  const akunDinas = await prisma.users.findFirst({
    where: { dinas_id: dinas.id, role: 'dinas_terkait' },
  });
  if (akunDinas) return { akun: akunDinas, baru: false, password: null };

  // Email sudah dipakai akun lain (mis. dibuat manual) — tautkan saja ke dinasnya.
  const emailTerpakai = await prisma.users.findFirst({ where: { email: item.email } });
  if (emailTerpakai) {
    const akun = await prisma.users.update({
      where: { id: emailTerpakai.id },
      data: { role: 'dinas_terkait', dinas_id: dinas.id, is_active: true, updated_at: new Date() },
    });
    return { akun, baru: false, password: null, ditautkan: true };
  }

  const akun = await prisma.users.create({
    data: {
      name: dinas.nama_dinas,
      email: item.email,
      password: await bcrypt.hash(item.password, 10),
      plain_password: item.password,
      role: 'dinas_terkait',
      dinas_id: dinas.id,
      is_active: true,
      created_at: new Date(),
      updated_at: new Date(),
    },
  });
  return { akun, baru: true, password: item.password };
}

(async () => {
  try {
    for (const item of DAFTAR) {
      const { dinas, baru: dinasBaru } = await pastikanDinas(item);
      console.log(`\n${item.kode_dinas} — master_dinas id=${dinas.id} ${dinasBaru ? '(dibuat)' : '(sudah ada)'}`);

      const hasil = await pastikanAkun(item, dinas);
      if (hasil.baru) {
        const catatan = hasil.password === SANDI_DEFAULT ? ' (sandi default — wajib diganti saat login pertama)' : '';
        console.log(`  akun dibuat  : ${hasil.akun.email} / ${hasil.password}${catatan}`);
      } else if (hasil.ditautkan) {
        console.log(`  akun ditautkan ke dinas ini: ${hasil.akun.email}`);
      } else {
        console.log(`  akun sudah ada: ${hasil.akun.email} (password tidak diubah)`);
      }
      console.log(`  role=${hasil.akun.role} dinas_id=${hasil.akun.dinas_id} aktif=${hasil.akun.is_active}`);
    }
    console.log('\nSelesai.');
  } catch (error) {
    console.error('Gagal seed dinas pelihat:', error);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
})();
