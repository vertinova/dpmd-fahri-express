-- Migration: Add Dinas Reviewed File Mirroring
-- Date: 2026-02-02
-- Purpose: Menyimpan file reference dari hasil review dinas terkait
--          agar kecamatan punya acuan saat verifikasi ulang

-- Add dinas_reviewed_file column (mirroring file dari dinas)
-- Split into separate statements so auto-migrate can skip individually (errno 1060)
ALTER TABLE bankeu_proposals ADD COLUMN dinas_reviewed_file VARCHAR(255) NULL AFTER file_proposal;
ALTER TABLE bankeu_proposals ADD COLUMN dinas_reviewed_at TIMESTAMP NULL AFTER dinas_reviewed_file;

-- Add comment
ALTER TABLE bankeu_proposals 
MODIFY COLUMN dinas_reviewed_file VARCHAR(255) NULL COMMENT 'File proposal yang sudah direview oleh dinas terkait (reference untuk kecamatan)',
MODIFY COLUMN dinas_reviewed_at TIMESTAMP NULL COMMENT 'Timestamp kapan dinas melakukan review';
-- DROP INDEX IF EXISTS idx_dinas_reviewed_at ON bankeu_proposals;
