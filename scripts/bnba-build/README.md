# BNBA Build — Konversi Excel Desa → Template Import Pengurus Kelembagaan

Alat ini menggantikan `build_template_from_bnba.py` yang dulu dipakai untuk
menyiapkan file `output_template_pengurus_kelembagaan_*.xlsx`. Ditulis ulang di
Node supaya sejalan dengan importer yang ada (`scripts/import-output-template.js`
dan endpoint `POST /api/kelembagaan/pengurus/import`) dan tidak menambah
toolchain baru.

## Alur

```
File BNBA desa (.xlsx/.xls/.ods)
        │  node scripts/bnba-build/build-template.js
        ▼
output_template_pengurus_kelembagaan_<kecamatan>_<desa>.xlsx
        │  node scripts/bnba-build/validate-template.js   (opsional, cek dulu)
        ▼
Unggah di menu Import Pengurus Kelembagaan  ATAU
node scripts/import-output-template.js --workbook <file> --mode plan|apply
```

Format `.ods` **tidak** bisa diunggah lewat web (importer hanya menerima
`.xlsx`/`.xls`). Justru itu gunanya builder: ia membaca `.ods` dan menuliskan
hasilnya sebagai `.xlsx`.

## Perintah

```bash
# Konversi satu atau beberapa file BNBA
node scripts/bnba-build/build-template.js \
  --input "../DATA SELURUH LKD BARENGKOK FIX DESA BARENGKOK DPMD.ods" \
  --input "../BNBA Lembaga Desa Curug 2025.xlsx" \
  --out-dir ../hasil-template

# Template kosong siap isi manual (berisi petunjuk + daftar kode desa)
node scripts/bnba-build/build-template.js --blank --out-dir ../hasil-template

# Periksa hasil sebelum diunggah
node scripts/bnba-build/validate-template.js ../hasil-template/output_template_*.xlsx

# Segarkan daftar kode desa dari database (butuh DATABASE_URL)
node scripts/bnba-build/refresh-desa-reference.js
```

Opsi `build-template.js`:

| Opsi | Guna |
| --- | --- |
| `--input`, `-i` | File BNBA desa, boleh diulang. Satu file = satu desa = satu workbook hasil. |
| `--out-dir`, `-o` | Folder hasil (default: folder file sumber). |
| `--desa`, `--kecamatan` | Paksa nama wilayah bila kepala sheet tidak terbaca. |
| `--kode-desa` | Paksa kode desa, melewati pencocokan nama. |
| `--keep-other-desa` | Ikutkan baris yang kolom DESA-nya berbeda dari desa target (default: ditolak). |
| `--skip-sheet <nama>` | Abaikan satu sheet sumber, boleh diulang. Untuk file desa yang memuat dua versi daftar yang sama (mis. `RT_RW` versi baru dan `RTRW` versi lama). |
| `--report-file` | Tulis ringkasan + daftar penolakan ke JSON. |
| `--blank` | Buat template kosong, tanpa file sumber. |

## Isi workbook hasil

| Sheet | Keterangan |
| --- | --- |
| `00_INFO` | Metadata: desa, kode desa, jumlah baris per sheet, jumlah tolakan. Diabaikan importer. |
| `01_RTRW` … `07_LEMBAGA_LAINNYA` | Data yang dibaca importer. |
| `_DITOLAK` | Baris sumber yang tidak diikutkan, lengkap dengan alasannya. Diabaikan importer. |

Kolom berawalan `_` (`_sumber_sheet`, `_sumber_baris`, `_nomor_sk`,
`_jabatan_asli`, `_catatan`, …) adalah jejak asal data. Importer hanya membaca
kolom yang dikenalnya, jadi kolom ini aman dibiarkan dan sangat membantu saat
menelusuri baris bermasalah kembali ke file desa.

## Cara builder membaca file BNBA

- **Sheet dikenali dari namanya**, bukan urutannya: `RTRW`/`RT_RW`, `POSYANDU`,
  `KADER POSYANDU`/`KADER_POSYANDU`, `LPM`, `PKK`, `KATAR`/`KARTAR`/`KARANG TARUNA`,
  `LINMAS`. Sheet lain yang berformat BNBA masuk ke `07_LEMBAGA_LAINNYA`.
- **Kolom dikenali dari tulisan headernya**, bukan posisinya, sehingga file desa
  dengan jumlah kolom berbeda tetap terbaca. Header BNBA bertingkat dua
  (mis. `ALAMAT RUMAH` di atas `JALAN/GANG | RT | RW | DESA | KECAMATAN | KODE POS`);
  posisi label induk direkonstruksi dari lebar sel gabung — ini perlu karena pada
  file `.ods` label induk sering tergeser terhadap kolom datanya.
- **Format "Desk LKD"** (kepala tiga tingkat `IDENTITAS | DASAR PEMBENTUKAN |
  DASAR PENETAPAN | WILAYAH | JABATAN`) juga dikenali. Kolom JK `L`/`P` digabung,
  tanggal SK pengangkatan jadi `tanggal_mulai_jabatan` (atau `tanggal_akhir_jabatan`
  bila di masa depan), dan baris ketua RT yang tidak menulis nomor RW mewarisi RW
  dari baris ketua RW di atasnya. Judul sheetnya `DESA X - KECAMATAN Y`, jadi
  sertakan `--desa`/`--kecamatan`.
- **Desa & kecamatan** diambil dari sel `Desa/Kelurahan` / `Kecamatan` di kepala
  sheet, atau dari judul `NOMINATIF … DESA X` / `KECAMATAN Y`, lalu dicocokkan ke
  `desa-reference.json` untuk mendapat `kode_desa`. Nama desa yang ada di lebih
  dari satu kecamatan (mis. Curug, Barengkok) dibedakan lewat nama kecamatan.
