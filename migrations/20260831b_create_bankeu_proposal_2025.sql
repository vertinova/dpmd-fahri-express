-- Proposal Bantuan Keuangan TA 2025 — unggahan sederhana dari desa langsung ke DPMD.
--
-- Alurnya sengaja dibuat sesederhana LPJ 2025 (`bankeu_lpj`): desa mengunggah
-- berkas, DPMD/SPKED melihat & mengunduh. TIDAK ada verifikasi kecamatan/dinas
-- dan tidak ada kolom status — kalau suatu saat butuh verifikasi, itu keputusan
-- baru, bukan menambal tabel ini diam-diam.
--
-- Satu desa boleh punya beberapa berkas per tahun, jadi (desa_id, tahun_anggaran)
-- hanya diindeks, bukan unique.
CREATE TABLE IF NOT EXISTS `bankeu_proposal_2025` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `desa_id` BIGINT UNSIGNED NOT NULL,
  `tahun_anggaran` YEAR NOT NULL DEFAULT 2025,
  `nama_file` VARCHAR(255) NOT NULL COMMENT 'Nama berkas asli dari desa',
  `file_path` VARCHAR(500) NOT NULL COMMENT 'Path relatif: {kecamatan_id}/{desa_id}/{filename}',
  `file_size` INT UNSIGNED NULL COMMENT 'Ukuran berkas dalam byte',
  `keterangan` TEXT NULL COMMENT 'Catatan/keterangan dari desa',
  `uploaded_by` BIGINT UNSIGNED NOT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  INDEX `idx_bankeu_proposal_2025_desa_id` (`desa_id`),
  INDEX `idx_bankeu_proposal_2025_tahun` (`tahun_anggaran`),
  INDEX `idx_bankeu_proposal_2025_desa_tahun` (`desa_id`, `tahun_anggaran`),
  INDEX `idx_bankeu_proposal_2025_uploaded_by` (`uploaded_by`),
  CONSTRAINT `fk_bankeu_proposal_2025_desa` FOREIGN KEY (`desa_id`) REFERENCES `desas` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_bankeu_proposal_2025_user` FOREIGN KEY (`uploaded_by`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
