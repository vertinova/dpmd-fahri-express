CREATE TABLE `absensi_weekly_awards` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `week_key` VARCHAR(20) NOT NULL,
  `period_start` DATE NOT NULL,
  `period_end` DATE NOT NULL,
  `month_label` VARCHAR(50) NOT NULL,
  `winners` JSON NOT NULL,
  `generated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `notified_at` TIMESTAMP NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `absensi_weekly_awards_week_key_key` (`week_key`),
  KEY `idx_absensi_awards_period_end` (`period_end`),
  KEY `idx_absensi_awards_generated_at` (`generated_at`)
);
