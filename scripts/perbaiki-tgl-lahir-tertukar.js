'use strict';
/**
 * Perbaiki tanggal lahir pengurus yang tanggal & bulannya tertukar.
 *
 * Jalankan:
 *   node scripts/perbaiki-tgl-lahir-tertukar.js           # dry-run (default, tidak mengubah apa pun)
 *   node scripts/perbaiki-tgl-lahir-tertukar.js --apply   # baru menulis ke database
 *
 * Sasarannya hanya baris yang sebab anomalinya 'tgl_lahir_tertukar' (lihat
 * src/utils/nikAnomali.js): NIK 16 digit, tahun lahirnya sama, tapi tanggal dan
 * bulannya persis bertukar — mis. NIK memuat 10-09-93 sementara database
 * mencatat 1993-10-09. Pada pola itu NIK-nya yang benar dan tanggal lahir yang
 * salah urut saat input/impor, jadi tanggal lahir disetel mengikuti NIK.
 *
 * Baris yang tanggal lahirnya beda karena sebab lain TIDAK disentuh — penomoran
 * Dukcapil memang tidak selalu mengikuti tanggal lahir.
 *
 * Laporan sebelum→sesudah dan SQL pengembalian ditulis ke storage/backups/
 * (ikut .gitignore) sebelum satu baris pun diubah.
 */

const fs = require('fs');
const path = require('path');
const { PrismaClient } = require('@prisma/client');
const { nikErrorSebab } = require('../src/utils/nikAnomali');

const prisma = new PrismaClient();
const APPLY = process.argv.includes('--apply');
const BACKUP_DIR = path.join(__dirname, '..', 'storage', 'backups');

const pad = (n) => String(n).padStart(2, '0');
const isoOf = (value) => (value instanceof Date && !Number.isNaN(value.getTime())
  ? value.toISOString().slice(0, 10)
  : '');

/** Tanggal lahir usulan dari NIK, atau null bila hasilnya bukan tanggal yang sah. */
function usulanDariNik(nik, isoLama) {
  const digits = String(nik ?? '').replace(/\D/g, '');
  if (digits.length !== 16 || !isoLama) return null;
  const hari = Number(digits.slice(6, 8)) % 40; // perempuan: tanggal + 40
  const bulan = Number(digits.slice(8, 10));
  const tahun = isoLama.slice(0, 4);
  if (bulan < 1 || bulan > 12 || hari < 1 || hari > 31) return null;
  const iso = `${tahun}-${pad(bulan)}-${pad(hari)}`;
  // Tolak tanggal yang tidak ada di kalender (mis. 31 April, 29 Feb non-kabisat).
  const tanggal = new Date(`${iso}T00:00:00.000Z`);
  return isoOf(tanggal) === iso ? iso : null;
}

const csvCell = (value) => {
  const text = String(value ?? '');
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

async function main() {
  const rows = await prisma.pengurus.findMany({
    select: {
      id: true,
      desa_id: true,
      pengurusable_type: true,
      jabatan: true,
      nama_lengkap: true,
      nik: true,
      tanggal_lahir: true,
    },
  });

  const perbaikan = [];
  const dilewati = [];
  rows.forEach((r) => {
    const isoLama = isoOf(r.tanggal_lahir);
    if (nikErrorSebab(r.nik, isoLama) !== 'tgl_lahir_tertukar') return;
    const isoBaru = usulanDariNik(r.nik, isoLama);
    if (!isoBaru || isoBaru === isoLama) {
      dilewati.push({ ...r, isoLama, alasan: 'usulan tanggal tidak sah' });
      return;
    }
    perbaikan.push({
      id: r.id,
      desa_id: String(r.desa_id),
      tipe: r.pengurusable_type,
      jabatan: r.jabatan,
      nama: r.nama_lengkap,
      nik: r.nik,
      isoLama,
      isoBaru,
    });
  });

  const perTipe = perbaikan.reduce((acc, p) => {
    acc[p.tipe] = (acc[p.tipe] || 0) + 1;
    return acc;
  }, {});

  console.log(`\nMode          : ${APPLY ? 'APPLY (menulis ke database)' : 'DRY-RUN (tidak mengubah apa pun)'}`);
  console.log(`Pengurus      : ${rows.length} baris diperiksa`);
  console.log(`Akan diperbaiki: ${perbaikan.length}`, perTipe);
  if (dilewati.length) {
    console.log(`Dilewati      : ${dilewati.length} (usulan tanggalnya tidak sah, perlu dicek manual)`);
    dilewati.slice(0, 5).forEach((d) => console.log(`  ${d.nik} | ${d.isoLama} | ${d.nama_lengkap}`));
  }

  if (perbaikan.length === 0) {
    console.log('\nTidak ada yang perlu diperbaiki.');
    return;
  }

  console.log('\nContoh 10 baris pertama (NIK | sebelum -> sesudah | nama):');
  perbaikan.slice(0, 10).forEach((p) => {
    console.log(`  ${p.nik} | ${p.isoLama} -> ${p.isoBaru} | ${p.nama}`);
  });

  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const cap = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const csvPath = path.join(BACKUP_DIR, `tgl-lahir-tertukar-${cap}.csv`);
  const sqlPath = path.join(BACKUP_DIR, `tgl-lahir-tertukar-${cap}-revert.sql`);

  const header = 'id,desa_id,tipe,jabatan,nama_lengkap,nik,tanggal_lahir_lama,tanggal_lahir_baru';
  const csv = [header, ...perbaikan.map((p) => [
    p.id, p.desa_id, p.tipe, p.jabatan, p.nama, p.nik, p.isoLama, p.isoBaru,
  ].map(csvCell).join(','))].join('\n');
  fs.writeFileSync(csvPath, `${csv}\n`, 'utf8');

  // Ditulis lebih dulu, sebelum baris pertama diubah, supaya tetap bisa
  // dikembalikan walau proses berhenti di tengah jalan.
  const sql = perbaikan
    .map((p) => `UPDATE pengurus SET tanggal_lahir = '${p.isoLama}' WHERE id = '${p.id}';`)
    .join('\n');
  fs.writeFileSync(sqlPath, `-- Kembalikan tanggal lahir ke nilai sebelum perbaikan (${cap})\n${sql}\n`, 'utf8');

  console.log(`\nLaporan   : ${csvPath}`);
  console.log(`Pengembali: ${sqlPath}`);

  if (!APPLY) {
    console.log('\nDRY-RUN: database tidak diubah. Periksa CSV di atas, lalu jalankan ulang dengan --apply.');
    return;
  }

  let berhasil = 0;
  for (const p of perbaikan) {
    await prisma.pengurus.update({
      where: { id: p.id },
      data: { tanggal_lahir: new Date(`${p.isoBaru}T00:00:00.000Z`) },
    });
    berhasil += 1;
    if (berhasil % 100 === 0) console.log(`  ...${berhasil}/${perbaikan.length}`);
  }
  console.log(`\nSelesai: ${berhasil} tanggal lahir diperbaiki.`);
  console.log(`Membatalkan: jalankan isi ${sqlPath} di database.`);
}

main()
  .catch((error) => {
    console.error('Gagal:', error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
    process.exit(process.exitCode || 0);
  });
