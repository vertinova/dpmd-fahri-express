-- ============================================================
-- Migrasi: Tambah 'Lainnya' ke enum jenis_sht item RKA
-- Untuk item custom di luar katalog SSH/SBU/ASB/HSPK
-- Tanggal: 2026-06-30
-- ============================================================

ALTER TABLE `anggaran_rka_items`
  MODIFY COLUMN `jenis_sht` ENUM('SSH','SBU','ASB','HSPK','Lainnya') NOT NULL DEFAULT 'SSH';
