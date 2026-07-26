-- =============================================================
-- Master Nama Rekening (custom) — override nama kode rekening
-- =============================================================
-- Menyimpan nama rekening yang diberikan user untuk tiap kode rekening.
-- Dipakai di Anggaran Kas & laporan agar kode rekening tampil dengan nama
-- yang dikenal user (bukan sekadar angka). Bila kode tidak ada di sini,
-- sistem jatuh ke peta bawaan (rekening_belanja.json) lalu prefix hierarki.
-- =============================================================

CREATE TABLE IF NOT EXISTS `rekening_ref` (
  `id`            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `kode_rekening` VARCHAR(500)    NOT NULL,
  `nama`          VARCHAR(255)    NOT NULL,
  `created_by`    BIGINT UNSIGNED NULL,
  `created_at`    TIMESTAMP       NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`    TIMESTAMP       NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_rekening_ref_kode` (`kode_rekening`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
