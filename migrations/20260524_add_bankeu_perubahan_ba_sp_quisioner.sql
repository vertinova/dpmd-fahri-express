-- ============================================================
-- Bankeu Perubahan: tambah kolom untuk Surat Pengantar Kecamatan,
-- versioning Berita Acara, dan flag Quisioner; serta buat tabel
-- bankeu_perubahan_questionnaires (per tim member per proposal).
--
-- Idempotent dan kompatibel dengan MySQL production yang tidak mendukung
-- ALTER TABLE ... ADD COLUMN IF NOT EXISTS.
-- ============================================================

-- 1) Tambah kolom ke bankeu_perubahan_proposals
SET @column_exists := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'bankeu_perubahan_proposals'
    AND COLUMN_NAME = 'berita_acara_qr_code'
);
SET @sql := IF(
  @column_exists = 0,
  'ALTER TABLE bankeu_perubahan_proposals ADD COLUMN berita_acara_qr_code VARCHAR(255) NULL AFTER berita_acara_generated_at',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @column_exists := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'bankeu_perubahan_proposals'
    AND COLUMN_NAME = 'berita_acara_version'
);
SET @sql := IF(
  @column_exists = 0,
  'ALTER TABLE bankeu_perubahan_proposals ADD COLUMN berita_acara_version INT UNSIGNED NULL DEFAULT 1 AFTER berita_acara_qr_code',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @column_exists := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'bankeu_perubahan_proposals'
    AND COLUMN_NAME = 'surat_pengantar_kecamatan_path'
);
SET @sql := IF(
  @column_exists = 0,
  'ALTER TABLE bankeu_perubahan_proposals ADD COLUMN surat_pengantar_kecamatan_path VARCHAR(255) NULL AFTER berita_acara_version',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @column_exists := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'bankeu_perubahan_proposals'
    AND COLUMN_NAME = 'surat_pengantar_kecamatan_nomor'
);
SET @sql := IF(
  @column_exists = 0,
  'ALTER TABLE bankeu_perubahan_proposals ADD COLUMN surat_pengantar_kecamatan_nomor VARCHAR(100) NULL AFTER surat_pengantar_kecamatan_path',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @column_exists := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'bankeu_perubahan_proposals'
    AND COLUMN_NAME = 'surat_pengantar_kecamatan_generated_at'
);
SET @sql := IF(
  @column_exists = 0,
  'ALTER TABLE bankeu_perubahan_proposals ADD COLUMN surat_pengantar_kecamatan_generated_at TIMESTAMP NULL AFTER surat_pengantar_kecamatan_nomor',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @column_exists := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'bankeu_perubahan_proposals'
    AND COLUMN_NAME = 'quisioner_completed'
);
SET @sql := IF(
  @column_exists = 0,
  'ALTER TABLE bankeu_perubahan_proposals ADD COLUMN quisioner_completed TINYINT(1) NULL DEFAULT 0 AFTER surat_pengantar_kecamatan_generated_at',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 2) Buat tabel bankeu_perubahan_questionnaires
CREATE TABLE IF NOT EXISTS bankeu_perubahan_questionnaires (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  proposal_id BIGINT UNSIGNED NOT NULL,
  tim_verifikasi_id BIGINT UNSIGNED NULL,
  verifikasi_type VARCHAR(30) NOT NULL DEFAULT 'kecamatan_tim',
  q1 TINYINT(1) NULL,
  q2 TINYINT(1) NULL,
  q3 TINYINT(1) NULL,
  q4 TINYINT(1) NULL,
  q5 TINYINT(1) NULL,
  q6 TINYINT(1) NULL,
  q7 TINYINT(1) NULL,
  q8 TINYINT(1) NULL,
  q9 TINYINT(1) NULL,
  q10 TINYINT(1) NULL,
  q11 TINYINT(1) NULL,
  q12 TINYINT(1) NULL,
  overall_notes TEXT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'draft',
  submitted_at TIMESTAMP NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uniq_bpq_proposal_tim (proposal_id, tim_verifikasi_id),
  KEY idx_bpq_proposal (proposal_id),
  KEY idx_bpq_tim (tim_verifikasi_id),
  KEY idx_bpq_type (verifikasi_type),
  CONSTRAINT fk_bpq_proposal FOREIGN KEY (proposal_id)
    REFERENCES bankeu_perubahan_proposals (id) ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT fk_bpq_tim FOREIGN KEY (tim_verifikasi_id)
    REFERENCES tim_verifikasi_bankeu_perubahan (id) ON DELETE CASCADE ON UPDATE NO ACTION
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
