#!/usr/bin/env node
/**
 * Impor "Rekap data Keseluruhan BUM Desa" (CSV ekspor Google Sheets) ke tabel `bumdes`.
 *
 * Pemakaian:
 *   node import-bumdes.js --print-ddl                  # cetak ALTER TABLE kolom baru
 *   node import-bumdes.js --csv=FILE --dry-run         # simulasi, tidak menulis apa pun
 *   node import-bumdes.js --csv=FILE --mode=gabung     # tulis (default)
 *   node import-bumdes.js --csv=FILE --mode=timpa      # tulis, kolom kosong CSV ikut mengosongkan
 *
 * Dua mode, karena CSV LEBIH LUAS (416 desa) tapi LEBIH DANGKAL pada baris yang
 * sudah diisi desa lewat aplikasi:
 *   gabung : nilai CSV menang bila terisi; sel CSV yang kosong TIDAK menghapus
 *            data lama. Aman, tidak ada yang hilang.
 *   timpa  : baris yang ada di CSV disamakan persis dengan CSV; sel kosong di
 *            CSV mengosongkan kolomnya. Menghapus ~2.689 sel yang terisi di
 *            produksi tapi kosong di CSV.
 *
 * Yang TIDAK PERNAH disentuh mode mana pun: kolom path file dokumen dan relasi
 * produk hukum (lihat KOLOM_DIPERTAHANKAN di mapping.js). Di CSV, kolom dokumen
 * berisi ceklis "v", bukan nama berkas; menulisnya ke kolom path akan memutus
 * dokumen yang sudah diunggah desa.
 */

const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
const { PETA, KOLOM_DIPERTAHANKAN, PETA_BADAN_HUKUM, BADAN_HUKUM_KOSONG } = require('./mapping');
const { bacaAngka } = require('../../src/config/bumdesFields');

// ---------------------------------------------------------------- argumen ----
const arg = (nama, bawaan = null) => {
  const found = process.argv.find((a) => a.startsWith(`--${nama}=`));
  return found ? found.slice(nama.length + 3) : bawaan;
};
const punya = (nama) => process.argv.includes(`--${nama}`);

const MODE = arg('mode', 'gabung');
const DRY_RUN = punya('dry-run');
const CSV_PATH = arg('csv');
const ENV_PATH = arg('env', '/var/www/backend/.env');
const OUT_DIR = arg('out', process.cwd());

if (!['gabung', 'timpa'].includes(MODE)) {
  console.error(`mode tidak dikenal: ${MODE} (pakai gabung atau timpa)`);
  process.exit(1);
}

// ------------------------------------------------------------------- DDL ----
const cetakDDL = () => {
  const baru = PETA.filter((p) => p.ddl);
  console.log('-- Kolom baru untuk tabel `bumdes`, diturunkan dari mapping.js.');
  console.log(`-- ${baru.length} kolom. Jalankan SEKALI, setelah backup.`);
  console.log('ALTER TABLE `bumdes`');
  console.log(
    baru.map((p) => `  ADD COLUMN \`${p.col}\` ${p.ddl} NULL`).join(',\n') + ';'
  );
};

if (punya('print-ddl')) {
  cetakDDL();
  process.exit(0);
}

// ------------------------------------------------------------- parser CSV ----
const parseCSV = (text) => {
  const rows = [];
  let row = [];
  let field = '';
  let inQuote = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuote) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else inQuote = false;
      } else field += c;
    } else if (c === '"') inQuote = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\r') { /* abaikan */ }
    else if (c === '\n') { row.push(field); field = ''; rows.push(row); row = []; }
    else field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
};

// -------------------------------------------------------------- pembaca ----
const KOSONG = new Set(['', '#n/a', 'n/a']);

/** Teks: "#N/A" dianggap tidak terisi. Tanda "-" DIPERTAHANKAN (artinya "tidak ada"). */
const bacaTeks = (raw) => {
  const v = String(raw ?? "").trim();
  return KOSONG.has(v.toLowerCase()) ? null : v;
};

// Pembacaan angka dipakai bersama dengan API (src/config/bumdesFields.js),
// supaya aturan "Rp 1.500.000", "50 juta", "(50.000)", dan penolakan nilai
// ambigu tidak bisa berbeda antara impor CSV dan penyimpanan lewat form.
//
// desimalDiizinkan:false — saat impor, dua kelompok angka seperti "171.35"
// ambigu (171,35 atau 171 juta?) sehingga ditolak dan dilaporkan, bukan ditebak.
const bacaAngkaCSV = (raw, bulat = false) => {
  const v = bacaTeks(raw);
  if (v === null) return { ok: true, nilai: null };
  return bacaAngka(v, { bulat, desimalDiizinkan: false });
};

const bacaBulat = (raw) => bacaAngkaCSV(raw, true);
const bacaUang = (raw) => bacaAngkaCSV(raw, false);

/** Status: pakai kolom 2025; bila kosong, jatuh ke kolom 2024. */
const bacaStatus = (s2025, s2024) => {
  const pilih = (bacaTeks(s2025) || bacaTeks(s2024) || '').toLowerCase();
  if (pilih === 'aktif') return 'aktif';
  if (pilih === 'tidak aktif') return 'tidak aktif';
  return null;
};

