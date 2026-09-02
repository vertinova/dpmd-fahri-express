-- Migration: Verifikasi aparatur desa oleh Bidang Pemdes + riwayat perubahannya
-- Date: 2026-09-02
-- Description:
--   1. Kolom keputusan verifikasi pada `aparatur_desa`. Bidang Pemdes memutus
--      setujui atau tolak; `catatan_verifikasi` adalah keterangan yang dibaca
--      desa, dan wajib diisi saat menolak.
--   2. Tabel `aparatur_desa_logs`: riwayat dibuat/diubah/keputusan verifikasi.
--      Tidak memakai `activity_logs` karena `entity_id` di sana BIGINT
--      sedangkan id aparatur berupa UUID (CHAR(36)).
--
-- Aman dijalankan berulang: penambahan kolom dijaga pemeriksaan
-- information_schema karena MySQL 8 tidak punya ADD COLUMN IF NOT EXISTS.
--
-- Cara jalan:  node database-express/run-migration.js database-express/migrations/20260902_add_verifikasi_dan_riwayat_aparatur.sql

-- ---------------------------------------------------------------------------
-- 1. Kolom verifikasi pada aparatur_desa
-- ---------------------------------------------------------------------------

-- status_verifikasi: NULL = belum diperiksa, 'terverifikasi', atau 'ditolak'
SET @sql = (SELECT IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'aparatur_desa'
       AND COLUMN_NAME = 'status_verifikasi') = 0,
  'ALTER TABLE `aparatur_desa` ADD COLUMN `status_verifikasi` VARCHAR(20) NULL DEFAULT NULL',
  'SELECT 1'));
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Waktu keputusan — berlaku untuk kedua hasil, bukan hanya yang disetujui.
SET @sql = (SELECT IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'aparatur_desa'
       AND COLUMN_NAME = 'dpmd_verified_at') = 0,
  'ALTER TABLE `aparatur_desa` ADD COLUMN `dpmd_verified_at` TIMESTAMP NULL DEFAULT NULL',
  'SELECT 1'));
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Pemutusnya. Sengaja tanpa foreign key ke `users`: riwayat & keputusan harus
-- tetap terbaca kalau akun petugasnya kelak dihapus.
SET @sql = (SELECT IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'aparatur_desa'
       AND COLUMN_NAME = 'dpmd_verified_by') = 0,
  'ALTER TABLE `aparatur_desa` ADD COLUMN `dpmd_verified_by` BIGINT UNSIGNED NULL DEFAULT NULL',
  'SELECT 1'));
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Keterangan untuk desa.
SET @sql = (SELECT IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'aparatur_desa'
       AND COLUMN_NAME = 'catatan_verifikasi') = 0,
  'ALTER TABLE `aparatur_desa` ADD COLUMN `catatan_verifikasi` TEXT NULL DEFAULT NULL',
  'SELECT 1'));
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Baris yang sempat diverifikasi sebelum kolom status ada dianggap disetujui.
UPDATE `aparatur_desa`
   SET `status_verifikasi` = 'terverifikasi'
 WHERE `dpmd_verified_at` IS NOT NULL
   AND `status_verifikasi` IS NULL;

-- ---------------------------------------------------------------------------
-- 2. Riwayat perubahan aparatur
-- ---------------------------------------------------------------------------
-- `aksi`: dibuat | diubah | terverifikasi | ditolak | verifikasi_dibatalkan
-- Nama & peran pelaku disalin, bukan direlasikan, dengan alasan yang sama
-- seperti `dpmd_verified_by` di atas.
CREATE TABLE IF NOT EXISTS `aparatur_desa_logs` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `aparatur_id` CHAR(36) NOT NULL,
  `aksi` VARCHAR(30) NOT NULL,
  `keterangan` TEXT NULL,
  `oleh_id` BIGINT UNSIGNED NULL,
  `oleh_nama` VARCHAR(255) NULL,
  `oleh_peran` VARCHAR(50) NULL,
  `created_at` TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `aparatur_desa_logs_aparatur_id_index` (`aparatur_id`, `created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
