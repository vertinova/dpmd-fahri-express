/**
 * Impor arsip Dapur Desa ke tabel staging + suntik ke desa yang belum punya data.
 *
 * Jalankan dari /var/www/backend (bukan dari dalam scripts/):
 *   node scripts/import-dapur-desa.js --dir "/path/arsip-dapur-desa" --dry-run
 *   node scripts/import-dapur-desa.js --dir "/path/arsip-dapur-desa"
 *   node scripts/import-dapur-desa.js --dir "..." --desa 3201052008   (uji satu desa)
 *
 * `--dir` menunjuk ke folder arsip yang berisi `data/apparatus_all.json`.
 *
 * Yang dilakukan:
 *   1. Semua record arsip masuk ke `aparatur_dapur_desa` (idempoten lewat dapur_id).
 *   2. Kode desa arsip dipetakan ke `desas` (kode DPMD berjeda titik, arsip tidak).
 *   3. Desa yang BELUM punya aparatur sama sekali → record langsung dibuat di
 *      `aparatur_desa` dan ditandai `otomatis`.
 *   4. Desa yang SUDAH punya data → dicocokkan per nama:
 *        - ketemu & isinya sama  → status `sama`, selesai sendiri tanpa menanyai desa.
 *        - ketemu & isinya beda  → status `konflik`, desa memilih lewat halaman Aparatur.
 *        - tidak ketemu          → status `baru`, desa bisa menambahkannya.
 *
 *      "Sama" dinilai dengan pembanding yang mengabaikan beda huruf besar/kecil dan
 *      beda cara menulis jenjang pendidikan (lihat bandingkanDenganAparatur).
 *
 * Aman diulang: baris `otomatis`/`sama`/`selesai`/`ditolak` tidak disentuh lagi.
 */

const fs = require('fs');
const path = require('path');
const prisma = require('../src/config/prisma');
const {
  keBarisStaging,
  keAparaturDesa,
  namaInti,
  normalisasiNama,
  bandingkanDenganAparatur,
} = require('../src/config/dapurDesa');

const argValue = (nama) => {
  const i = process.argv.indexOf(nama);
  return i !== -1 ? process.argv[i + 1] : null;
};

const DIR = argValue('--dir');
const DRY_RUN = process.argv.includes('--dry-run');
const FILTER_DESA = argValue('--desa');

// Status yang sudah "final": impor ulang tidak boleh menimpanya.
const STATUS_FINAL = new Set(['otomatis', 'selesai', 'ditolak', 'sama']);

/** Baca arsip dan kembalikan array record mentah. */
const bacaArsip = (dir) => {
  const berkas = path.join(dir, 'data', 'apparatus_all.json');
  if (!fs.existsSync(berkas)) {
    throw new Error(`Tidak ada ${berkas}. Pastikan --dir menunjuk ke folder arsip Dapur Desa.`);
  }
  // Arsip ditulis dengan BOM; JSON.parse menolaknya kalau tidak dibuang dulu.
  const teksBerkas = fs.readFileSync(berkas, 'utf8').replace(/^﻿/, '');
  const isi = JSON.parse(teksBerkas);
  // apparatus_all.json berupa array datar; berkas per-halaman memakai bentuk
  // response API { success, code, message, meta, data: [...] }. Keduanya diterima.
  const data = Array.isArray(isi) ? isi : isi.data;
  if (!Array.isArray(data)) throw new Error('Struktur arsip tidak dikenali: `data` bukan array.');
  return data;
};

