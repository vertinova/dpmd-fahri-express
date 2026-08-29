# Impor data BUMDes dari CSV "Rekap data Keseluruhan BUM Desa"

Backup tabel `bumdes` di produksi, tambah kolom yang belum ada, lalu isi dari CSV.

Sudah dilatih penuh di salinan data produksi (dump 2026-07-07): 187 baris diperbarui,
229 ditambah, 416 total, `desa_id` kosong 0, dan seluruh 200 rujukan dokumen tetap utuh.

## Keputusan yang sudah diambil

| Hal | Keputusan |
|---|---|
| Mode | **gabung** — nilai CSV menang bila terisi; sel kosong di CSV **tidak** menghapus data lama |
| Kolom dokumen | Ceklis CSV (`v`) **tidak diimpor**. Berkas diunggah manual lewat akun pegawai SPKED |
| Kolom path file | Tidak pernah disentuh importer |
| Kecamatan/desa/kode | Diambil dari tabel `desas`/`kecamatans`, bukan teks KAPITAL di CSV |

Mode `gabung` dipilih karena penimpaan penuh akan mengosongkan **2.689 sel** yang
terisi di produksi tapi kosong di CSV (mis. 94 dari 179 Nama Penasihat, 110 dari
149 Ketapang2025, 104 dari 111 Bantuan Kemendesa).

## Berkas

| Berkas | Guna |
|---|---|
| `mapping.js` | Peta 125 kolom CSV → tabel `bumdes`. Sumber tunggal untuk DDL **dan** importer |
| `import-bumdes.js` | Cetak DDL, simulasi, dan jalankan impor |
| `backup-bumdes.sh` | Backup tabel `bumdes` (4 berkas) |
| `rollback-bumdes.sh` | Kembalikan tabel dari backup |
| `verifikasi.sql` | 10 pemeriksaan setelah impor |

## Urutan jalan di produksi

Berkas ini ada di repo backend, jadi cukup `git pull` di `/var/www/backend`.
CSV-nya dikirim dari laptop.

```bash
# --- dari laptop ---
scp "Rekap data Keseluruhan BUM Desa - Data Base BUM Desa.csv" \
    root@super-apps:/root/bumdes.csv

# --- di server ---
cd /var/www/backend && git pull
cd scripts/bumdes-import

# 1. BACKUP (wajib, sebelum apa pun)
bash backup-bumdes.sh

# 2. Kolom baru sudah dibuat otomatis oleh migrasi
#    migrations/20260827_add_bumdes_csv_columns.sql lewat auto-migrate saat
#    deploy. Langkah ini hanya perlu kalau menyiapkan server baru:
#      node import-bumdes.js --print-ddl > /root/alter_bumdes.sql

# 3. SIMULASI — tidak menulis apa pun
node import-bumdes.js --csv=/root/bumdes.csv --dry-run

# 4. IMPOR
node import-bumdes.js --csv=/root/bumdes.csv --mode=gabung

# 5. VERIFIKASI
mysql -h127.0.0.1 -udpmd_user -p dpmd < verifikasi.sql

# 6. Selaraskan Prisma dengan kolom baru, lalu muat ulang
cd /var/www/backend
npx prisma generate
pm2 restart dpmd-backend

# 7. Build ulang frontend (form desa & dashboard SPKED ikut berubah)
cd /var/www/frontend && npm run build && nginx -s reload
```

Kredensial dibaca sendiri dari `/var/www/backend/.env`, tidak perlu diketik.

`node` di server dikelola fnm dan TIDAK ada di PATH pada SSH non-interaktif.
Kalau menjalankan lewat `ssh <host> "..."`, sertakan dulu lintasannya:

```bash
export PATH=$PATH:/root/.local/share/fnm/node-versions/v20.20.0/installation/bin
```
Ganti dengan `--env=/path/lain` bila perlu.

## Kalau gagal

Importer memakai satu transaksi: kalau ada satu baris gagal, **seluruhnya
dibatalkan** dan tabel tidak berubah. Untuk kembali ke keadaan sebelum ALTER:

```bash
bash rollback-bumdes.sh /root/backup-bumdes/<stempel>/bumdes_struktur_data.sql.gz
```

## Yang perlu diperiksa manusia

Importer menulis `bumdes_anomali_<stempel>.csv` berisi nilai yang tidak bisa
dibaca sebagai angka. Kolomnya diisi `NULL`, **tidak ditebak**. Perbaiki di
sheet lalu jalankan ulang — mode `gabung` aman diulang.

Dari CSV versi 2026-08-27 tersisa **11 anomali** (sebelumnya 16; sebagian sudah
dibetulkan di sheet):

- Balekambang: `Laba2024`, `Omset2025`, `Laba2025` tertulis ±Rp 16.270 **triliun**
  (melebihi kapasitas `DECIMAL(15,2)`, hampir pasti salah ketik)
- Cariu, Cihowe: kontribusi PADes ditulis "2.000.000/bulan", "2 Jt Perbulan"
- Pamijahan, Karehkel: modal awal ditulis sebagai kalimat
- Pamijahan, Semplak Barat: `NilaiAset` ditulis kalimat / "10 unit kios"
- Mekarsari: `AnggaranModalKetahananPangan` = "171.35" (ambigu ribuan vs desimal)

## Catatan lanjutan

1. **Halaman desa & SPKED sudah ikut disinkronkan** dalam perubahan yang sama:
   skema Prisma tahu 74 kolom baru, controller memakai daftar-izin bersama
   (`src/config/bumdesFields.js`), form desa memakai nama kolom yang benar,
   dan perbandingan status memakai `src/utils/bumdesStatus.js`. Karena itu
   langkah 6 pada runbook di atas WAJIB menyertakan `npx prisma generate`
   dan build ulang frontend.

2. **Ukuran baris tabel** setelah ALTER kira-kira 49.700 dari batas 65.535 byte
   (149 kolom). Penambahan kolom berikutnya sebaiknya bertipe `TEXT`.

## Menjalankan di laptop (Laragon)

Sama persis, hanya kredensial dan lintasan yang berbeda — `--env` menunjuk `.env`
lokal, dan `mysql`/`mysqldump` Laragon perlu ditambahkan ke PATH.

```bash
export PATH=$PATH:/c/laragon/bin/mysql/mysql-8.0.30-winx64/bin
cd /d/dpmd/dpmd-fahri-express

# 1. Backup
ENV_FILE="$PWD/.env" DEST_ROOT=/c/Users/ACER/backup-bumdes bash scripts/bumdes-import/backup-bumdes.sh

# 2. Kolom baru (sekali saja; di lokal tidak ada auto-migrate)
mysql -h127.0.0.1 -uroot dpmd < migrations/20260827_add_bumdes_csv_columns.sql

# 3. Simulasi, lalu impor
node scripts/bumdes-import/import-bumdes.js --csv="D:/dpmd/Rekap data Keseluruhan BUM Desa - Data Base BUM Desa.csv" --env="$PWD/.env" --dry-run
node scripts/bumdes-import/import-bumdes.js --csv="D:/dpmd/Rekap data Keseluruhan BUM Desa - Data Base BUM Desa.csv" --env="$PWD/.env" --mode=gabung

# 4. Verifikasi + segarkan Prisma
mysql -h127.0.0.1 -uroot dpmd < scripts/bumdes-import/verifikasi.sql
npx prisma generate
```

Dijalankan 2026-08-29 di Laragon: 187 diperbarui, 229 ditambah, 416 total,
`desa_id` kosong 0, 200 dokumen lama utuh, 11 anomali.
