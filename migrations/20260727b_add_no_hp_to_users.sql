-- Identitas kontak Admin Desa: nomor HP yang bisa dihubungi DPMD.
-- Jabatan memakai kolom `jabatan_desa` yang sudah ada.
--
-- Dibungkus cek information_schema supaya idempoten: runner mengirim file ini
-- sebagai SATU batch, jadi ALTER TABLE yang gagal karena kolomnya sudah ada akan
-- menghentikan statement-statement di bawahnya sementara runner tetap melaporkannya
-- sebagai "SKIP (already exists)".
SET @no_hp_exists := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'no_hp'
);
SET @sql := IF(
  @no_hp_exists = 0,
  'ALTER TABLE `users` ADD COLUMN `no_hp` VARCHAR(20) NULL DEFAULT NULL AFTER `jabatan_desa`',
  'DO 0'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
