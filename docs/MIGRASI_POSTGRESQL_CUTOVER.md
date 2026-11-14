# Runbook cutover MySQL → PostgreSQL (backend DPMD)

Dokumen ini untuk tim IT yang menjalankan perpindahan basis data produksi. Kode backend sudah
berjalan di kedua dialek: dialek dipilih dari `DATABASE_URL` di `.env` (`mysql://…` atau
`postgresql://…`). Selama `.env` masih MySQL, perilaku aplikasi sama persis dengan sebelumnya.

## Ringkasan

| Tahap | Kapan | Downtime | Bisa dibatalkan |
|---|---|---|---|
| 1. Siapkan server PostgreSQL 17 (CT 109) | kapan saja | tidak | ya |
| 2. Gladi: salin data produksi ke DB uji di CT 109 | jam kerja sepi | tidak | ya |
| 3. Cutover: hentikan backend, salin final, ganti `.env` | malam, ±30 menit | ya | ya, sebelum dibuka lagi |
| 4. Pasca-cutover: backup pg_dump, pantau | 14 hari | tidak | lihat bagian Rollback |

Selama tahap 1–3: **bekukan perubahan skema** (jangan menambah berkas `migrations/*.sql`).
Setelah cutover, migrasi baru ditulis dalam SQL PostgreSQL.

## Tahap 1 — Server PostgreSQL 17 (CT 109)

1. Buat CT Debian 12 baru (CT 109, IP di 172.168.20.0/24, mis. `172.168.20.109`), 4 vCPU, 8 GB RAM,
   disk 40 GB, masuk jadwal vzdump harian.
2. Pasang PostgreSQL 17 dari repo PGDG:
   ```bash
   apt install -y curl ca-certificates
   install -d /usr/share/postgresql-common/pgdg
   curl -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc --fail https://www.postgresql.org/media/keys/ACCC4CF8.asc
   echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] https://apt.postgresql.org/pub/repos/apt bookworm-pgdg main" > /etc/apt/sources.list.d/pgdg.list
   apt update && apt install -y postgresql-17
   ```
3. `/etc/postgresql/17/main/postgresql.conf`:
   ```
   listen_addresses = 'localhost,172.168.20.109'
   timezone = 'UTC'
   log_timezone = 'UTC'
   shared_buffers = 2GB
   max_connections = 100
   log_min_duration_statement = 1000
   ```
   `/etc/postgresql/17/main/pg_hba.conf` (hanya CT 100 yang boleh masuk lewat jaringan):
   ```
   host  dpmd  dpmd     172.168.20.21/32  scram-sha-256
   host  dpmd  gema_ro  172.168.20.21/32  scram-sha-256
   # SEMENTARA untuk gladi & cutover (salin-data butuh superuser); hapus setelah Tahap 3 selesai:
   host  all   postgres 172.168.20.21/32  scram-sha-256
   ```
   Beri sandi superuser: `sudo -u postgres psql -c "\password postgres"`. Lalu `systemctl restart postgresql`.
4. Peran dan basis data (sandi buat baru, simpan di pengelola sandi, jangan di repo):
   ```sql
   CREATE ROLE dpmd LOGIN PASSWORD '<sandi-app>';
   CREATE ROLE gema_ro LOGIN PASSWORD '<sandi-gema>';
   ```
   Basis data dibuat di Tahap 3 (dan di Tahap 2 untuk gladi) dengan:
   ```bash
   sudo -u postgres createdb -T template0 -E UTF8 --locale-provider=icu --icu-locale=und --locale=C.UTF-8 -O dpmd <nama_db>
   sudo -u postgres psql -c "ALTER DATABASE <nama_db> SET timezone TO 'UTC'"
   sudo -u postgres psql -v ON_ERROR_STOP=1 -d <nama_db> -f /var/www/backend/prisma/postgres/baseline.sql
   sudo -u postgres psql -v ON_ERROR_STOP=1 -Atd <nama_db> -f /var/www/backend/scripts/pg/alih-pemilik.sql   # harus mencetak milik_postgres_sisa=0
   ```
   Catatan: `REASSIGN OWNED BY postgres` ditolak PostgreSQL (objek milik superuser bawaan), maka
   pemilik dialihkan per objek. Ekstensi citext dan operatornya tetap milik postgres, itu wajar.
   Berkas di `/var/www/backend` (atau `/root`) tidak terbaca user postgres: salin dulu ke `/tmp`.
