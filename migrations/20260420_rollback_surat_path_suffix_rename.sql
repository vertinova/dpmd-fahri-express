-- Rollback migration 20260204_rename_surat_fields_add_path_suffix.sql
-- Production DB has surat_pengantar_path / surat_permohonan_path 
-- but Prisma schema expects surat_pengantar / surat_permohonan
-- This caused "column does not exist" error on production

-- Only rename if _path columns exist (safe for environments where rename never ran)
SET @has_path_col = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS 
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'desa_bankeu_surat' AND COLUMN_NAME = 'surat_pengantar_path');

SET @sql1 = IF(@has_path_col > 0, 
  'ALTER TABLE `desa_bankeu_surat` CHANGE COLUMN `surat_pengantar_path` `surat_pengantar` VARCHAR(255) NULL, CHANGE COLUMN `surat_permohonan_path` `surat_permohonan` VARCHAR(255) NULL',
  'SELECT 1');
PREPARE stmt1 FROM @sql1;
EXECUTE stmt1;
DEALLOCATE PREPARE stmt1;
