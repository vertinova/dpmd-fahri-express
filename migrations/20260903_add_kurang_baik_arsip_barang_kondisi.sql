-- ============================================================
-- Migrasi: Tambah 'kurang_baik' ke enum kondisi arsip_barang
-- Sebelumnya hanya baik/rusak_ringan/rusak_berat — kurang granular
-- untuk barang yang belum rusak tapi sudah tidak dalam kondisi baik.
-- Tanggal: 2026-09-03
-- ============================================================

ALTER TABLE `arsip_barang`
  MODIFY COLUMN `kondisi` ENUM('baik','kurang_baik','rusak_ringan','rusak_berat') NOT NULL DEFAULT 'baik';