const bacaBadanHukum = (raw) => {
  const v = bacaTeks(raw);
  if (v === null) return BADAN_HUKUM_KOSONG;
  return PETA_BADAN_HUKUM[v.toLowerCase()] || v;
};

// ------------------------------------------------------------------ .env ----
const bacaEnv = (file) => {
  const isi = fs.readFileSync(file, 'utf8');
  const out = {};
  for (const baris of isi.split('\n')) {
    const m = baris.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  return out;
};

const konfigDB = (env) => {
  if (env.DATABASE_URL) {
    // connection_limit dsb. milik Prisma; mysql2 tidak mengenalnya -> dibuang.
    const u = new URL(env.DATABASE_URL);
    return {
      host: u.hostname,
      port: Number(u.port || 3306),
      user: decodeURIComponent(u.username),
      password: decodeURIComponent(u.password),
      database: u.pathname.replace(/^\//, ''),
    };
  }
  return {
    host: env.DB_HOST || '127.0.0.1',
    port: Number(env.DB_PORT || 3306),
    user: env.DB_USER,
    password: env.DB_PASSWORD || '',
    database: env.DB_NAME,
  };
};

// ------------------------------------------------------------------ main ----
const main = async () => {
  if (!CSV_PATH) {
    console.error('wajib: --csv=/path/ke/file.csv');
    process.exit(1);
  }

  const rows = parseCSV(fs.readFileSync(CSV_PATH, 'utf8'));
  // Baris 0 judul, 1 grup, 2 header, 3 nomor kolom, 4.. data.
  const data = rows.slice(4).filter((r) => (r[2] || '').trim() !== '');
  console.log(`CSV     : ${CSV_PATH}`);
  console.log(`baris   : ${data.length}`);
  console.log(`mode    : ${MODE}${DRY_RUN ? ' (DRY RUN — tidak menulis)' : ''}`);

  const env = bacaEnv(ENV_PATH);
  const conn = await mysql.createConnection({ ...konfigDB(env), multipleStatements: false });
  console.log(`database: ${konfigDB(env).database} @ ${konfigDB(env).host}`);

  // Kolom yang benar-benar ada di tabel sekarang — penjaga kalau ALTER belum jalan.
  const [kolomDB] = await conn.query(
    'SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?',
    ['bumdes']
  );
  const adaKolom = new Set(kolomDB.map((r) => r.COLUMN_NAME));
  const belumAda = PETA.filter((p) => !adaKolom.has(p.col)).map((p) => p.col);
  if (belumAda.length) {
    console.error(`\nBATAL: ${belumAda.length} kolom belum ada di tabel bumdes.`);
    console.error('Jalankan dulu ALTER TABLE dari: node import-bumdes.js --print-ddl');
    console.error('Kolom kurang: ' + belumAda.join(', '));
    await conn.end();
    process.exit(1);
  }

  // Peta desa: kode tanpa titik -> {id, kode asli, nama desa, nama kecamatan}
  const [desas] = await conn.query(
    `SELECT d.id, d.kode, d.nama AS nama_desa, k.nama AS nama_kecamatan
     FROM desas d JOIN kecamatans k ON k.id = d.kecamatan_id`
  );
  const petaDesa = new Map(
    desas.map((d) => [String(d.kode).replace(/\./g, ''), d])
  );

  // Baris bumdes yang sudah ada, dikunci pada kode tanpa titik.
  const [adaRows] = await conn.query('SELECT * FROM bumdes');
  const petaAda = new Map(
    adaRows.map((r) => [String(r.kode_desa || '').replace(/\./g, ''), r])
  );
  console.log(`baris bumdes di DB saat ini: ${adaRows.length}`);

  const anomali = [];
  const tanpaDesa = [];
  let jmlUpdate = 0;
  let jmlInsert = 0;
  let selDiisi = 0;
  let selDikosongkan = 0;

  if (!DRY_RUN) await conn.beginTransaction();

  try {
    for (const r of data) {
      const kodePolos = (r[2] || '').trim();
      const desa = petaDesa.get(kodePolos);
      if (!desa) {
        tanpaDesa.push({ kode: kodePolos, nama: r[5] });
        continue;
      }

      const lama = petaAda.get(kodePolos) || null;
      const nilai = {};

      // Identitas selalu dari tabel desas (kanonik), bukan dari teks CSV yang
      // KAPITAL SEMUA — supaya pengelompokan per kecamatan tidak pecah dua.
      nilai.desa_id = Number(desa.id);
      nilai.kode_desa = desa.kode;
      nilai.kecamatan = desa.nama_kecamatan;
      nilai.desa = desa.nama_desa;

      for (const p of PETA) {
        let v;
        if (p.tipe === 'enum') {
          v = bacaStatus(r[8], r[6]);
        } else if (p.tipe === 'uang') {
          const hasil = bacaUang(r[p.csv]);
          if (!hasil.ok) {
            anomali.push({
              kode_desa: desa.kode,
              desa: desa.nama_desa,
              kolom: p.col,
              nilai_mentah: String(r[p.csv] ?? '').replace(/\s+/g, ' ').trim(),
            });
          }
          v = hasil.nilai;
        } else if (p.tipe === 'bulat') {
          const hasil = bacaBulat(r[p.csv]);
          if (!hasil.ok) {
            anomali.push({
              kode_desa: desa.kode,
              desa: desa.nama_desa,
              kolom: p.col,
              nilai_mentah: String(r[p.csv] ?? '').replace(/\s+/g, ' ').trim(),
            });
          }
          v = hasil.nilai;
        } else {
          v = bacaTeks(r[p.csv]);
        }

        if (v === null && MODE === 'gabung') continue; // biarkan nilai lama
        if (v === null && lama) {
          const sebelum = lama[p.col];
          if (sebelum !== null && sebelum !== undefined && String(sebelum) !== '') {
            selDikosongkan++;
          }
        }
        if (v !== null) selDiisi++;
        nilai[p.col] = v;
      }

      // badanhukum: kosakata dashboard, diturunkan dari kolom status BH 2026.
      // Bila CSV kosong, nilai lama yang sudah terisi dipertahankan (mode
      // gabung), tapi baris yang memang belum punya nilai diisi "Belum
      // Melakukan Proses" — supaya tidak ada baris yang jatuh di luar keempat
      // kelompok yang dihitung dashboard.
      const bh = bacaBadanHukum(r[24]);
      const bhLama = String((lama && lama.badanhukum) || '').trim();
      if (bh !== BADAN_HUKUM_KOSONG || MODE === 'timpa' || bhLama === '') {
        nilai.badanhukum = bh;
      }

      // Kolom path dokumen & relasi produk hukum: tidak pernah ditulis.
      for (const k of KOLOM_DIPERTAHANKAN) delete nilai[k];

      const kolom = Object.keys(nilai);
      if (lama) {
        if (!DRY_RUN) {
          await conn.execute(
            `UPDATE bumdes SET ${kolom.map((k) => `\`${k}\` = ?`).join(', ')}, updated_at = NOW() WHERE id = ?`,
            [...kolom.map((k) => nilai[k]), lama.id]
          );
        }
        jmlUpdate++;
      } else {
        if (!nilai.namabumdesa) nilai.namabumdesa = `BUM DESA ${desa.nama_desa}`;
        if (!nilai.status) nilai.status = 'aktif';
        const k2 = Object.keys(nilai);
        if (!DRY_RUN) {
          await conn.execute(
            `INSERT INTO bumdes (${k2.map((k) => `\`${k}\``).join(', ')}, created_at, updated_at)
             VALUES (${k2.map(() => '?').join(', ')}, NOW(), NOW())`,
            k2.map((k) => nilai[k])
          );
        }
        jmlInsert++;
      }
    }

    if (!DRY_RUN) await conn.commit();
  } catch (err) {
    if (!DRY_RUN) await conn.rollback();
    console.error('\nGAGAL — transaksi dibatalkan, database tidak berubah.');
    console.error(err.message);
    await conn.end();
    process.exit(1);
  }

  // ------------------------------------------------------------- laporan ----
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '');
  if (anomali.length) {
    const file = path.join(OUT_DIR, `bumdes_anomali_${stamp}.csv`);
    fs.writeFileSync(
      file,
      'kode_desa,desa,kolom,nilai_mentah\n' +
        anomali
          .map((a) => [a.kode_desa, a.desa, a.kolom, a.nilai_mentah]
            .map((x) => `"${String(x).replace(/"/g, '""')}"`).join(','))
          .join('\n'),
      'utf8'
    );
    console.log(`\nanomali : ${anomali.length} nilai tidak terbaca -> ${file}`);
    console.log('          (kolom itu diisi NULL; perbaiki di sheet lalu jalankan ulang)');
  }
  if (tanpaDesa.length) {
    console.log(`\nkode desa tak dikenal: ${tanpaDesa.length}`);
    tanpaDesa.slice(0, 20).forEach((t) => console.log(`   ${t.kode}  ${t.nama}`));
  }

  const [[cek]] = await conn.query(
    'SELECT COUNT(*) AS total, SUM(desa_id IS NULL) AS tanpa_desa_id FROM bumdes'
  );

  console.log('\n---------------- RINGKASAN ----------------');
  console.log(`baris diperbarui : ${jmlUpdate}`);
  console.log(`baris ditambah   : ${jmlInsert}`);
  console.log(`sel diisi        : ${selDiisi}`);
  if (MODE === 'timpa') console.log(`sel dikosongkan  : ${selDikosongkan}`);
  console.log(`total baris kini : ${cek.total}`);
  console.log(`desa_id kosong   : ${cek.tanpa_desa_id}`);
  if (DRY_RUN) console.log('\nDRY RUN — tidak ada perubahan yang ditulis.');

  await conn.end();
};

// Diekspos untuk pengujian pembacaan nilai tanpa perlu koneksi database.
module.exports = { bacaUang, bacaBulat, bacaTeks, bacaStatus, bacaBadanHukum, parseCSV };

if (require.main === module) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
