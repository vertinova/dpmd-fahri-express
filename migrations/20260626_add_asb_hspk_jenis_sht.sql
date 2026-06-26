-- ============================================================
-- Migrasi: Tambah ASB & HSPK ke enum jenis_sht item RKA
-- Tanggal: 2026-06-26
-- ============================================================

ALTER TABLE `anggaran_rka_items`
  MODIFY COLUMN `jenis_sht` ENUM('SSH','SBU','ASB','HSPK') NOT NULL DEFAULT 'SSH';
