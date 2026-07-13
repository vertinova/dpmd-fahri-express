-- =============================================================
-- Modul Pencairan — Realisasi belanja dari item anggaran
-- =============================================================
-- Desain GENERIC: 1 set tabel untuk semua jenis pencairan
--   (ATK, Cetak, Makan Minum, Perjadin, Jasa, Hibah, dll)
--
-- Tabel:
--   1. penyedia              — master pihak ketiga / vendor
--   2. pencairan             — header transaksi (semua jenis)
--   3. pencairan_items       — detail item yang direalisasikan
--   4. pencairan_pemeriksa   — tim pemeriksa hasil pekerjaan (umumnya 3 orang)
-- =============================================================

-- 1. Master Penyedia / Pihak Ketiga
CREATE TABLE IF NOT EXISTS `penyedia` (
  `id`               BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `nama`             VARCHAR(255)    NOT NULL,
  `alamat`           TEXT            NULL,
  `npwp`             VARCHAR(50)     NULL,
  `nama_direktur`    VARCHAR(255)    NULL,
  `jabatan_direktur` VARCHAR(100)    NULL DEFAULT 'Direktur',
  `no_rekening`      VARCHAR(50)     NULL,
  `nama_bank`        VARCHAR(100)    NULL,
  `telepon`          VARCHAR(30)     NULL,
  `email`            VARCHAR(150)    NULL,
  `is_active`        TINYINT(1)      NOT NULL DEFAULT 1,
  `created_by`       BIGINT UNSIGNED NULL,
  `created_at`       TIMESTAMP       NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`       TIMESTAMP       NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_penyedia_nama`   (`nama`),
  KEY `idx_penyedia_active` (`is_active`),
  CONSTRAINT `fk_penyedia_creator` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 2. Header Pencairan (GENERIC — untuk semua jenis pencairan)
CREATE TABLE IF NOT EXISTS `pencairan` (
  `id`                              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,

  -- Jenis pencairan (membedakan modul)
  `jenis_pencairan`                 ENUM('atk','cetak','makmin','perjadin','jasa','hibah','lainnya')
                                    NOT NULL DEFAULT 'atk',

  -- Referensi anggaran (semua pencairan WAJIB linked ke item anggaran)
  `master_kegiatan_id`              BIGINT UNSIGNED NOT NULL COMMENT 'FK anggaran_master_kegiatan',
  `pagu_id`                         BIGINT UNSIGNED NOT NULL COMMENT 'FK anggaran_pagu (per tahun)',
  `tahun_anggaran`                  INT             NOT NULL,
  `bidang_id`                       BIGINT UNSIGNED NOT NULL,
  `uraian_kegiatan`                 TEXT            NULL,

  -- Penyedia (NULL untuk pencairan non-vendor seperti perjadin/hibah pribadi)
  `penyedia_id`                     BIGINT UNSIGNED NULL,

  -- Pejabat (referensi ke users; semua nullable karena beda jenis pakai peran beda)
  `ppk_id`                          BIGINT UNSIGNED NULL COMMENT 'Pejabat Pembuat Komitmen',
  `kpa_id`                          BIGINT UNSIGNED NULL COMMENT 'Kuasa Pengguna Anggaran',
  `pptk_id`                         BIGINT UNSIGNED NULL COMMENT 'Pejabat Pelaksana Teknis Kegiatan',
  `bendahara_pengeluaran_id`        BIGINT UNSIGNED NULL COMMENT 'Bendahara Pengeluaran Pembantu',
  `pengurus_barang_id`              BIGINT UNSIGNED NULL COMMENT 'Khusus pencairan barang (ATK/Cetak)',
  `atasan_pengurus_barang_id`       BIGINT UNSIGNED NULL,
  `penerima_faktur_id`              BIGINT UNSIGNED NULL,

  -- Tanggal dokumen
  `tgl_pesanan`                     DATE NULL,
  `tgl_surat_perintah_tugas`        DATE NULL,
  `tgl_faktur`                      DATE NULL,
  `tgl_kwitansi`                    DATE NULL,
  `tgl_ba_pemeriksaan`              DATE NULL,
  `tgl_bast`                        DATE NULL,
  `tgl_basthp`                      DATE NULL,

  -- Nomor surat
  `no_pesanan_a`                    VARCHAR(150) NULL COMMENT 'BP/PPBJ',
  `no_pesanan_b`                    VARCHAR(150) NULL COMMENT 'Umpeg',
  `no_faktur`                       VARCHAR(150) NULL,
  `no_kwitansi`                     VARCHAR(150) NULL,
  `no_ba_pemeriksaan`               VARCHAR(150) NULL,
  `no_bast`                         VARCHAR(150) NULL,
  `no_basthp`                       VARCHAR(150) NULL,
  `no_bappbj`                       VARCHAR(150) NULL,
  `no_lampiran_bat`                 VARCHAR(150) NULL,
  `no_surat_perintah_tugas`         VARCHAR(150) NULL,
  `no_sk_bupati_kpa`                VARCHAR(150) NULL,
  `no_sk_kadis_ppk`                 VARCHAR(150) NULL,

  -- Total & terbilang
  `total_nilai`                     DECIMAL(20,2) NOT NULL DEFAULT 0,
  `total_terbilang`                 VARCHAR(500)  NULL,

  -- Metadata fleksibel untuk field khusus per jenis pencairan
  -- contoh: { "pelaku_perjadin_id": 12, "tujuan": "Jakarta", "lama_hari": 3 } untuk perjadin
  `metadata`                        JSON NULL,

  -- Status
  `status`                          ENUM('draft','finalized','cancelled') NOT NULL DEFAULT 'draft',
  `finalized_at`                    TIMESTAMP NULL DEFAULT NULL,
  `finalized_by`                    BIGINT UNSIGNED NULL,

  `created_by`                      BIGINT UNSIGNED NOT NULL,
  `created_at`                      TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`                      TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  PRIMARY KEY (`id`),
  KEY `idx_pc_jenis`     (`jenis_pencairan`),
  KEY `idx_pc_master`    (`master_kegiatan_id`),
  KEY `idx_pc_pagu`      (`pagu_id`),
  KEY `idx_pc_bidang`    (`bidang_id`),
  KEY `idx_pc_penyedia`  (`penyedia_id`),
  KEY `idx_pc_tahun`     (`tahun_anggaran`),
  KEY `idx_pc_status`    (`status`),
  CONSTRAINT `fk_pc_master`        FOREIGN KEY (`master_kegiatan_id`)        REFERENCES `anggaran_master_kegiatan`(`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_pc_pagu`          FOREIGN KEY (`pagu_id`)                   REFERENCES `anggaran_pagu`(`id`)            ON DELETE RESTRICT,
  CONSTRAINT `fk_pc_bidang`        FOREIGN KEY (`bidang_id`)                 REFERENCES `bidangs`(`id`)                  ON DELETE RESTRICT,
  CONSTRAINT `fk_pc_penyedia`      FOREIGN KEY (`penyedia_id`)               REFERENCES `penyedia`(`id`)                 ON DELETE RESTRICT,
  CONSTRAINT `fk_pc_ppk`           FOREIGN KEY (`ppk_id`)                    REFERENCES `users`(`id`)                    ON DELETE SET NULL,
  CONSTRAINT `fk_pc_kpa`           FOREIGN KEY (`kpa_id`)                    REFERENCES `users`(`id`)                    ON DELETE SET NULL,
  CONSTRAINT `fk_pc_pptk`          FOREIGN KEY (`pptk_id`)                   REFERENCES `users`(`id`)                    ON DELETE SET NULL,
  CONSTRAINT `fk_pc_bendahara`     FOREIGN KEY (`bendahara_pengeluaran_id`)  REFERENCES `users`(`id`)                    ON DELETE SET NULL,
  CONSTRAINT `fk_pc_pengurus`      FOREIGN KEY (`pengurus_barang_id`)        REFERENCES `users`(`id`)                    ON DELETE SET NULL,
  CONSTRAINT `fk_pc_atasan_pb`     FOREIGN KEY (`atasan_pengurus_barang_id`) REFERENCES `users`(`id`)                    ON DELETE SET NULL,
  CONSTRAINT `fk_pc_penerima_fak`  FOREIGN KEY (`penerima_faktur_id`)        REFERENCES `users`(`id`)                    ON DELETE SET NULL,
  CONSTRAINT `fk_pc_finalized_by`  FOREIGN KEY (`finalized_by`)              REFERENCES `users`(`id`)                    ON DELETE SET NULL,
  CONSTRAINT `fk_pc_creator`       FOREIGN KEY (`created_by`)                REFERENCES `users`(`id`)                    ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 3. Detail item yang direalisasikan (semua jenis pencairan)
CREATE TABLE IF NOT EXISTS `pencairan_items` (
  `id`                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `pencairan_id`        BIGINT UNSIGNED NOT NULL,
  `rka_item_id`         BIGINT UNSIGNED NULL COMMENT 'FK anggaran_rka_items (sumber)',
  `nama_barang`         VARCHAR(500)    NOT NULL,
  `spesifikasi`         TEXT            NULL,
  `kode_rekening`       VARCHAR(500)    NULL,
  `qty`                 DECIMAL(15,4)   NOT NULL DEFAULT 1,
  `satuan`              VARCHAR(100)    NOT NULL,
  `harga_satuan`        DECIMAL(20,2)   NOT NULL DEFAULT 0,
  `ppn`                 DECIMAL(20,2)   NOT NULL DEFAULT 0,
  `total`               DECIMAL(20,2)   NOT NULL DEFAULT 0 COMMENT 'qty * harga_satuan',
  `status_pemeriksaan`  ENUM('baik','kurang_baik') NOT NULL DEFAULT 'baik',
  `urutan`              INT             NOT NULL DEFAULT 1,
  `created_at`          TIMESTAMP       NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`          TIMESTAMP       NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_pci_pc`  (`pencairan_id`),
  KEY `idx_pci_rka` (`rka_item_id`),
  CONSTRAINT `fk_pci_pc`  FOREIGN KEY (`pencairan_id`) REFERENCES `pencairan`(`id`)             ON DELETE CASCADE,
  CONSTRAINT `fk_pci_rka` FOREIGN KEY (`rka_item_id`)  REFERENCES `anggaran_rka_items`(`id`)   ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 4. Tim pemeriksa hasil pekerjaan (per pencairan, umumnya 3 orang)
CREATE TABLE IF NOT EXISTS `pencairan_pemeriksa` (
  `id`            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `pencairan_id`  BIGINT UNSIGNED NOT NULL,
  `user_id`       BIGINT UNSIGNED NOT NULL,
  `peran`         ENUM('ketua','anggota') NOT NULL DEFAULT 'anggota',
  `urutan`        INT             NOT NULL DEFAULT 1,
  `created_at`    TIMESTAMP       NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_pcp_pc_urutan` (`pencairan_id`, `urutan`),
  KEY `idx_pcp_user` (`user_id`),
  CONSTRAINT `fk_pcp_pc`   FOREIGN KEY (`pencairan_id`) REFERENCES `pencairan`(`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_pcp_user` FOREIGN KEY (`user_id`)     REFERENCES `users`(`id`)     ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
