-- Merge data aparatur desa dengan arsip Dapur Desa.
--
-- Integrasi API Dapur Desa sudah dimatikan; datanya kini berupa arsip offline
-- (7.989 record). Arsip itu ditampung di tabel staging ini dulu, TIDAK langsung
-- ditimpakan ke `aparatur_desa`, supaya desa bisa memilih data mana yang dipakai
-- saat isian mereka bentrok dengan arsip.
--
-- Semua statement dibungkus pengecekan information_schema supaya idempoten:
-- runner mengirim file ini sebagai SATU batch, jadi ALTER/CREATE yang gagal karena
-- objeknya sudah ada akan menghentikan statement-statement di bawahnya.

-- 1. Tabel staging arsip Dapur Desa.
CREATE TABLE IF NOT EXISTS `aparatur_dapur_desa` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  -- id record asli di Dapur Desa; jadi kunci idempoten saat impor diulang.
  `dapur_id` INT NOT NULL,
  -- Hasil pemetaan kode desa ke tabel `desas`. NULL = kode tidak dikenali.
  `desa_id` BIGINT UNSIGNED NULL DEFAULT NULL,
  `kode_desa` VARCHAR(20) NULL DEFAULT NULL,
  `kode_kecamatan` VARCHAR(20) NULL DEFAULT NULL,
  `nama_desa_sumber` VARCHAR(255) NULL DEFAULT NULL,
  `nama_kecamatan_sumber` VARCHAR(255) NULL DEFAULT NULL,
  `nama` VARCHAR(255) NOT NULL,
  -- Nama yang sudah dinormalkan (huruf besar, tanpa gelar/tanda baca) untuk pencocokan.
  `nama_normal` VARCHAR(255) NOT NULL,
  `jabatan` VARCHAR(255) NULL DEFAULT NULL,
  `jenis_kelamin` VARCHAR(5) NULL DEFAULT NULL,
  `usia` INT NULL DEFAULT NULL,
  `agama` VARCHAR(50) NULL DEFAULT NULL,
  `status_kawin` VARCHAR(50) NULL DEFAULT NULL,
  `status_pns` VARCHAR(20) NULL DEFAULT NULL,
  `pendidikan` VARCHAR(255) NULL DEFAULT NULL,
  `no_sk` VARCHAR(255) NULL DEFAULT NULL,
  `tgl_sk` DATE NULL DEFAULT NULL,
  `no_sk_pertama` VARCHAR(255) NULL DEFAULT NULL,
  `tgl_sk_pertama` DATE NULL DEFAULT NULL,
  `tahun_lulus` VARCHAR(10) NULL DEFAULT NULL,
  `foto_url` TEXT NULL DEFAULT NULL,
  -- Path foto di arsip lokal; dipakai tahap kedua saat foto disalin ke server.
  `foto_lokal` VARCHAR(500) NULL DEFAULT NULL,
  -- baru | otomatis | sama | konflik | selesai | ditolak | tanpa_desa
  `status_rekonsiliasi` VARCHAR(20) NOT NULL DEFAULT 'baru',
  -- Record aparatur yang dicocokkan (konflik) atau yang dihasilkan (otomatis/selesai).
  `aparatur_desa_id` CHAR(36) NULL DEFAULT NULL,
  -- dapur | desa — pilihan yang diambil operator desa saat menyelesaikan konflik.
  `keputusan` VARCHAR(20) NULL DEFAULT NULL,
  `diputuskan_oleh` BIGINT UNSIGNED NULL DEFAULT NULL,
  `diputuskan_pada` TIMESTAMP NULL DEFAULT NULL,
  `created_at` TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `aparatur_dapur_desa_dapur_id_unique` (`dapur_id`),
  KEY `aparatur_dapur_desa_desa_id_index` (`desa_id`),
  KEY `aparatur_dapur_desa_status_index` (`status_rekonsiliasi`),
  KEY `aparatur_dapur_desa_nama_normal_index` (`nama_normal`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 2. Jejak asal-usul di tabel aparatur: membedakan isian desa dan hasil suntikan arsip,
--    sekaligus jalan pulang kalau impor perlu dibatalkan.
SET @sumber_data_exists := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'aparatur_desa' AND COLUMN_NAME = 'sumber_data'
);
SET @sql := IF(
  @sumber_data_exists = 0,
  'ALTER TABLE `aparatur_desa` ADD COLUMN `sumber_data` VARCHAR(20) NOT NULL DEFAULT ''desa'' AFTER `status`',
  'DO 0'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @dapur_id_exists := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'aparatur_desa' AND COLUMN_NAME = 'dapur_id'
);
SET @sql := IF(
  @dapur_id_exists = 0,
  'ALTER TABLE `aparatur_desa` ADD COLUMN `dapur_id` INT NULL DEFAULT NULL AFTER `sumber_data`',
  'DO 0'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @dapur_id_index_exists := (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'aparatur_desa' AND INDEX_NAME = 'aparatur_desa_dapur_id_index'
);
SET @sql := IF(
  @dapur_id_index_exists = 0,
  'ALTER TABLE `aparatur_desa` ADD INDEX `aparatur_desa_dapur_id_index` (`dapur_id`)',
  'DO 0'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
