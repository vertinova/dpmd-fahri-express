-- ============================================================
-- Migrasi: Fitur Anggaran Bidang DPMD
-- Tanggal: 2026-05-16
-- Revisi: Desain 3-layer (master tetap + pagu per tahun + item per tahun)
-- ============================================================

-- 1. Sub unit / sub bagian dalam bidang (sekretariat: 3 sub bagian)
CREATE TABLE IF NOT EXISTS `anggaran_bidang_units` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `bidang_id` BIGINT UNSIGNED NOT NULL,
  `nama` VARCHAR(255) NOT NULL,
  `kode` VARCHAR(50) NULL,
  `urutan` INT NOT NULL DEFAULT 1,
  `created_at` TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  INDEX `idx_bidang_id` (`bidang_id`),
  CONSTRAINT `fk_anggaran_bidang_units_bidang`
    FOREIGN KEY (`bidang_id`) REFERENCES `bidangs` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 2. MASTER Kegiatan (TETAP - tidak berubah tiap tahun)
--    Superadmin bisa CRUD. Nama program/kegiatan/sub kegiatan sama setiap tahun.
CREATE TABLE IF NOT EXISTS `anggaran_master_kegiatan` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `bidang_id` BIGINT UNSIGNED NOT NULL,
  `bidang_unit_id` BIGINT UNSIGNED NULL,
  `kode_program` VARCHAR(100) NULL,
  `nama_program` VARCHAR(500) NOT NULL,
  `kode_kegiatan` VARCHAR(100) NULL,
  `nama_kegiatan` VARCHAR(500) NOT NULL,
  `kode_sub_kegiatan` VARCHAR(100) NULL,
  `nama_sub_kegiatan` VARCHAR(500) NULL,
  `id_giat` INT NULL COMMENT 'ID kegiatan dari SIPD',
  `id_sub_giat` INT NULL COMMENT 'ID sub kegiatan dari SIPD',
  `urutan` INT NOT NULL DEFAULT 1,
  `is_active` TINYINT(1) NOT NULL DEFAULT 1,
  `created_by` BIGINT UNSIGNED NOT NULL,
  `created_at` TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  INDEX `idx_bidang_id` (`bidang_id`),
  INDEX `idx_bidang_unit_id` (`bidang_unit_id`),
  INDEX `idx_kode_kegiatan` (`kode_kegiatan`),
  INDEX `idx_kode_sub_kegiatan` (`kode_sub_kegiatan`),
  CONSTRAINT `fk_amk_bidang`
    FOREIGN KEY (`bidang_id`) REFERENCES `bidangs` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_amk_unit`
    FOREIGN KEY (`bidang_unit_id`) REFERENCES `anggaran_bidang_units` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_amk_user`
    FOREIGN KEY (`created_by`) REFERENCES `users` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 3. Pagu per kegiatan per tahun (BERUBAH tiap tahun)
--    Satu master_kegiatan bisa punya pagu berbeda tiap tahun.
CREATE TABLE IF NOT EXISTS `anggaran_pagu` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `master_kegiatan_id` BIGINT UNSIGNED NOT NULL,
  `tahun` INT NOT NULL,
  `pagu` DECIMAL(20,2) NOT NULL DEFAULT 0,
  `pagu_indikatif` DECIMAL(20,2) NULL DEFAULT 0,
  `created_by` BIGINT UNSIGNED NOT NULL,
  `created_at` TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_pagu_kegiatan_tahun` (`master_kegiatan_id`, `tahun`),
  INDEX `idx_tahun` (`tahun`),
  CONSTRAINT `fk_ap_master`
    FOREIGN KEY (`master_kegiatan_id`) REFERENCES `anggaran_master_kegiatan` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_ap_user`
    FOREIGN KEY (`created_by`) REFERENCES `users` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 4. Item RKA per pagu (BERUBAH tiap tahun — terikat ke anggaran_pagu)
--    Jenis SSH = Standar Satuan Harga, SBU = Standar Biaya Umum
CREATE TABLE IF NOT EXISTS `anggaran_rka_items` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `pagu_id` BIGINT UNSIGNED NOT NULL,
  `nama_item` VARCHAR(500) NOT NULL,
  `kode_rekening` VARCHAR(100) NULL,
  `satuan` VARCHAR(100) NOT NULL,
  `volume` DECIMAL(15,4) NOT NULL DEFAULT 1,
  `harga_satuan` DECIMAL(20,2) NOT NULL DEFAULT 0,
  `jenis_sht` ENUM('SSH','SBU') NOT NULL DEFAULT 'SSH',
  `kode_sht` VARCHAR(100) NULL COMMENT 'Kode referensi dari tabel SSH atau SBU',
  `keterangan` TEXT NULL,
  `urutan` INT NOT NULL DEFAULT 1,
  `created_by` BIGINT UNSIGNED NOT NULL,
  `created_at` TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  INDEX `idx_pagu_id` (`pagu_id`),
  CONSTRAINT `fk_ari_pagu`
    FOREIGN KEY (`pagu_id`) REFERENCES `anggaran_pagu` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_ari_user`
    FOREIGN KEY (`created_by`) REFERENCES `users` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- Seed: Sub Bagian Sekretariat (bidang_id = 2)
-- Sekretariat dibagi 3 sub bagian sesuai ketentuan
-- ============================================================
INSERT IGNORE INTO `anggaran_bidang_units` (`bidang_id`, `nama`, `kode`, `urutan`) VALUES
(2, 'Sub Bagian Program dan Laporan', 'SPL', 1),
(2, 'Sub Bagian Keuangan', 'SKU', 2),
(2, 'Sub Bagian Umum dan Kepegawaian', 'SUK', 3);
