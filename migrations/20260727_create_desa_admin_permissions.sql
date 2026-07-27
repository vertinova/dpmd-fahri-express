-- Admin Desa: setiap desa punya 1 akun pengelola akun (role `admin_desa`).
-- Akun operasional desa tetap memakai role `desa`, tetapi menu/fitur yang bisa
-- diakses ditentukan per akun lewat tabel `desa_user_permissions`.

-- 1. Jabatan/bagian akun operasional desa (Keuangan, Pembangunan, Pemerintahan, dst.)
--    Dibungkus pengecekan information_schema supaya idempoten: runner mengirim file
--    ini sebagai SATU batch, jadi `ALTER TABLE ... ADD COLUMN` yang gagal karena
--    kolomnya sudah ada akan menghentikan statement-statement di bawahnya.
SET @jabatan_desa_exists := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'jabatan_desa'
);
SET @sql := IF(
  @jabatan_desa_exists = 0,
  'ALTER TABLE `users` ADD COLUMN `jabatan_desa` VARCHAR(100) NULL DEFAULT NULL AFTER `desa_id`',
  'DO 0'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 2. Hak akses per akun desa. Satu baris = satu fitur yang diizinkan.
CREATE TABLE IF NOT EXISTS `desa_user_permissions` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id` BIGINT UNSIGNED NOT NULL,
  `permission_key` VARCHAR(50) NOT NULL,
  `created_by` BIGINT UNSIGNED NULL DEFAULT NULL,
  `created_at` TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `desa_user_permissions_unique` (`user_id`, `permission_key`),
  KEY `desa_user_permissions_user_id_index` (`user_id`),
  CONSTRAINT `fk_desa_user_permissions_user`
    FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 3. Seluruh akun desa lama berubah fungsi menjadi Admin Desa (pengelola akun saja).
--    Akun operasional dibuat sendiri oleh Admin Desa lewat menu Manajemen Akun.
UPDATE `users` SET `role` = 'admin_desa' WHERE `role` = 'desa';
