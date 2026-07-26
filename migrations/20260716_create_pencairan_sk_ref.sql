-- =============================================================
-- Modul Pencairan — Referensi SK (statis per tahun anggaran)
-- =============================================================
-- Menyimpan SK yang dipakai berulang di dokumen pencairan:
--   - jenis = 'bupati_kpa' : SK Bupati tentang penunjukan KPA  (muncul di BASTHP)
--   - jenis = 'kadis_ppk'  : SK Kepala Dinas tentang penunjukan PPK (muncul di BAST, BASTHP)
--
-- Dikategorikan per `tahun`. Frontend menampilkan SK tahun berjalan
-- lebih dulu, tahun lain di bawah. Bisa dipilih ulang tiap pencairan.
-- =============================================================

CREATE TABLE IF NOT EXISTS `pencairan_sk_ref` (
  `id`         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `jenis`      VARCHAR(20)     NOT NULL COMMENT 'bupati_kpa | kadis_ppk',
  `tahun`      INT             NOT NULL,
  `nomor`      VARCHAR(255)    NOT NULL,
  `tanggal`    DATE            NULL,
  `keterangan` VARCHAR(255)    NULL,
  `created_by` BIGINT UNSIGNED NULL,
  `created_at` TIMESTAMP       NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP       NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_sk_ref_jenis_tahun_nomor` (`jenis`, `tahun`, `nomor`),
  KEY `idx_sk_ref_jenis_tahun` (`jenis`, `tahun`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
