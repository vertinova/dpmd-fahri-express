-- Migration: Create notifications and notification_logs tables
-- Date: 2026-03-10
-- Description: Create tables for push notification feature

-- Create notifications table
CREATE TABLE IF NOT EXISTS `notifications` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id` BIGINT UNSIGNED NOT NULL,
  `title` VARCHAR(255) NOT NULL,
  `message` TEXT NULL,
  `type` VARCHAR(50) NOT NULL DEFAULT 'general',
  `is_read` BOOLEAN NOT NULL DEFAULT FALSE,
  `data` JSON NULL,
  `sent_by` BIGINT UNSIGNED NULL,
  `created_at` TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  `read_at` TIMESTAMP NULL,
  PRIMARY KEY (`id`),
  INDEX `idx_notifications_user_id` (`user_id`),
  INDEX `idx_notifications_user_read` (`user_id`, `is_read`),
  INDEX `idx_notifications_created` (`created_at`),
  INDEX `idx_notifications_type` (`type`),
  INDEX `fk_notifications_sent_by` (`sent_by`),
  CONSTRAINT `fk_notifications_user` 
    FOREIGN KEY (`user_id`) 
    REFERENCES `users` (`id`) 
    ON DELETE CASCADE 
    ON UPDATE NO ACTION,
  CONSTRAINT `fk_notifications_sent_by` 
    FOREIGN KEY (`sent_by`) 
    REFERENCES `users` (`id`) 
    ON UPDATE NO ACTION
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Create notification_logs table
CREATE TABLE IF NOT EXISTS `notification_logs` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `title` VARCHAR(255) NOT NULL,
  `body` TEXT NOT NULL,
  `target_type` VARCHAR(50) NOT NULL,
  `target_value` TEXT NULL,
  `sent_count` INT NOT NULL DEFAULT 0,
  `failed_count` INT NOT NULL DEFAULT 0,
  `sender_id` BIGINT UNSIGNED NOT NULL,
  `created_at` TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  INDEX `notification_logs_sender_id_index` (`sender_id`),
  INDEX `notification_logs_created_at_index` (`created_at`),
  CONSTRAINT `notification_logs_sender_id_fkey` 
    FOREIGN KEY (`sender_id`) 
    REFERENCES `users` (`id`) 
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
