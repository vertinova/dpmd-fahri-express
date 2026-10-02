-- Video Desa: bidang meminta video dari desa lewat tautan publik.
--
-- Alurnya seperti Google Forms, tapi isiannya video: bidang membuat satu
-- "permintaan" (judul + arahan konten), membagikan tautannya ke desa, lalu desa
-- mengunggah video lewat tautan itu tanpa login. Videonya dipakai untuk
-- videotron dan media sosial DPMD, jadi bidang meninjau (setujui/tolak) setiap
-- kiriman sebelum ditayangkan.
--
-- Semua statement idempoten (IF NOT EXISTS): runner mengirim file ini sebagai
-- SATU batch.

-- ============================================================
-- 1. Permintaan video (milik satu bidang)
-- ============================================================
CREATE TABLE IF NOT EXISTS `video_desa_permintaan` (
  `id`                BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `bidang_id`         BIGINT UNSIGNED NOT NULL,
  `judul`             VARCHAR(255) NOT NULL,
  -- Arahan konten untuk desa: tema, apa yang harus tampil, larangan, dsb.
  `deskripsi`         TEXT NULL DEFAULT NULL,
  -- Kunci tautan publik. Sengaja bukan id: id berurutan bisa ditebak.
  `token`             CHAR(32) NOT NULL,
  -- dibuka : menerima unggahan. ditutup: tautan hidup tapi menolak unggahan.
  `status`            ENUM('dibuka','ditutup') NOT NULL DEFAULT 'dibuka',
  -- Arahan orientasi. Videotron = lanskap 16:9, Reels/TikTok = potret 9:16.
  -- Tidak memblokir unggahan; kiriman yang tidak sesuai ditandai di daftar.
  `orientasi`         ENUM('bebas','lanskap','potret') NOT NULL DEFAULT 'bebas',
  -- Arahan durasi (detik). Sama seperti orientasi: penanda, bukan penolak.
  `maks_durasi_detik` INT UNSIGNED NULL DEFAULT NULL,
  -- Batas kiriman per desa — pengaman disk utama pada jalur tanpa login.
  `maks_per_desa`     INT UNSIGNED NOT NULL DEFAULT 2,
  `tutup_pada`        DATETIME NULL DEFAULT NULL,
  `created_by`        BIGINT UNSIGNED NULL DEFAULT NULL,
  `updated_by`        BIGINT UNSIGNED NULL DEFAULT NULL,
  `created_at`        TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`        TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `deleted_at`        TIMESTAMP NULL DEFAULT NULL,
  `deleted_by`        BIGINT UNSIGNED NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_video_desa_permintaan_token` (`token`),
  KEY `idx_video_desa_permintaan_bidang` (`bidang_id`, `deleted_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- 2. Kiriman video dari desa
-- ============================================================
CREATE TABLE IF NOT EXISTS `video_desa_kiriman` (
  `id`             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `permintaan_id`  BIGINT UNSIGNED NOT NULL,
  `desa_id`        BIGINT UNSIGNED NOT NULL,
  `nama_pengirim`  VARCHAR(150) NOT NULL,
  `no_hp`          VARCHAR(30) NULL DEFAULT NULL,
  `keterangan`     TEXT NULL DEFAULT NULL,
  -- Nama berkas asli dari perangkat pengirim (untuk nama unduhan).
  `nama_berkas`    VARCHAR(255) NOT NULL,
  `mime`           VARCHAR(100) NULL DEFAULT NULL,
  `ukuran`         BIGINT UNSIGNED NOT NULL DEFAULT 0,
  -- Hasil ffprobe; NULL bila ffprobe tidak tersedia/gagal membaca.
  `durasi_detik`   DECIMAL(10,2) NULL DEFAULT NULL,
  `lebar`          INT UNSIGNED NULL DEFAULT NULL,
  `tinggi`         INT UNSIGNED NULL DEFAULT NULL,
  `codec`          VARCHAR(30) NULL DEFAULT NULL,
  `nama_disk`      VARCHAR(120) NOT NULL,
  `jalur_disk`     VARCHAR(500) NOT NULL,
  -- masuk: belum ditinjau. disetujui: layak tayang. ditolak: tidak dipakai.
  `status`         ENUM('masuk','disetujui','ditolak') NOT NULL DEFAULT 'masuk',
  `catatan`        TEXT NULL DEFAULT NULL,
  `ditinjau_oleh`  BIGINT UNSIGNED NULL DEFAULT NULL,
  `ditinjau_pada`  TIMESTAMP NULL DEFAULT NULL,
  `ip`             VARCHAR(45) NULL DEFAULT NULL,
  `created_at`     TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_video_desa_kiriman_disk` (`nama_disk`),
  KEY `idx_video_desa_kiriman_permintaan` (`permintaan_id`, `created_at`),
  KEY `idx_video_desa_kiriman_desa` (`permintaan_id`, `desa_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
