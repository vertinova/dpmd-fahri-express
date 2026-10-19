-- Migration: SK terakhir, verifikasi per item, dan NIPD resmi aparatur desa
-- Date: 2026-10-19
-- Description:
--   1. `file_sk_terakhir`: berkas SK jabatan terakhir — dasar verifikasi
--      jabatan & NIPD.
--   2. `verifikasi_item`: keputusan Bidang Pemdes per kelompok data dan per
--      berkas, bentuk { "<item>": { "status": "sesuai"|"tidak_sesuai",
--      "catatan": "...", "oleh": "...", "pada": "<ISO>" } }.
--      `status_verifikasi` tetap kolom ringkasnya: 'terverifikasi' hanya bila
--      semua item sesuai, 'ditolak' bila ada yang tidak sesuai.
--   3. NIPD lama dikosongkan. Isinya tidak pernah resmi (hanya "-" / "0" dan
--      satu nilai 12 digit) — NIPD 20 digit kini diterbitkan sistem saat
--      verifikasi menyatakan data valid.
--
-- Aman dijalankan berulang (pemeriksaan information_schema).

SET @sql = (SELECT IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'aparatur_desa'
       AND COLUMN_NAME = 'file_sk_terakhir') = 0,
  'ALTER TABLE `aparatur_desa` ADD COLUMN `file_sk_terakhir` VARCHAR(255) NULL DEFAULT NULL AFTER `file_ijazah_terakhir`',
  'SELECT 1'));
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = (SELECT IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'aparatur_desa'
       AND COLUMN_NAME = 'verifikasi_item') = 0,
  'ALTER TABLE `aparatur_desa` ADD COLUMN `verifikasi_item` JSON NULL DEFAULT NULL AFTER `catatan_verifikasi`',
  'SELECT 1'));
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- NIPD yang bukan bentuk resmi 20 digit dibuang. Yang belum terverifikasi
-- juga: NIPD hanya sah setelah data dinyatakan valid.
UPDATE `aparatur_desa`
   SET `nipd` = NULL
 WHERE `nipd` IS NOT NULL
   AND (`nipd` NOT REGEXP '^[0-9]{20}$' OR `status_verifikasi` IS NULL OR `status_verifikasi` <> 'terverifikasi');
