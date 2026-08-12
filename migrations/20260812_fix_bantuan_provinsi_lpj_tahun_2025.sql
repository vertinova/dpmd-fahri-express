-- Migration: LPJ Bantuan Provinsi sebenarnya program TA 2025, bukan 2026.
-- Tabel dibuat (20260714) dengan default 2026, jadi baris yang sudah terlanjur
-- masuk perlu digeser ke 2025 agar tetap terlihat di halaman desa & monitoring DPMD.

UPDATE `bantuan_provinsi_lpj`
SET `tahun_anggaran` = 2025
WHERE `tahun_anggaran` = 2026;

ALTER TABLE `bantuan_provinsi_lpj`
  MODIFY COLUMN `tahun_anggaran` YEAR NOT NULL DEFAULT 2025;