- **RT/RW**: jenis wilayah diambil dari kolom penanda `RW`/`RT` di bawah `JABATAN`;
  bila desa hanya menuliskan penanda tanpa nomor, nomornya diambil dari kolom
  RT/RW alamat rumah (dicatat di `_catatan`).
- **Posyandu**: nama & alamat lembaga dari sheet `POSYANDU`, pengurusnya dari
  sheet `KADER POSYANDU`. Bila `NAMA KETUA POSYANDU` merujuk orang yang sudah ada
  di sheet kader, jabatannya dinaikkan jadi `KETUA POSYANDU` (bukan dibuat baris
  baru), sehingga NIK dan data pribadinya tidak hilang.
- **Nama lembaga LPM/Karang Taruna/PKK/Satlinmas** ditulis mengikuti rumus yang
  sama dengan importer (`LPM DESA <NAMA DESA>`, dst.) memakai nama desa dari
  database, supaya tidak muncul lembaga kembar dengan ejaan berbeda.

## Yang dinormalkan

| Kolom | Jadi |
| --- | --- |
| `jabatan` | Kosakata baku `dpmd-frontend/src/constants/jabatanMapping.js` (`KETUA` + sheet PKK → `KETUA PKK`, `KETUA` + penanda RW → `KETUA RW`, `ANGGOTA` di sheet kader → `KADER POSYANDU`, dst.). Jabatan di luar daftar tetap dipertahankan apa adanya dan dicatat di `_catatan`. |
| `tanggal_*` | `YYYY-MM-DD`. Menerima serial Excel, `dd-mm-yyyy`, `dd/mm/yyyy`, dan bentuk masa bhakti seperti `TH.2030`, `AGUSTUS 2030`, `2026` (→ akhir periode). |
| `pendidikan` | `SD, SMP, SMA/SMK, D1, D2, D3, S1, S2, S3` (`SLTP`→`SMP`, `SLTA`→`SMA/SMK`, `TAMAT SD`→`SD`, …). |
| `status_perkawinan` | `BELUM MENIKAH, MENIKAH, CERAI HIDUP, CERAI MATI` (`KAWIN`→`MENIKAH`, `TIDAK KAWIN`→`BELUM MENIKAH`). |
| `jenis_kelamin` | `L` / `P`. |
| `no_telepon` | Diseragamkan ke awalan `0` (`8558…`→`08558…`, `+62…`→`0…`). |
| `nik`, `nomor_rekening` | Ditulis sebagai teks agar nol depan tidak hilang. |
| `nomor_rw`, `nomor_rt`, `rt_rumah`, `rw_rumah` | 3 digit (`1`→`001`). |

Nilai yang tidak dikenali **dikosongkan, bukan ditebak**, dan alasannya ditulis
di `_catatan` baris itu.

## Baris yang ditolak

Semuanya tercatat di sheet `_DITOLAK` beserta sheet dan nomor baris asalnya:

- **Baris contoh bawaan format BNBA** — nama/NIK contoh yang ikut tersalin di
  hampir semua file desa.
- **Alamat desa berbeda dari desa target** — sisa data desa lain yang tertinggal
  di file. Pakai `--keep-other-desa` bila memang ada pengurus berdomisili di desa lain.
- **Blok daftar pilihan (dropdown)** — baris berisi `KETUA`/`SD`/`BJB`/`KAWIN`
  yang dipakai sebagai sumber validasi; tertolak karena jabatannya kosong.
- **RT/RW tanpa jenis atau nomor wilayah.**
- **Bentrok jabatan tunggal** — dua orang mengaku `KETUA RT 003/RW 001` yang sama.
  Yang pertama dipakai, sisanya ditolak dengan menyebut nama pemegang pertama.
  Ini muncul kalau file desa memuat dua versi daftar RT/RW (mis. sheet `RT_RW`
  dan `RTRW`) yang isinya berbeda. Kalau sudah jelas mana sheet yang berlaku,
  buang yang lain dengan `--skip-sheet` agar laporan penolakan bersih:

  ```bash
  node scripts/bnba-build/build-template.js \
    -i "../DATA SELURUH LKD BARENGKOK ... .ods" -o ../hasil-template --skip-sheet RTRW
  ```

## Pemeriksaan mutu tambahan

Builder membandingkan `tanggal_lahir` dengan tanggal yang tersandi di NIK
(digit 7–12) dan menulis catatan bila berbeda, termasuk membedakan kasus
"kemungkinan tertukar hari/bulan" — pola yang lazim muncul kalau file pernah
dikonversi antar aplikasi spreadsheet. Tanggal **tidak** diperbaiki otomatis;
keputusan mana yang benar ada di DPMD/desa.

## Perilaku import (tidak berubah)

- Baris baru masuk dengan `imported = true`.
- Baris lama yang bertanda `imported` akan diperbarui.
- Data yang diinput manual lewat web (`imported = false`) **tidak** ditimpa.

## Berkas

| Berkas | Isi |
| --- | --- |
| `build-template.js` | CLI konversi + pembuat template kosong. |
| `reader.js` | Pembacaan workbook, rekonstruksi header bertingkat, deteksi wilayah. |
| `mapping.js` | Kamus kolom, kosakata baku, normalizer nilai & jabatan. |
| `desa-reference.js` | Pencarian `kode_desa` dari nama desa + kecamatan. |
| `desa-reference.json` | 40 kecamatan, 435 desa/kelurahan. Segarkan lewat `refresh-desa-reference.js`. |
| `validate-template.js` | Cek workbook hasil memakai aturan baca importer. |
