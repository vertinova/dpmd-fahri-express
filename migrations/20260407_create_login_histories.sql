-- Migration: Create login_histories table
-- Date: 2026-04-07
-- Description: Track login history with IP address, device info, and user agent

CREATE TABLE IF NOT EXISTS `login_histories` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id` BIGINT UNSIGNED NOT NULL,
  `ip_address` VARCHAR(45) NULL,
  `user_agent` VARCHAR(500) NULL,
  `device_id` VARCHAR(100) NULL,
  `device_type` VARCHAR(50) NULL COMMENT 'desktop, mobile, tablet',
  `browser` VARCHAR(100) NULL,
  `os` VARCHAR(100) NULL,
  `status` VARCHAR(20) NOT NULL DEFAULT 'success' COMMENT 'success, failed',
  `created_at` TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  INDEX `idx_login_histories_user_id` (`user_id`),
  INDEX `idx_login_histories_created_at` (`created_at`),
  INDEX `idx_login_histories_ip_address` (`ip_address`),
  CONSTRAINT `fk_login_histories_user_id` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
