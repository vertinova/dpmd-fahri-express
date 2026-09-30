-- Manajemen Server (superadmin): jejak serangan, daftar blokir IP, dan riwayat
-- metrik server. Ketiga tabel juga dibuat otomatis oleh
-- src/services/serverStore.service.js saat aplikasi menyala, jadi migrasi ini
-- aman dijalankan berulang.

CREATE TABLE IF NOT EXISTS `server_security_events` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `ip_address` VARCHAR(45) NOT NULL,
  `event_type` VARCHAR(40) NOT NULL,
  `severity` VARCHAR(10) NOT NULL DEFAULT 'low',
  `source` VARCHAR(20) NOT NULL DEFAULT 'app',
  `method` VARCHAR(10) NULL,
  `path` VARCHAR(500) NULL,
  `user_agent` VARCHAR(500) NULL,
  `user_id` BIGINT UNSIGNED NULL,
  `detail` VARCHAR(1000) NULL,
  `blocked` TINYINT(1) NOT NULL DEFAULT 0,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_sse_created` (`created_at`),
  KEY `idx_sse_ip` (`ip_address`),
  KEY `idx_sse_type` (`event_type`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `server_ip_blocklist` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `ip_address` VARCHAR(45) NOT NULL,
  `reason` VARCHAR(500) NULL,
  `auto` TINYINT(1) NOT NULL DEFAULT 0,
  `hits` INT UNSIGNED NOT NULL DEFAULT 0,
  `expires_at` DATETIME NULL,
  `created_by` VARCHAR(191) NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_sib_ip` (`ip_address`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `server_metric_snapshots` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `cpu` DECIMAL(5,2) NULL,
  `memory` DECIMAL(5,2) NULL,
  `disk` DECIMAL(5,2) NULL,
  `load1` DECIMAL(8,2) NULL,
  `process_mb` INT UNSIGNED NULL,
  `requests` INT UNSIGNED NULL,
  `errors` INT UNSIGNED NULL,
  `avg_ms` INT UNSIGNED NULL,
  `net_rx` BIGINT UNSIGNED NULL,
  `net_tx` BIGINT UNSIGNED NULL,
  `attacks` INT UNSIGNED NULL,
  `online` INT UNSIGNED NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_sms_created` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
