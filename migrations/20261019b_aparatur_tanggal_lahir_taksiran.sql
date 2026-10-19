-- Migration: penanda tanggal lahir taksiran pada aparatur desa
-- Date: 2026-10-19
-- Description:
--   Arsip Dapur Desa tidak menyimpan tanggal lahir; impornya menaksir
--   1 Januari (tahun berjalan − usia). Tanggal itu masuk ke 8 digit pertama
--   NIPD, jadi NIPD ditahan selama penanda ini menyala. Penanda padam saat
--   tanggal lahir diubah, atau saat Bidang Pemdes mengonfirmasi tanggalnya
--   memang sesuai KTP.
--
--   Saat diperiksa: 4.820 baris impor Dapur Desa bertanggal 1 Januari.
--
-- Aman dijalankan berulang (pemeriksaan information_schema).

SET @ada = (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'aparatur_desa'
    AND COLUMN_NAME = 'tanggal_lahir_taksiran');

SET @sql = IF(@ada = 0,
  'ALTER TABLE `aparatur_desa` ADD COLUMN `tanggal_lahir_taksiran` TINYINT(1) NOT NULL DEFAULT 0 AFTER `tanggal_lahir`',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Hanya saat kolom baru dibuat: impor Dapur Desa yang tanggalnya masih
-- 1 Januari. Pada jalan ulang tidak menyentuh apa-apa, supaya konfirmasi
-- yang sudah diberikan bidang tidak dinyalakan kembali.
SET @sql = IF(@ada = 0,
  'UPDATE `aparatur_desa` SET `tanggal_lahir_taksiran` = 1 WHERE `sumber_data` = ''dapur_desa'' AND MONTH(`tanggal_lahir`) = 1 AND DAY(`tanggal_lahir`) = 1',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- NIPD yang sempat terbit dari tanggal taksiran dicabut beserta keputusannya
-- tetap utuh; NIPD akan terbit ulang setelah tanggalnya dibetulkan.
UPDATE `aparatur_desa` SET `nipd` = NULL WHERE `tanggal_lahir_taksiran` = 1 AND `nipd` IS NOT NULL;
