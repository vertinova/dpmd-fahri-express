-- Jejak pengisian BUM Desa oleh akun desa.
--
-- Data BUM Desa berasal dari dua sumber: impor CSV/arsip milik bidang SPKED
-- (data lama) dan isian desa lewat web (data baru). Tabelnya tidak pernah
-- membedakan keduanya — simpan dari formulir desa bahkan tidak memperbarui
-- updated_at — sehingga ekspor tidak bisa memisahkan data lama dari baru.
--
-- diisi_desa_at   : waktu terakhir akun desa menyimpan isian / mengunggah berkas
-- diisi_desa_oleh : users.id akun desa tersebut
-- NULL keduanya = belum pernah disentuh desa (murni data lama).
--
-- Riwayat sebelum kolom ini ada diisi dari log server dengan
-- scripts/bumdes-import/tandai-isian-desa.js.
--
-- Idempoten: tiap ALTER dibungkus pengecekan information_schema karena
-- runner mengirim berkas ini sebagai SATU batch, dan MySQL tidak mengenal
-- ADD COLUMN IF NOT EXISTS.

SET @ada_diisi_at := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'bumdes' AND COLUMN_NAME = 'diisi_desa_at'
);
SET @sql := IF(
  @ada_diisi_at = 0,
  'ALTER TABLE `bumdes` ADD COLUMN `diisi_desa_at` DATETIME NULL, ADD COLUMN `diisi_desa_oleh` BIGINT UNSIGNED NULL',
  'DO 0'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @ada_idx := (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'bumdes' AND INDEX_NAME = 'idx_bumdes_diisi_desa_at'
);
SET @sql := IF(
  @ada_idx = 0,
  'CREATE INDEX `idx_bumdes_diisi_desa_at` ON `bumdes` (`diisi_desa_at`)',
  'DO 0'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
