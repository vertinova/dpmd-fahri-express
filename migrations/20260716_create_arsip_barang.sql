-- =============================================================
-- Modul Arsip Barang — Bidang Sekretariat (bidang_id = 2)
-- =============================================================
-- Setiap barang punya identitas digital permanen:
--   kode_barang  → dicetak sebagai teks di label (dibaca manusia)
--   public_token → dipakai di URL QR (acak, tidak bisa ditebak)
--
-- Tabel:
--   1. arsip_barang_kategori  — master kategori barang
--   2. arsip_barang           — master barang + perolehan + penghapusan
--   3. arsip_barang_mutasi    — riwayat perubahan lokasi/kondisi/pemegang
--   4. arsip_barang_scan_log  — jejak setiap scan QR
-- =============================================================

-- 1. Master Kategori
CREATE TABLE IF NOT EXISTS `arsip_barang_kategori` (
  `id`         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `nama`       VARCHAR(150)    NOT NULL,
  `kode`       VARCHAR(10)     NOT NULL COMMENT 'Kode singkat kategori, mis. ELK untuk Elektronik',
  `deskripsi`  VARCHAR(255)    NULL,
  `is_active`  TINYINT(1)      NOT NULL DEFAULT 1,
  `created_at` TIMESTAMP       NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP       NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_arsip_barang_kategori_kode` (`kode`),
  KEY `idx_arsip_barang_kategori_active` (`is_active`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 2. Master Barang
CREATE TABLE IF NOT EXISTS `arsip_barang` (
  `id`                   BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,

  -- Identitas
  `kode_barang`          VARCHAR(50)     NOT NULL COMMENT 'Format: DPMD-SEK-{tahun}-{urut4}, dicetak di label',
  `public_token`         VARCHAR(32)     NOT NULL COMMENT 'Token acak untuk URL QR publik (anti-enumerasi)',
  `nama`                 VARCHAR(255)    NOT NULL,
  `kategori_id`          BIGINT UNSIGNED NULL,
  `merk_tipe`            VARCHAR(255)    NULL,
  `nomor_seri`           VARCHAR(120)    NULL,
  `foto`                 VARCHAR(255)    NULL COMMENT 'Path relatif di storage/uploads/arsip-barang',
  `jumlah`               INT             NOT NULL DEFAULT 1,
  `satuan`               VARCHAR(30)     NOT NULL DEFAULT 'Unit',
  `kondisi`              ENUM('baik','rusak_ringan','rusak_berat') NOT NULL DEFAULT 'baik',
  `lokasi`               VARCHAR(255)    NULL COMMENT 'Ruangan / penempatan barang',

  -- Pemegang / penanggung jawab
  `pemegang_user_id`     BIGINT UNSIGNED NULL,
  `pemegang_nama`        VARCHAR(255)    NULL COMMENT 'Diisi bila pemegang bukan user sistem',

  -- Data perolehan
  `tanggal_perolehan`    DATE            NULL,
  `sumber_dana`          ENUM('apbd','apbn','hibah','lainnya') NULL,
  `nilai_perolehan`      DECIMAL(18,2)   NULL,
  `nomor_kontrak`        VARCHAR(120)    NULL,
  `nomor_faktur`         VARCHAR(120)    NULL,

  -- Penghapusan aset
  `status`               ENUM('aktif','dihapuskan') NOT NULL DEFAULT 'aktif',
  `tanggal_penghapusan`  DATE            NULL,
  `alasan_penghapusan`   TEXT            NULL,
  `nomor_ba_penghapusan` VARCHAR(120)    NULL,

  `keterangan`           TEXT            NULL,
  `bidang_id`            BIGINT UNSIGNED NULL DEFAULT 2,
  `created_by`           BIGINT UNSIGNED NULL,
  `updated_by`           BIGINT UNSIGNED NULL,
  `created_at`           TIMESTAMP       NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`           TIMESTAMP       NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_arsip_barang_kode`  (`kode_barang`),
  UNIQUE KEY `uq_arsip_barang_token` (`public_token`),
  KEY `idx_arsip_barang_nama`     (`nama`),
  KEY `idx_arsip_barang_kategori` (`kategori_id`),
  KEY `idx_arsip_barang_kondisi`  (`kondisi`),
  KEY `idx_arsip_barang_status`   (`status`),
  KEY `idx_arsip_barang_lokasi`   (`lokasi`),
  KEY `idx_arsip_barang_pemegang` (`pemegang_user_id`),
  CONSTRAINT `fk_arsip_barang_kategori` FOREIGN KEY (`kategori_id`)      REFERENCES `arsip_barang_kategori`(`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_arsip_barang_pemegang` FOREIGN KEY (`pemegang_user_id`) REFERENCES `users`(`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_arsip_barang_creator`  FOREIGN KEY (`created_by`)       REFERENCES `users`(`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_arsip_barang_updater`  FOREIGN KEY (`updated_by`)       REFERENCES `users`(`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 3. Riwayat Mutasi
CREATE TABLE IF NOT EXISTS `arsip_barang_mutasi` (
  `id`         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `barang_id`  BIGINT UNSIGNED NOT NULL,
  `jenis`      ENUM('lokasi','kondisi','pemegang','status','lainnya') NOT NULL,
  `nilai_lama` VARCHAR(255)    NULL,
  `nilai_baru` VARCHAR(255)    NULL,
  `catatan`    TEXT            NULL,
  `user_id`    BIGINT UNSIGNED NULL,
  `user_name`  VARCHAR(255)    NULL,
  `created_at` TIMESTAMP       NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_arsip_barang_mutasi_barang` (`barang_id`, `created_at`),
  CONSTRAINT `fk_arsip_barang_mutasi_barang` FOREIGN KEY (`barang_id`) REFERENCES `arsip_barang`(`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_arsip_barang_mutasi_user`   FOREIGN KEY (`user_id`)   REFERENCES `users`(`id`)        ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 4. Jejak Scan QR
CREATE TABLE IF NOT EXISTS `arsip_barang_scan_log` (
  `id`         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `barang_id`  BIGINT UNSIGNED NOT NULL,
  `source`     ENUM('public','internal') NOT NULL DEFAULT 'public' COMMENT 'public = scan tanpa login',
  `user_id`    BIGINT UNSIGNED NULL COMMENT 'Terisi bila pemindai sedang login',
  `user_name`  VARCHAR(255)    NULL,
  `ip_address` VARCHAR(45)     NULL,
  `user_agent` VARCHAR(500)    NULL,
  `created_at` TIMESTAMP       NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_arsip_barang_scan_barang` (`barang_id`, `created_at`),
  CONSTRAINT `fk_arsip_barang_scan_barang` FOREIGN KEY (`barang_id`) REFERENCES `arsip_barang`(`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_arsip_barang_scan_user`   FOREIGN KEY (`user_id`)   REFERENCES `users`(`id`)        ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Seed kategori awal
INSERT INTO `arsip_barang_kategori` (`nama`, `kode`, `deskripsi`) VALUES
  ('Elektronik',        'ELK', 'Komputer, laptop, printer, proyektor'),
  ('Meubelair',         'MBL', 'Meja, kursi, lemari, filing cabinet'),
  ('Kendaraan Dinas',   'KND', 'Kendaraan roda dua dan roda empat'),
  ('Alat Rumah Tangga', 'ART', 'AC, dispenser, perlengkapan kantor'),
  ('Jaringan & Server', 'JRS', 'Perangkat jaringan, server, UPS'),
  ('Lainnya',           'LNY', 'Barang di luar kategori di atas')
ON DUPLICATE KEY UPDATE `nama` = VALUES(`nama`);
