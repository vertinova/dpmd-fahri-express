-- Drive per bidang: penyimpanan berkas internal DPMD.
--
-- Berbeda dari modul unggahan lain yang menaruh berkas di `storage/uploads/`
-- (disajikan express.static TANPA autentikasi), berkas Drive disimpan di
-- `storage/private/drive/` dan hanya bisa diambil lewat controller yang
-- memeriksa izin. Tanpa itu, penguncian per bidang cuma hiasan di UI karena
-- siapa pun yang tahu URL-nya bisa mengunduh.
--
-- Semua statement dibungkus IF NOT EXISTS supaya idempoten: runner mengirim
-- file ini sebagai SATU batch, jadi CREATE yang gagal karena objeknya sudah ada
-- akan menghentikan statement di bawahnya.

-- ============================================================
-- 1. Folder
-- ============================================================
-- Folder bertingkat lewat `parent_id`. Kolom `jalur` menyimpan lintasan id
-- leluhur ("/3/17/") supaya subpohon bisa diambil dengan satu LIKE, tanpa
-- rekursi bolak-balik ke database saat membuka folder dalam.
CREATE TABLE IF NOT EXISTS `drive_folder` (
  `id`          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `bidang_id`   BIGINT UNSIGNED NOT NULL,
  `parent_id`   BIGINT UNSIGNED NULL DEFAULT NULL,
  `nama`        VARCHAR(255) NOT NULL,
  -- Lintasan id leluhur, diakhiri garis miring. Folder akar = '/'.
  `jalur`       VARCHAR(1000) NOT NULL DEFAULT '/',
  `created_by`  BIGINT UNSIGNED NULL DEFAULT NULL,
  `updated_by`  BIGINT UNSIGNED NULL DEFAULT NULL,
  `created_at`  TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`  TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  -- Soft delete: masuk sampah dulu, dibersihkan setelah 30 hari.
  `deleted_at`  TIMESTAMP NULL DEFAULT NULL,
  `deleted_by`  BIGINT UNSIGNED NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_drive_folder_bidang` (`bidang_id`, `parent_id`, `deleted_at`),
  KEY `idx_drive_folder_jalur` (`bidang_id`, `jalur`(255)),
  KEY `idx_drive_folder_sampah` (`deleted_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- 2. Berkas
-- ============================================================
CREATE TABLE IF NOT EXISTS `drive_file` (
  `id`            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `bidang_id`     BIGINT UNSIGNED NOT NULL,
  -- NULL = berada di akar drive bidang.
  `folder_id`     BIGINT UNSIGNED NULL DEFAULT NULL,
  -- Nama yang dilihat pengguna; boleh diubah tanpa menyentuh berkas di disk.
  `nama`          VARCHAR(255) NOT NULL,
  -- Nama asli saat diunggah, disimpan untuk jejak.
  `nama_asli`     VARCHAR(255) NOT NULL,
  `mime`          VARCHAR(150) NULL DEFAULT NULL,
  `ekstensi`      VARCHAR(20) NULL DEFAULT NULL,
  `ukuran`        BIGINT UNSIGNED NOT NULL DEFAULT 0,
  -- Nama berkas di disk: token acak, BUKAN nama asli. Menghindari tabrakan
  -- nama sekaligus membuat lintasan tidak bisa ditebak.
  `nama_disk`     VARCHAR(120) NOT NULL,
  -- Lintasan relatif dari storage/private/drive, mis. "2/2026/08/<token>.pdf".
  `jalur_disk`    VARCHAR(500) NOT NULL,
  -- SHA-256 isi berkas; dipakai mendeteksi unggahan ganda.
  `checksum`      CHAR(64) NULL DEFAULT NULL,
  `created_by`    BIGINT UNSIGNED NULL DEFAULT NULL,
  `updated_by`    BIGINT UNSIGNED NULL DEFAULT NULL,
  `created_at`    TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`    TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `deleted_at`    TIMESTAMP NULL DEFAULT NULL,
  `deleted_by`    BIGINT UNSIGNED NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_drive_file_disk` (`nama_disk`),
  KEY `idx_drive_file_bidang` (`bidang_id`, `folder_id`, `deleted_at`),
  KEY `idx_drive_file_checksum` (`bidang_id`, `checksum`),
  KEY `idx_drive_file_sampah` (`deleted_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- 3. Berbagi
-- ============================================================
-- Satu baris = satu pemberian akses. Sasarannya folder ATAU berkas; penerimanya
-- satu bidang ATAU satu pengguna. Berbagi folder otomatis berlaku untuk seluruh
-- isinya (dicek lewat `drive_folder.jalur`), jadi tidak perlu satu baris per isi.
CREATE TABLE IF NOT EXISTS `drive_share` (
  `id`               BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `objek_tipe`       ENUM('folder','file') NOT NULL,
  `objek_id`         BIGINT UNSIGNED NOT NULL,
  -- Bidang pemilik objek; disalin ke sini supaya penyaringan tidak perlu join.
  `bidang_pemilik`   BIGINT UNSIGNED NOT NULL,
  `penerima_tipe`    ENUM('bidang','user') NOT NULL,
  `penerima_id`      BIGINT UNSIGNED NOT NULL,
  `izin`             ENUM('lihat','ubah') NOT NULL DEFAULT 'lihat',
  `created_by`       BIGINT UNSIGNED NULL DEFAULT NULL,
  `created_at`       TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_drive_share` (`objek_tipe`, `objek_id`, `penerima_tipe`, `penerima_id`),
  KEY `idx_drive_share_penerima` (`penerima_tipe`, `penerima_id`),
  KEY `idx_drive_share_objek` (`objek_tipe`, `objek_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- 4. Kuota
-- ============================================================
-- `terpakai` dicatat sebagai penghitung, bukan dijumlah ulang tiap unggahan.
-- Dengan ribuan berkas per bidang, SUM(ukuran) di jalur unggah akan terasa
-- lambat justru saat paling sering dipakai.
CREATE TABLE IF NOT EXISTS `drive_kuota` (
  `bidang_id`      BIGINT UNSIGNED NOT NULL,
  -- Default 25 GB. Disimpan di tabel supaya bisa dinaikkan per bidang tanpa
  -- deploy ulang; disk LXC 100 punya sisa jauh lebih besar dari ini.
  `batas_bytes`    BIGINT UNSIGNED NOT NULL DEFAULT 26843545600,
  `terpakai_bytes` BIGINT UNSIGNED NOT NULL DEFAULT 0,
  `updated_at`     TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`bidang_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Kuota awal untuk 5 bidang kerja. Bidang 7-9 (Tenaga Alih Daya/Keamanan/
-- Kebersihan) sengaja tidak diberi Drive: itu pengelompokan tenaga, bukan unit
-- kerja yang mengelola dokumen.
INSERT IGNORE INTO `drive_kuota` (`bidang_id`, `batas_bytes`, `terpakai_bytes`) VALUES
  (2, 26843545600, 0),
  (3, 26843545600, 0),
  (4, 26843545600, 0),
  (5, 26843545600, 0),
  (6, 26843545600, 0);
