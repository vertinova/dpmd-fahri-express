-- =============================================================
-- Modul Anggaran Kas (Angkas) — rencana penarikan/pencairan dana
-- =============================================================
-- Anggaran Kas memecah anggaran tiap sub kegiatan (pagu per tahun)
-- menjadi rencana pencairan per BULAN (Jan–Des) dalam satu tahun.
-- Disimpan per KODE REKENING; total per sub kegiatan = Σ rekening.
-- Tampilan triwulan (TW I–IV) dihitung dari agregasi bulanan.
--
-- Idealnya Σ m1..m12 per rekening = plafon RKA rekening tsb, tapi
-- tidak dipaksa (deviasi hanya ditandai di UI, bukan diblok).
-- =============================================================

CREATE TABLE IF NOT EXISTS `anggaran_kas` (
  `id`            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `pagu_id`       BIGINT UNSIGNED NOT NULL,
  `kode_rekening` VARCHAR(500)    NOT NULL DEFAULT '' COMMENT 'kode rekening item RKA; "" = tanpa rekening',
  `m1`  DECIMAL(20,2) NOT NULL DEFAULT 0.00,
  `m2`  DECIMAL(20,2) NOT NULL DEFAULT 0.00,
  `m3`  DECIMAL(20,2) NOT NULL DEFAULT 0.00,
  `m4`  DECIMAL(20,2) NOT NULL DEFAULT 0.00,
  `m5`  DECIMAL(20,2) NOT NULL DEFAULT 0.00,
  `m6`  DECIMAL(20,2) NOT NULL DEFAULT 0.00,
  `m7`  DECIMAL(20,2) NOT NULL DEFAULT 0.00,
  `m8`  DECIMAL(20,2) NOT NULL DEFAULT 0.00,
  `m9`  DECIMAL(20,2) NOT NULL DEFAULT 0.00,
  `m10` DECIMAL(20,2) NOT NULL DEFAULT 0.00,
  `m11` DECIMAL(20,2) NOT NULL DEFAULT 0.00,
  `m12` DECIMAL(20,2) NOT NULL DEFAULT 0.00,
  `keterangan` VARCHAR(255) NULL,
  `created_by` BIGINT UNSIGNED NULL,
  `created_at` TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_angkas_pagu_rekening` (`pagu_id`, `kode_rekening`),
  KEY `idx_angkas_pagu` (`pagu_id`),
  CONSTRAINT `fk_angkas_pagu` FOREIGN KEY (`pagu_id`)
    REFERENCES `anggaran_pagu` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
