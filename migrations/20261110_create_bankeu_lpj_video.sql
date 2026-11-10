CREATE TABLE IF NOT EXISTS `bankeu_lpj_video` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `desa_id` BIGINT UNSIGNED NOT NULL,
  `tahun_anggaran` YEAR NOT NULL,
  `dayeuh_pajajaran` JSON NOT NULL,
  `infrastruktur` JSON NOT NULL,
  `updated_by` BIGINT UNSIGNED NOT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_bankeu_lpj_video_desa_tahun` (`desa_id`, `tahun_anggaran`),
  CONSTRAINT `fk_bankeu_lpj_video_desa` FOREIGN KEY (`desa_id`) REFERENCES `desas` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
