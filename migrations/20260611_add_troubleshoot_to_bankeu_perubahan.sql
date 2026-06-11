-- Tambah kolom troubleshoot pada bankeu_perubahan_proposals
-- Dipakai fitur "Troubleshoot Revisi" DPMD: paksa kembalikan proposal nyangkut/salah-ACC ke Desa.
-- Mengikuti pola tabel bankeu_proposals (reguler) yang sudah punya kolom serupa.

ALTER TABLE `bankeu_perubahan_proposals`
  ADD COLUMN `troubleshoot_catatan` TEXT NULL AFTER `catatan_verifikasi`,
  ADD COLUMN `troubleshoot_by` BIGINT UNSIGNED NULL AFTER `troubleshoot_catatan`,
  ADD COLUMN `troubleshoot_at` TIMESTAMP NULL AFTER `troubleshoot_by`,
  ADD INDEX `idx_bp_troubleshoot_by` (`troubleshoot_by`);
