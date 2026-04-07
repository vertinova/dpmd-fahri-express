-- Migration: Add last_active_at to users table
-- Date: 2026-04-07
-- Description: Track user last activity for online presence detection

ALTER TABLE `users` ADD COLUMN `last_active_at` TIMESTAMP NULL DEFAULT NULL AFTER `device_id`;
CREATE INDEX `idx_users_last_active_at` ON `users` (`last_active_at`);
