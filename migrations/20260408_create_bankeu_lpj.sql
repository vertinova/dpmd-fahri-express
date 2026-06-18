-- Migration: Create bankeu_lpj table for LPJ Bantuan Keuangan 2025
-- Date: 2026-04-08
-- Description: Desa uploads LPJ file, DPMD SPKED can view/download. No verification needed.

CREATE TABLE IF NOT EXISTS `bankeu_lpj` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `desa_id` BIGINT UNSIGNED NOT NULL,
  `tahun_anggaran` YEAR NOT NULL DEFAULT 2025,
  `nama_file` VARCHAR(255) NOT NULL COMMENT 'Original filename',
  `file_path` VARCHAR(500) NOT NULL COMMENT 'Stored filename on disk',
  `file_size` INT UNSIGNED NULL COMMENT 'File size in bytes',
  `keterangan` TEXT NULL COMMENT 'Catatan/keterangan dari desa',
  `uploaded_by` BIGINT UNSIGNED NOT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  INDEX `idx_bankeu_lpj_desa_id` (`desa_id`),
  INDEX `idx_bankeu_lpj_tahun` (`tahun_anggaran`),
  UNIQUE KEY `uk_bankeu_lpj_desa_tahun` (`desa_id`, `tahun_anggaran`),
  CONSTRAINT `fk_bankeu_lpj_desa` FOREIGN KEY (`desa_id`) REFERENCES `desas` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_bankeu_lpj_user` FOREIGN KEY (`uploaded_by`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
