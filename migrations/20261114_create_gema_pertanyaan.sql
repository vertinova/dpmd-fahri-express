-- Migration: Create gema_pertanyaan
-- Date: 2026-11-14
-- Description: Memori pengalaman Gema. Tiap pertanyaan dicatat beserta pola
--   panggilan alatnya; pola yang terbukti benar disuntikkan sebagai contoh.

CREATE TABLE IF NOT EXISTS `gema_pertanyaan` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id` BIGINT UNSIGNED NULL,
  `sesi` VARCHAR(64) NULL,
  `teks` VARCHAR(1000) NOT NULL,
  `pola` VARCHAR(1000) NOT NULL,
  `ditenagai` VARCHAR(20) NOT NULL,
  `panggilan` JSON NULL,
  `tanda` CHAR(40) NULL,
  `kalimat` TEXT NULL,
  `total` INT NOT NULL DEFAULT 0,
  `durasi_ms` INT NOT NULL DEFAULT 0,
  `nilai` TINYINT NOT NULL DEFAULT 0,
  `dinilai_at` DATETIME NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  INDEX `idx_gema_pertanyaan_user_created` (`user_id`, `created_at`),
  INDEX `idx_gema_pertanyaan_tanda` (`tanda`),
  INDEX `idx_gema_pertanyaan_created` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
