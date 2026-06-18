-- Create absensi_reminder_templates table for customizable reminder notifications
CREATE TABLE IF NOT EXISTS `absensi_reminder_templates` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `type` VARCHAR(50) NOT NULL,
  `title` VARCHAR(255) NOT NULL DEFAULT '',
  `message` TEXT NULL,
  `is_active` BOOLEAN NOT NULL DEFAULT TRUE,
  `updated_by` BIGINT UNSIGNED NULL,
  `created_at` TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `absensi_reminder_templates_type_key` (`type`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Seed default reminder templates
INSERT INTO `absensi_reminder_templates` (`type`, `title`, `message`, `is_active`) VALUES
  ('reminder_masuk', '⏰ Waktunya Absen Masuk!', 'Jangan lupa absen masuk ya! Segera buka aplikasi dan lakukan absensi.', TRUE),
  ('reminder_pulang', '🏠 Waktunya Absen Pulang!', 'Sudah waktunya pulang! Jangan lupa absen keluar sebelum meninggalkan kantor.', TRUE)
ON DUPLICATE KEY UPDATE `type` = VALUES(`type`);