5. Di CT 100 pasang klien PG 17 (untuk backup pg_dump dan psql): `apt install -y postgresql-client-17`
   (repo PGDG yang sama), lalu isi `PG_DUMP_PATH=/usr/lib/postgresql/17/bin/pg_dump` dan
   `PG_DUMP_BIN=/usr/lib/postgresql/17/bin/pg_dump` di `.env` backend (belum dipakai sebelum cutover).

## Tahap 2 — Gladi (tanpa downtime)

Di CT 100, dari `/var/www/backend` (kode versi dua dialek sudah ter-deploy):

1. Pemeriksaan skema produksi vs baseline (baca saja di MySQL):
   ```bash
   createdb … dpmd_gladi   # langkah Tahap 1 butir 4 dengan <nama_db>=dpmd_gladi
   node scripts/pg/cek-skema.js "mysql://<user>:<sandi>@127.0.0.1:3306/dpmd" "postgresql://postgres:<sandi>@172.168.20.109:5432/dpmd_gladi"
   ```
   Wajib `fatal=0`. Bila ada kolom produksi yang tidak punya tempat di PG, BERHENTI: skema harus
   dibangkitkan ulang (`node scripts/pg/buat-skema-pg.js` terhadap salinan skema produksi) sebelum lanjut.
2. Salin data produksi ke DB gladi (MySQL hanya dibaca, satu snapshot konsisten):
   ```bash
   node scripts/pg/salin-data.js --mysql "mysql://…/dpmd" --pg "postgresql://postgres:<sandi>@172.168.20.109:5432/dpmd_gladi"
   ```
   Wajib exit 0: jumlah baris dan checksum per baris semua tabel identik. Catat lamanya (data lokal
   529 ribu baris: ±30 detik).
3. Opsional tetapi disarankan: jalankan backend kedua di port lain menunjuk ke `dpmd_gladi` dan
   buka beberapa halaman utama sebagai pembanding.
4. Hapus DB gladi: `sudo -u postgres dropdb dpmd_gladi`.

## Tahap 3 — Cutover (downtime ±30 menit)

1. Umumkan jadwal pemeliharaan. Matikan webhook deploy agar tidak ada deploy di tengah jalan:
   `pm2 stop github-webhook`.
2. Hentikan backend: `pm2 stop dpmd-backend`. Pastikan tidak ada penulis lain ke MySQL `dpmd`
   (cctv-ai, cron): `SHOW PROCESSLIST` hanya berisi sesi Anda.
3. Cadangan terakhir MySQL: `/usr/local/bin/dpmd-mysqldump > /root/dpmd-sebelum-pg-$(date +%F).sql`
   (simpan juga di `/mnt/backup`).
4. Buat DB `dpmd` di CT 109 (Tahap 1 butir 4), lalu salin:
   ```bash
   node scripts/pg/salin-data.js --mysql "mysql://…/dpmd" --pg "postgresql://postgres:<sandi>@172.168.20.109:5432/dpmd"
   ```
   Hanya lanjut bila exit 0. Bila gagal: perbaiki penyebab, `dropdb dpmd`, ulangi. MySQL tidak tersentuh.
   Lalu perbarui statistik planner (tanpa ini rencana kueri awal buruk dan jumlah baris di menu
   Pengaturan tampil 0): `sudo -u postgres psql -d dpmd -c "ANALYZE"`.
5. Hak akses peran aplikasi dan Gema:
   ```sql
   -- di DB dpmd sebagai postgres (pemilik tabel sudah dpmd sejak butir 4 via alih-pemilik.sql)
   GRANT CONNECT ON DATABASE dpmd TO gema_ro;
   GRANT USAGE ON SCHEMA public TO gema_ro;
   ```
   Tabel yang boleh dibaca Gema = kunci katalog Gema (sama dengan GRANT gema_ro di MySQL):
   ```bash
   node -e "console.log(Object.keys(require('./src/config/gemaKatalog').KATALOG).map(t => 'GRANT SELECT ON \"' + t + '\" TO gema_ro;').join('\n'))" > /tmp/grant-gema.sql
   sudo -u postgres psql -v ON_ERROR_STOP=1 -d dpmd -f /tmp/grant-gema.sql   # jalankan di CT 109 (salin berkasnya)
   ```
