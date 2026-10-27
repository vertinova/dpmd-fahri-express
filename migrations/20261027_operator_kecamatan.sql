-- Operator kecamatan.
--
-- Akun kecamatan yang ada tetap SATU per kecamatan dan menjadi akun utama:
-- semua fitur terbuka, ditambah menu Akun Operator. Dari situ akun utama
-- membuat akun operator untuk petugasnya sendiri (mis. seksi Bankeu dan seksi
-- Kelembagaan), supaya setiap verifikasi tercatat atas nama orangnya dan sandi
-- akun utama tidak perlu beredar.
--
-- Operator tetap ber-role `kecamatan` (seluruh penjaga rute kecamatan berlaku
-- apa adanya), dibedakan oleh kolom `operator_kecamatan`, dan fiturnya dibatasi
-- per baris di `kecamatan_user_permissions`.

-- 1. Penanda operator. Dibungkus pengecekan information_schema supaya idempoten:
--    runner mengirim file ini sebagai SATU batch.
SET @operator_kecamatan_exists := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'operator_kecamatan'
);
SET @sql := IF(
  @operator_kecamatan_exists = 0,
  'ALTER TABLE `users` ADD COLUMN `operator_kecamatan` TINYINT(1) NOT NULL DEFAULT 0 AFTER `kecamatan_id`',
  'DO 0'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 2. Hak akses per operator kecamatan. Satu baris = satu fitur yang diizinkan.
CREATE TABLE IF NOT EXISTS `kecamatan_user_permissions` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id` BIGINT UNSIGNED NOT NULL,
  `permission_key` VARCHAR(50) NOT NULL,
  `created_by` BIGINT UNSIGNED NULL DEFAULT NULL,
  `created_at` TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `kecamatan_user_permissions_unique` (`user_id`, `permission_key`),
  KEY `kecamatan_user_permissions_user_id_index` (`user_id`),
  CONSTRAINT `fk_kecamatan_user_permissions_user`
    FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
