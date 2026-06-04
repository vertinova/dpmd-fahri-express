-- ============================================================
-- Bankeu Perubahan: PDF Annotation + Document Versioning
--
-- Menambah:
--   1) Tabel bankeu_perubahan_proposal_versions  (snapshot file PDF Desa per versi)
--   2) Tabel bankeu_perubahan_revisions          (ronde anotasi Kecamatan)
--   3) Kolom bantu current_version + latest_revision_id di proposals
--
-- Idempotent & kompatibel MySQL production (tanpa ADD COLUMN IF NOT EXISTS).
-- ============================================================

-- 1) Tabel versi dokumen Desa
CREATE TABLE IF NOT EXISTS bankeu_perubahan_proposal_versions (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  proposal_id BIGINT UNSIGNED NOT NULL,
  version_number INT UNSIGNED NOT NULL,
  file_proposal VARCHAR(255) NOT NULL,
  file_size INT UNSIGNED NULL,
  source ENUM('initial','revision') NOT NULL DEFAULT 'initial',
  uploaded_by BIGINT UNSIGNED NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uniq_bppv_proposal_version (proposal_id, version_number),
  KEY idx_bppv_proposal (proposal_id),
  KEY idx_bppv_uploaded_by (uploaded_by),
  CONSTRAINT fk_bppv_proposal FOREIGN KEY (proposal_id)
    REFERENCES bankeu_perubahan_proposals (id) ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT fk_bppv_uploaded_by FOREIGN KEY (uploaded_by)
    REFERENCES users (id) ON DELETE SET NULL ON UPDATE NO ACTION
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 2) Tabel ronde anotasi Kecamatan
CREATE TABLE IF NOT EXISTS bankeu_perubahan_revisions (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  proposal_id BIGINT UNSIGNED NOT NULL,
  version_id BIGINT UNSIGNED NOT NULL,
  round_number INT UNSIGNED NOT NULL,
  annotation_data JSON NULL,
  annotated_pdf_path VARCHAR(255) NULL,
  catatan TEXT NULL,
  decision ENUM('revision','rejected') NOT NULL DEFAULT 'revision',
  annotated_by BIGINT UNSIGNED NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_bpr_proposal (proposal_id),
  KEY idx_bpr_version (version_id),
  KEY idx_bpr_annotated_by (annotated_by),
  CONSTRAINT fk_bpr_proposal FOREIGN KEY (proposal_id)
    REFERENCES bankeu_perubahan_proposals (id) ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT fk_bpr_version FOREIGN KEY (version_id)
    REFERENCES bankeu_perubahan_proposal_versions (id) ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT fk_bpr_annotated_by FOREIGN KEY (annotated_by)
    REFERENCES users (id) ON DELETE SET NULL ON UPDATE NO ACTION
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 3a) Kolom current_version di proposals
SET @column_exists := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'bankeu_perubahan_proposals'
    AND COLUMN_NAME = 'current_version'
);
SET @sql := IF(
  @column_exists = 0,
  'ALTER TABLE bankeu_perubahan_proposals ADD COLUMN current_version INT UNSIGNED NOT NULL DEFAULT 1 AFTER file_size',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 3b) Kolom latest_revision_id di proposals
SET @column_exists := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'bankeu_perubahan_proposals'
    AND COLUMN_NAME = 'latest_revision_id'
);
SET @sql := IF(
  @column_exists = 0,
  'ALTER TABLE bankeu_perubahan_proposals ADD COLUMN latest_revision_id BIGINT UNSIGNED NULL AFTER current_version',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 3c) Kolom kecamatan_annotation_draft (draft anotasi yg belum difinalisasi)
SET @column_exists := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'bankeu_perubahan_proposals'
    AND COLUMN_NAME = 'kecamatan_annotation_draft'
);
SET @sql := IF(
  @column_exists = 0,
  'ALTER TABLE bankeu_perubahan_proposals ADD COLUMN kecamatan_annotation_draft JSON NULL AFTER latest_revision_id',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 4) Backfill: jadikan file_proposal saat ini sebagai versi 1 untuk proposal lama
INSERT INTO bankeu_perubahan_proposal_versions
  (proposal_id, version_number, file_proposal, file_size, source, uploaded_by, created_at)
SELECT bp.id, 1, bp.file_proposal, bp.file_size, 'initial', bp.created_by, bp.created_at
FROM bankeu_perubahan_proposals bp
WHERE bp.file_proposal IS NOT NULL
  AND bp.file_proposal <> ''
  AND NOT EXISTS (
    SELECT 1 FROM bankeu_perubahan_proposal_versions v
    WHERE v.proposal_id = bp.id AND v.version_number = 1
  );