6. Ubah `/var/www/backend/.env` (simpan salinan `.env.mysql`):
   ```
   DATABASE_URL=postgresql://dpmd:<sandi-app>@172.168.20.109:5432/dpmd?schema=public
   GEMA_DB_URL=postgresql://gema_ro:<sandi-gema>@172.168.20.109:5432/dpmd
   ```
   Variabel `DB_HOST/DB_PORT/DB_USER/DB_PASSWORD/DB_NAME` tidak dipakai jalur PG; biarkan untuk rollback.
7. Bangkitkan client Prisma PG lalu nyalakan backend:
   ```bash
   cd /var/www/backend && node scripts/pg/generate-prisma.js   # mencetak skema prisma/postgres/schema.prisma
   pm2 start ecosystem.config.js
   ```
   Log harus memuat "Database connection established" dan "Prisma Client connected", tanpa galat.
8. Uji asap (sebelum diumumkan selesai): login pegawai (2FA), login desa, dasbor Core, daftar
   proposal Bankeu (desa/kecamatan/dinas), kelembagaan desa, helpdesk, Gema (satu pertanyaan
   `kueri_data`), backup database dari menu Pengaturan (harus mengunduh .sql pg_dump).
9. Nyalakan lagi webhook: `pm2 start github-webhook`. Deploy berikutnya otomatis membangkitkan
   client PG karena `generate-prisma.js` membaca `.env`.
10. Ganti cron backup host (`/usr/local/bin/backup-mysql-dpmd.sh`) ke pg_dump:
    `pg_dump -h 172.168.20.109 -U dpmd -Fc dpmd > /mnt/backup/pg-dpmd/dpmd-$(date +%F).dump`
    (sandi lewat `~/.pgpass`), simpan 14 hari. Uji pulihkan sekali ke DB sementara.
11. Hapus baris `postgres` sementara dari `pg_hba.conf` CT 109, lalu `systemctl reload postgresql`.

## Rollback

- **Sebelum backend dibuka lagi (langkah 8 gagal):** kembalikan `.env.mysql` → `.env`,
  `node scripts/pg/generate-prisma.js` (kini membangkitkan client MySQL), `pm2 restart dpmd-backend`.
  Tidak ada data yang hilang karena MySQL tidak menerima tulisan sejak langkah 2.
- **Sesudah dibuka dan ada tulisan baru di PostgreSQL:** MySQL sudah tertinggal. Jangan kembali
  ke MySQL tanpa memindahkan data baru; putuskan go/no-go dalam satu jam pertama. MySQL `dpmd`
  dibiarkan utuh (baca saja) minimal 14 hari sebagai arsip.

## Perbedaan perilaku yang diketahui (diterima)

- Teks tak peka huruf memakai `citext`: sama dengan MySQL untuk huruf besar/kecil, tetapi **peka
  aksen** (`é` ≠ `e`) dan **tidak mengabaikan spasi di akhir** (MySQL `unicode_ci` mengabaikannya).
- `GROUP_CONCAT` MySQL terpotong 1024 karakter; `STRING_AGG` PostgreSQL tidak.
- Informasi server di menu Manajemen Server: beberapa angka khas MySQL (slow query, traffic,
  lock wait) bernilai 0 di PostgreSQL.
- Status `bankeu_perubahan_lpj` "approved" di peta infrastruktur tetap tidak pernah dianggap
  selesai (bug lama, perilaku dipertahankan).
- Baris dengan nilai kembar pada kolom pengurutan: di PostgreSQL urutannya dipastikan menurut id
  (searah urutan terakhir) untuk kueri Prisma; di MySQL urutan itu tidak dijamin. Tampilan bisa sedikit berbeda.
- Kolom `INT UNSIGNED` di SQL mentah (mis. `file_size` proposal di halaman dinas) keluar sebagai
  angka di PostgreSQL, bukan teks; frontend memprosesnya secara aritmetika sehingga tidak berdampak.

## Berkas terkait

- `prisma/postgres/schema.prisma`, `prisma/postgres/baseline.sql` — dibangkitkan oleh
  `scripts/pg/buat-skema-pg.js` dari `prisma/schema.prisma` + skema MySQL. Jangan disunting manual.
- `scripts/pg/cek-skema.js` — pembanding skema MySQL vs PG.
- `scripts/pg/salin-data.js` — penyalin + verifikasi checksum (`--hanya-verifikasi` untuk cek ulang).
- `scripts/pg/generate-prisma.js` — memilih skema Prisma dari `DATABASE_URL`.
- `src/config/dialek.js`, `src/config/database.js`, `src/config/prismaPg.js` — lapisan dua dialek.
