-- Migration: Create bantuan_provinsi_lpj table
-- Flow: Desa uploads LPJ Bantuan Provinsi -> DPMD verifies approve/reject/revision

CREATE TABLE IF NOT EXISTS `bantuan_provinsi_lpj` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `desa_id` BIGINT UNSIGNED NOT NULL,
  `tahun_anggaran` YEAR NOT NULL DEFAULT 2026,
  `nama_file` VARCHAR(255) NOT NULL COMMENT 'Original filename',
  `file_path` VARCHAR(500) NOT NULL COMMENT 'Stored relative path on disk',
  `file_size` INT UNSIGNED NULL COMMENT 'File size in bytes',
  `keterangan` TEXT NULL COMMENT 'Catatan/keterangan dari desa',
  `status` ENUM('pending', 'approved', 'rejected', 'revision') NOT NULL DEFAULT 'pending',
  `dpmd_catatan` TEXT NULL,
  `dpmd_verified_by` BIGINT UNSIGNED NULL,
  `dpmd_verified_at` TIMESTAMP NULL,
  `uploaded_by` BIGINT UNSIGNED NOT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  INDEX `idx_bantuan_provinsi_lpj_desa_id` (`desa_id`),
  INDEX `idx_bantuan_provinsi_lpj_tahun` (`tahun_anggaran`),
  INDEX `idx_bantuan_provinsi_lpj_status` (`status`),
  INDEX `idx_bantuan_provinsi_lpj_uploaded_by` (`uploaded_by`),
  INDEX `idx_bantuan_provinsi_lpj_verified_by` (`dpmd_verified_by`),
  CONSTRAINT `fk_bantuan_provinsi_lpj_desa` FOREIGN KEY (`desa_id`) REFERENCES `desas` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_bantuan_provinsi_lpj_user` FOREIGN KEY (`uploaded_by`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_bantuan_provinsi_lpj_verified_by` FOREIGN KEY (`dpmd_verified_by`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE `conversations`
  MODIFY COLUMN `reference_type` ENUM('bankeu_lpj', 'bankeu_proposal', 'bantuan_provinsi_lpj') NULL;
