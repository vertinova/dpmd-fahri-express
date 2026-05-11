-- Migration: add imported flag to pengurus + all lembaga tables
-- Date: 2026-05-10
--
-- Records created via the bulk-import script (from output_template_pengurus_kelembagaan_*.xlsx)
-- are marked imported = TRUE so they can be told apart from rows manually
-- created from the web UI (which keep imported = FALSE).
--
-- Update behaviour:
--   - Web/API CREATE  → imported = FALSE (column default)
--   - Web/API UPDATE  → imported is preserved (controllers must NOT touch it)
--   - Bulk import     → INSERT new rows with imported = TRUE
--                     → UPDATE existing rows ONLY when current imported = TRUE
--                       (rows with imported = FALSE were edited manually and
--                       must not be overwritten by the importer).

-- pengurus
ALTER TABLE pengurus
  ADD COLUMN imported TINYINT(1) NOT NULL DEFAULT 0 AFTER status_verifikasi,
  ADD INDEX pengurus_imported_index (imported);

-- rws
ALTER TABLE rws
  ADD COLUMN imported TINYINT(1) NOT NULL DEFAULT 0 AFTER status_verifikasi,
  ADD INDEX rws_imported_index (imported);

-- rts
ALTER TABLE rts
  ADD COLUMN imported TINYINT(1) NOT NULL DEFAULT 0 AFTER status_verifikasi,
  ADD INDEX rts_imported_index (imported);

-- posyandus
ALTER TABLE posyandus
  ADD COLUMN imported TINYINT(1) NOT NULL DEFAULT 0 AFTER status_verifikasi,
  ADD INDEX posyandus_imported_index (imported);

-- karang_tarunas
ALTER TABLE karang_tarunas
  ADD COLUMN imported TINYINT(1) NOT NULL DEFAULT 0 AFTER status_verifikasi,
  ADD INDEX karang_tarunas_imported_index (imported);

-- lpms
ALTER TABLE lpms
  ADD COLUMN imported TINYINT(1) NOT NULL DEFAULT 0 AFTER status_verifikasi,
  ADD INDEX lpms_imported_index (imported);

-- pkks
ALTER TABLE pkks
  ADD COLUMN imported TINYINT(1) NOT NULL DEFAULT 0 AFTER status_verifikasi,
  ADD INDEX pkks_imported_index (imported);

-- satlinmas
ALTER TABLE satlinmas
  ADD COLUMN imported TINYINT(1) NOT NULL DEFAULT 0 AFTER status_verifikasi,
  ADD INDEX satlinmas_imported_index (imported);

-- lembaga_lainnyas
ALTER TABLE lembaga_lainnyas
  ADD COLUMN imported TINYINT(1) NOT NULL DEFAULT 0 AFTER status_verifikasi,
  ADD INDEX lembaga_lainnyas_imported_index (imported);
