/**
 * Pasang pas foto dari arsip Dapur Desa ke record aparatur.
 *
 * Tahap kedua setelah scripts/import-dapur-desa.js. Foto arsip disalin ke
 * storage/uploads/aparatur_desa_files/ dengan nama `dapur_<id>.<ext>` lalu
 * dipasang ke `aparatur_desa.file_pas_foto`.
 *
 * Jalankan dari /var/www/backend:
 *   node scripts/pasang-foto-dapur-desa.js --dir /root/arsip-dapur-desa --dry-run
 *   node scripts/pasang-foto-dapur-desa.js --dir /root/arsip-dapur-desa
 *
 * `--dir` berisi `data/_peta_foto_lokal.tsv` (id → path foto) dan folder
 * `files/photo_by_wilayah/<Kecamatan>/<Desa>/<id>_<nama>.<ext>`.
 *
 * Dua langkah terpisah, sengaja:
 *   1. SALIN berkas untuk SEMUA baris arsip yang punya foto — termasuk yang masih
 *      berstatus `konflik`/`baru`. Nama berkasnya disimpan di
 *      `aparatur_dapur_desa.foto_lokal`, sehingga saat desa nanti menekan "Pakai
 *      arsip" atau "Tambahkan", controller cukup menyalin NAMA berkas itu tanpa
 *      menyentuh berkas apa pun. Tanpa langkah ini, keputusan desa menghasilkan
 *      record tanpa pas foto dan fotonya tidak akan pernah sampai.
 *   2. PASANG ke `aparatur_desa.file_pas_foto` hanya untuk baris berstatus
 *      `otomatis`, `sama`, atau `selesai`. Baris `ditolak` dilewati: desa sudah
 *      menyatakan memakai datanya sendiri.
 *
 * Aturan lain:
 *   - Record yang file_pas_foto-nya sudah terisi TIDAK pernah ditimpa; foto hasil
 *     unggahan desa selalu menang.
 *   - Berkas PDF di arsip dilewati (248 buah). Kolom pas foto ditampilkan sebagai
 *     gambar; PDF di sana akan tampil sebagai gambar rusak.
 *
 * Aman diulang: berkas yang sudah ada di tujuan dengan ukuran sama tidak disalin ulang.
 * Setelah skrip ini selesai, folder arsip boleh dihapus — aplikasi tidak lagi
 * membacanya saat desa mengambil keputusan.
 */

const fs = require('fs');
const path = require('path');
const prisma = require('../src/config/prisma');

const argValue = (nama) => {
  const i = process.argv.indexOf(nama);
  return i !== -1 ? process.argv[i + 1] : null;
};

const DIR = argValue('--dir');
const DRY_RUN = process.argv.includes('--dry-run');

const TUJUAN = path.join(__dirname, '..', 'storage', 'uploads', 'aparatur_desa_files');

// Status yang fotonya boleh langsung dipasang ke record aparatur. Baris di luar
// daftar ini tetap DISALIN berkasnya (supaya siap dipakai saat desa memutuskan),
// hanya belum dipasang.
const STATUS_PASANG = ['otomatis', 'sama', 'selesai'];

// Ekstensi yang layak jadi pas foto. `jfif` sebenarnya JPEG, disimpan sebagai .jpg
// supaya peramban dan pustaka gambar tidak salah menebak.
const EKSTENSI_GAMBAR = { jpg: 'jpg', jpeg: 'jpeg', png: 'png', jfif: 'jpg' };

/** Peta dapur_id → path foto relatif terhadap folder arsip. */
const bacaPeta = (dir) => {
  const berkas = path.join(dir, 'data', '_peta_foto_lokal.tsv');
  if (!fs.existsSync(berkas)) {
    throw new Error(`Tidak ada ${berkas}. Pastikan --dir menunjuk ke folder arsip Dapur Desa.`);
  }
  // Arsip ditulis dengan BOM dan memakai pemisah path gaya Windows.
  const isi = fs.readFileSync(berkas, 'utf8').replace(/^﻿/, '');
  const peta = new Map();
  for (const baris of isi.split(/\r?\n/)) {
    if (!baris.trim()) continue;
    const [id, lokasi] = baris.split('\t');
    const dapurId = parseInt(String(id).trim(), 10);
    if (!Number.isFinite(dapurId) || !lokasi) continue;
    peta.set(dapurId, String(lokasi).trim().replace(/\\/g, '/'));
  }
  return peta;
};

