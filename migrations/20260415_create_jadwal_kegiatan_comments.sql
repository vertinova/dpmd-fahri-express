-- Create jadwal_kegiatan_comments table
CREATE TABLE IF NOT EXISTS `jadwal_kegiatan_comments` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `jadwal_kegiatan_id` BIGINT UNSIGNED NOT NULL,
  `user_id` BIGINT UNSIGNED NOT NULL,
  `content` TEXT NOT NULL,
  `created_at` TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  INDEX `idx_jkc_jadwal` (`jadwal_kegiatan_id`),
  INDEX `idx_jkc_user` (`user_id`),
  CONSTRAINT `fk_jkc_jadwal` FOREIGN KEY (`jadwal_kegiatan_id`) REFERENCES `jadwal_kegiatan` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_jkc_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
