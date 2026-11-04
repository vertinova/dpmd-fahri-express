-- Migration: NIK dan nomor WhatsApp pada aparatur desa
-- Date: 2026-11-04
-- Description:
--   Keduanya wajib di formulir, tetapi kolomnya NULL: baris lama belum punya
--   isinya dan baru terisi saat desa melengkapinya. Tidak UNIQUE karena satu
--   orang bisa punya baris lama berstatus Tidak Aktif; kembar di antara yang
--   aktif ditolak aplikasi. Indeks melayani pemeriksaan kembar itu.
--
-- Aman dijalankan berulang (pemeriksaan information_schema).

SET @ada = (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'aparatur_desa' AND COLUMN_NAME = 'nik');
SET @sql = IF(@ada = 0,
  'ALTER TABLE `aparatur_desa` ADD COLUMN `nik` VARCHAR(16) NULL AFTER `niap`',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @ada = (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'aparatur_desa' AND COLUMN_NAME = 'whatsapp');
SET @sql = IF(@ada = 0,
  'ALTER TABLE `aparatur_desa` ADD COLUMN `whatsapp` VARCHAR(20) NULL AFTER `nik`',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @ada = (SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'aparatur_desa' AND INDEX_NAME = 'aparatur_desa_nik_index');
SET @sql = IF(@ada = 0,
  'ALTER TABLE `aparatur_desa` ADD INDEX `aparatur_desa_nik_index` (`nik`)',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