async function main() {
  if (!DIR) {
    console.error('❌ Wajib pakai --dir "<folder arsip Dapur Desa>"');
    process.exitCode = 1;
    return;
  }

  console.log(`\n🖼️  Membaca peta foto: ${DIR}`);
  const peta = bacaPeta(DIR);
  console.log(`   ${peta.size} entri foto di arsip.\n`);

  // SEMUA baris diambil, bukan hanya yang sudah selesai — lihat catatan langkah 1.
  const barisArsip = await prisma.aparatur_dapur_desa.findMany({
    select: { dapur_id: true, nama: true, aparatur_desa_id: true, status_rekonsiliasi: true },
  });

  // Ambil sekali, supaya tidak query per record: mana yang pas fotonya masih kosong.
  const idAparatur = barisArsip.map((b) => b.aparatur_desa_id).filter(Boolean);
  const aparatur = await prisma.aparatur_desa.findMany({
    where: { id: { in: idAparatur } },
    select: { id: true, file_pas_foto: true },
  });
  const fotoSaatIni = new Map(aparatur.map((a) => [a.id, a.file_pas_foto]));

  const ringkasan = {
    disiapkan: 0,
    dipasang: 0,
    menunggu_keputusan: 0,
    disalin: 0,
    sudah_ada_berkas: 0,
    sudah_punya_foto: 0,
    tanpa_foto_di_arsip: 0,
    pdf_dilewati: 0,
    berkas_hilang: 0,
    gagal: 0,
  };
  const gagal = [];

  if (!DRY_RUN) fs.mkdirSync(TUJUAN, { recursive: true });

  for (const baris of barisArsip) {
    try {
      const relatif = peta.get(baris.dapur_id);
      if (!relatif) {
        ringkasan.tanpa_foto_di_arsip++;
        continue;
      }

      const ext = (relatif.split('.').pop() || '').toLowerCase();
      const extTujuan = EKSTENSI_GAMBAR[ext];
      if (!extTujuan) {
        // Praktis hanya PDF yang jatuh ke sini.
        ringkasan.pdf_dilewati++;
        continue;
      }

      const sumber = path.join(DIR, relatif);
      if (!fs.existsSync(sumber)) {
        ringkasan.berkas_hilang++;
        continue;
      }

      const namaBerkas = `dapur_${baris.dapur_id}.${extTujuan}`;
      const tujuan = path.join(TUJUAN, namaBerkas);

      // LANGKAH 1 — salin berkas & catat namanya, apa pun status baris ini.
      if (!DRY_RUN) {
        const ukuranSumber = fs.statSync(sumber).size;
        const sudahAda = fs.existsSync(tujuan) && fs.statSync(tujuan).size === ukuranSumber;
        if (sudahAda) {
          ringkasan.sudah_ada_berkas++;
        } else {
          fs.copyFileSync(sumber, tujuan);
          ringkasan.disalin++;
        }

        await prisma.aparatur_dapur_desa.update({
          where: { dapur_id: baris.dapur_id },
          data: { foto_lokal: namaBerkas, updated_at: new Date() },
        });
      }
      ringkasan.disiapkan++;

      // LANGKAH 2 — pasang ke record aparatur, hanya untuk baris yang sudah beres.
      if (!STATUS_PASANG.includes(baris.status_rekonsiliasi) || !baris.aparatur_desa_id) {
        ringkasan.menunggu_keputusan++;
        continue;
      }
      if (fotoSaatIni.get(baris.aparatur_desa_id)) {
        ringkasan.sudah_punya_foto++;
        continue;
      }

      if (!DRY_RUN) {
        await prisma.aparatur_desa.update({
          where: { id: baris.aparatur_desa_id },
          data: { file_pas_foto: namaBerkas, updated_at: new Date() },
        });
      }
      ringkasan.dipasang++;
    } catch (err) {
      ringkasan.gagal++;
      gagal.push({ dapur_id: baris.dapur_id, nama: baris.nama, pesan: err.message });
    }
  }

  console.log('────────────────────────────────────────');
  console.log(DRY_RUN ? '🔍 HASIL SIMULASI (tidak ada yang ditulis)' : '✅ PEMASANGAN FOTO SELESAI');
  console.log('────────────────────────────────────────');
  console.log(`Baris arsip diperiksa      : ${barisArsip.length}`);
  console.log(`Berkas foto disiapkan      : ${ringkasan.disiapkan}`);
  if (!DRY_RUN) {
    console.log(`  berkas disalin           : ${ringkasan.disalin}`);
    console.log(`  berkas sudah ada         : ${ringkasan.sudah_ada_berkas}`);
  }
  console.log(`Foto terpasang ke aparatur : ${ringkasan.dipasang}`);
  console.log(`Menunggu keputusan desa    : ${ringkasan.menunggu_keputusan}   (berkas siap, dipasang saat desa memilih)`);
  console.log(`Sudah punya foto sendiri   : ${ringkasan.sudah_punya_foto}   (tidak ditimpa)`);
  console.log(`Tidak ada fotonya di arsip : ${ringkasan.tanpa_foto_di_arsip}`);
  console.log(`PDF dilewati               : ${ringkasan.pdf_dilewati}   (bukan gambar)`);
  console.log(`Berkas hilang di arsip     : ${ringkasan.berkas_hilang}`);
  console.log(`Gagal                      : ${ringkasan.gagal}`);
  console.log('────────────────────────────────────────\n');

  if (gagal.length) {
    console.log(`❌ ${gagal.length} record gagal:`);
    gagal.slice(0, 20).forEach((g) => console.log(`   • [${g.dapur_id}] ${g.nama}: ${g.pesan}`));
    console.log('');
  }

  if (DRY_RUN) {
    console.log('ℹ️  Ini simulasi. Jalankan ulang tanpa --dry-run untuk benar-benar menyalin.\n');
  }
}

main()
  .catch((error) => {
    console.error('❌ Pemasangan foto gagal:', error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