async function main() {
  if (!DIR) {
    console.error('❌ Wajib pakai --dir "<folder arsip Dapur Desa>"');
    process.exitCode = 1;
    return;
  }

  console.log(`\n📦 Membaca arsip: ${DIR}`);
  const mentah = bacaArsip(DIR);
  console.log(`   ${mentah.length} record ditemukan.`);

  // Buang record sampah: tanpa nama atau tanpa id (arsip memuat beberapa entri spam).
  let baris = mentah.map(keBarisStaging).filter((b) => b.dapur_id && b.nama);
  const dibuang = mentah.length - baris.length;
  if (FILTER_DESA) {
    baris = baris.filter((b) => b.kode_desa === String(FILTER_DESA).replace(/\D/g, ''));
    console.log(`   Difilter ke desa ${FILTER_DESA}: ${baris.length} record.`);
  }
  console.log(`   ${baris.length} record dipakai${dibuang ? `, ${dibuang} dibuang (tanpa nama/id)` : ''}.\n`);

  // Peta kode desa (tanpa titik) → desas.id
  const desas = await prisma.desas.findMany({ select: { id: true, kode: true, nama: true } });
  const desaByKode = new Map(desas.map((d) => [String(d.kode).replace(/\D/g, ''), d]));

  // Cadangan: sebagian kecil arsip memakai kode desa lama yang tidak ada lagi di
  // tabel desas (mis. Pabuaran/Sukamakmur tercatat …0014, sekarang …2002). Enam digit
  // pertama kode desa = kode kecamatan, jadi kombinasi kecamatan + nama desa cukup
  // untuk menemukannya tanpa perlu menghardcode kode per desa.
  const desaByKecNama = new Map(
    desas.map((d) => {
      const digit = String(d.kode).replace(/\D/g, '');
      return [`${digit.slice(0, 6)}|${normalisasiNama(d.nama)}`, d];
    })
  );
  const cariDesa = (baris) =>
    desaByKode.get(baris.kode_desa) ||
    desaByKecNama.get(`${baris.kode_kecamatan}|${normalisasiNama(baris.nama_desa_sumber || '')}`) ||
    null;

  // Desa mana yang sudah punya aparatur? Menentukan "suntik langsung" vs "rekonsiliasi".
  const sudahPunya = await prisma.aparatur_desa.groupBy({ by: ['desa_id'], _count: { id: true } });
  const jumlahAparatur = new Map(sudahPunya.map((r) => [String(r.desa_id), r._count.id]));

  const ringkasan = {
    staging_baru: 0,
    staging_diperbarui: 0,
    dilewati_final: 0,
    otomatis: 0,
    sama: 0,
    ditambal: 0,
    konflik: 0,
    baru: 0,
    tanpa_desa: 0,
    gagal: 0,
  };
  const kodeTakDikenal = new Set();
  const gagal = [];

  // Cache aparatur per desa supaya tidak query berulang untuk desa yang sama.
  const cacheAparatur = new Map();
  const aparaturDesa = async (desaId) => {
    const kunci = String(desaId);
    if (!cacheAparatur.has(kunci)) {
      const daftar = await prisma.aparatur_desa.findMany({
        where: { desa_id: BigInt(kunci) },
        select: {
          id: true,
          nama_lengkap: true,
          jabatan: true,
          jenis_kelamin: true,
          pendidikan_terakhir: true,
          agama: true,
          nomor_sk_pengangkatan: true,
          tanggal_pengangkatan: true,
        },
      });
      cacheAparatur.set(
        kunci,
        daftar.map((a) => ({ ...a, normal: normalisasiNama(a.nama_lengkap), inti: namaInti(a.nama_lengkap) }))
      );
    }
    return cacheAparatur.get(kunci);
  };

  for (const b of baris) {
    try {
      const desa = cariDesa(b);
      const desaId = desa ? desa.id : null;
      if (!desa) kodeTakDikenal.add(`${b.kode_desa} (${b.nama_desa_sumber || '-'})`);

      const adaSebelumnya = await prisma.aparatur_dapur_desa.findUnique({
        where: { dapur_id: b.dapur_id },
        select: { id: true, status_rekonsiliasi: true },
      });

      if (adaSebelumnya && STATUS_FINAL.has(adaSebelumnya.status_rekonsiliasi)) {
        ringkasan.dilewati_final++;
        continue;
      }

      // Tentukan status rekonsiliasi.
      let status = 'baru';
      let aparaturId = null;
      let tambalan = null;

      if (!desaId) {
        status = 'tanpa_desa';
        ringkasan.tanpa_desa++;
      } else if ((jumlahAparatur.get(String(desaId)) || 0) === 0) {
        // Desa belum input apa pun → langsung disuntik.
        status = 'otomatis';
      } else {
        const daftar = await aparaturDesa(desaId);
        const cocok =
          daftar.find((a) => a.normal === b.nama_normal) ||
          daftar.find((a) => a.inti && a.inti === namaInti(b.nama));
        if (cocok) {
          aparaturId = cocok.id;
          // Kalau isinya sebenarnya sama (cuma beda huruf besar/kecil atau cara
          // menulis jenjang pendidikan), tidak ada yang perlu dipilih desa —
          // langsung dianggap selesai.
          const { beda, isian } = bandingkanDenganAparatur(b, cocok);
          status = beda.length === 0 ? 'sama' : 'konflik';
          // Kolom yang kosong di data desa ditambal dari arsip — itu menambal
          // lubang, bukan menimpa isian orang, jadi tidak perlu ditanyakan.
          if (status === 'sama' && Object.keys(isian).length > 0) tambalan = isian;
        }
      }

      if (DRY_RUN) {
        if (status === 'otomatis') ringkasan.otomatis++;
        else if (status === 'sama') ringkasan.sama++;
        else if (status === 'konflik') ringkasan.konflik++;
        else if (status === 'baru') ringkasan.baru++;
        if (adaSebelumnya) ringkasan.staging_diperbarui++;
        else ringkasan.staging_baru++;
        continue;
      }

      // Suntikan aparatur dan penandaan staging HARUS jadi satu paket. Kalau
      // aparatur terlanjur dibuat tapi baris staging gagal ditulis, impor ulang
      // akan melihat desa itu sudah berisi dan malah memunculkan konflik palsu
      // dengan record buatannya sendiri.
      const tulis = async (tx) => {
        let idAparatur = aparaturId;
        let dibuat = null;

        if (status === 'otomatis') {
          dibuat = await tx.aparatur_desa.create({
            data: { ...keAparaturDesa(b, desaId), created_at: new Date(), updated_at: new Date() },
          });
          idAparatur = dibuat.id;
        } else if (tambalan) {
          await tx.aparatur_desa.update({
            where: { id: idAparatur },
            data: { ...tambalan, dapur_id: b.dapur_id, updated_at: new Date() },
          });
        }

        const data = {
          ...b,
          desa_id: desaId ? BigInt(String(desaId)) : null,
          status_rekonsiliasi: status,
          // 'sama' tidak mengubah apa pun di data desa; hanya dicatat supaya tidak ditanyakan lagi.
          keputusan: status === 'sama' ? 'sama' : undefined,
          aparatur_desa_id: idAparatur,
          updated_at: new Date(),
        };

        await tx.aparatur_dapur_desa.upsert({
          where: { dapur_id: b.dapur_id },
          create: { ...data, created_at: new Date() },
          update: data,
        });

        return dibuat;
      };

      const dibuat =
        status === 'otomatis' || tambalan ? await prisma.$transaction(tulis) : await tulis(prisma);

      if (status === 'otomatis') {
        ringkasan.otomatis++;
        // Desa ini tidak lagi kosong, tapi record berikutnya dari desa yang sama
        // harus tetap ikut disuntik — jadi cache aparatur-nya yang diperbarui,
        // bukan penanda "sudah punya".
        if (cacheAparatur.has(String(desaId))) {
          cacheAparatur.get(String(desaId)).push({
            id: dibuat.id,
            nama_lengkap: dibuat.nama_lengkap,
            normal: normalisasiNama(dibuat.nama_lengkap),
            inti: namaInti(dibuat.nama_lengkap),
          });
        }
      } else if (status === 'sama') {
        ringkasan.sama++;
        if (tambalan) ringkasan.ditambal++;
      } else if (status === 'konflik') {
        ringkasan.konflik++;
      } else if (status === 'baru') {
        ringkasan.baru++;
      }

      if (adaSebelumnya) ringkasan.staging_diperbarui++;
      else ringkasan.staging_baru++;
    } catch (err) {
      ringkasan.gagal++;
      gagal.push({ dapur_id: b.dapur_id, nama: b.nama, pesan: err.message });
    }
  }

  console.log('────────────────────────────────────────');
  console.log(DRY_RUN ? '🔍 HASIL SIMULASI (tidak ada yang ditulis)' : '✅ IMPOR SELESAI');
  console.log('────────────────────────────────────────');
  console.log(`Baris staging baru        : ${ringkasan.staging_baru}`);
  console.log(`Baris staging diperbarui  : ${ringkasan.staging_diperbarui}`);
  console.log(`Dilewati (sudah final)    : ${ringkasan.dilewati_final}`);
  console.log('');
  console.log(`Disuntik otomatis         : ${ringkasan.otomatis}   (desa yang belum input apa pun)`);
  console.log(`Identik, selesai sendiri  : ${ringkasan.sama}   (isi sama / kolom kosong ditambal, tanpa tanya desa)`);
  console.log(`  di antaranya ditambal    : ${ringkasan.ditambal}   (kolom kosong di data desa diisi dari arsip)`);
  console.log(`Konflik menunggu desa     : ${ringkasan.konflik}   (nama sama, isi bisa beda)`);
  console.log(`Belum ada di data desa    : ${ringkasan.baru}   (desa bisa menambahkan)`);
  console.log(`Kode desa tidak dikenali  : ${ringkasan.tanpa_desa}`);
  console.log(`Gagal                     : ${ringkasan.gagal}`);
  console.log('────────────────────────────────────────\n');

  if (kodeTakDikenal.size) {
    console.log(`⚠️  ${kodeTakDikenal.size} kode desa tidak ada di tabel desas:`);
    [...kodeTakDikenal].slice(0, 20).forEach((k) => console.log(`   • ${k}`));
    if (kodeTakDikenal.size > 20) console.log(`   … dan ${kodeTakDikenal.size - 20} lainnya`);
    console.log('');
  }

  if (gagal.length) {
    console.log(`❌ ${gagal.length} record gagal:`);
    gagal.slice(0, 20).forEach((g) => console.log(`   • [${g.dapur_id}] ${g.nama}: ${g.pesan}`));
    console.log('');
  }

  if (DRY_RUN) {
    console.log('ℹ️  Ini simulasi. Jalankan ulang tanpa --dry-run untuk benar-benar menulis.\n');
  } else {
    console.log('ℹ️  Konflik & data baru menunggu keputusan desa di halaman Aparatur Desa.\n');
  }
}

main()
  .catch((error) => {
    console.error('❌ Impor gagal:', error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
