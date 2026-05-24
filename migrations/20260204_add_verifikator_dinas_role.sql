-- Migration: Add verifikator_dinas role to users_role enum
-- Date: 2026-02-04
-- Description: Menambahkan role 'verifikator_dinas' untuk user yang ditunjuk dinas untuk melakukan verifikasi bankeu

-- Step 1: Pastikan kolom role tidak dipersempit ke ENUM lama.
-- Production sudah memakai role dinamis lewat tabel `roles`, jadi kolom ini
-- harus tetap VARCHAR agar role baru seperti bpjs tidak menyebabkan
-- "Data truncated for column 'role'" saat migration lama ini rerun.
ALTER TABLE `users` 
MODIFY COLUMN `role` VARCHAR(50) NOT NULL DEFAULT 'desa';

-- Step 2: Create table for verifikator_dinas assignments (optional - for tracking)
-- NOTE: dinas_id references master_dinas table (dinas terkait)
CREATE TABLE IF NOT EXISTS `dinas_verifikator` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  `dinas_id` INT NOT NULL COMMENT 'References master_dinas.id',
  `user_id` BIGINT UNSIGNED NOT NULL,
  `nama` VARCHAR(255) NOT NULL,
  `nip` VARCHAR(50) NULL,
  `jabatan` VARCHAR(255) NOT NULL,
  `email` VARCHAR(255) NOT NULL,
  `is_active` BOOLEAN DEFAULT TRUE,
  `created_by` BIGINT UNSIGNED NOT NULL,
  `created_at` TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  
  FOREIGN KEY (`dinas_id`) REFERENCES `master_dinas`(`id`) ON DELETE CASCADE,
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE,
  FOREIGN KEY (`created_by`) REFERENCES `users`(`id`),
  
  UNIQUE KEY `unique_user_per_dinas` (`dinas_id`, `user_id`),
  INDEX `idx_dinas_id` (`dinas_id`),
  INDEX `idx_user_id` (`user_id`),
  INDEX `idx_is_active` (`is_active`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
