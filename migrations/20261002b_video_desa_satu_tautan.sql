-- Video Desa: satu tautan untuk semua bidang + pemeriksaan keamanan video.
--
-- 1. Desa cukup menerima SATU tautan, dikelola Bidang Sekretariat. Di dalamnya
--    tampil card setiap kegiatan video dari semua bidang; tautan per kegiatan
--    tidak dibagikan lagi. Tabel ini hanya berisi satu baris (id = 1).
--    Sengaja tidak di app_settings: tabel itu bisa dibaca tanpa login, padahal
--    menutup tautan baru berarti kalau tokennya tidak bisa diintip ulang.
--
-- 2. Setiap video dari desa dibangun ulang dengan ffmpeg menjadi MP4
--    H.264/AAC yang bersih sebelum bisa diputar bidang. Kolom `pemrosesan`
--    mencatat tahapnya; video hanya bisa diputar/diunduh setelah `siap`.
--
-- Runner mengirim file sebagai satu batch dan menganggap galat "sudah ada"
-- sebagai lewati, jadi perubahan kolom ditulis dalam SATU ALTER.

CREATE TABLE IF NOT EXISTS `video_desa_tautan` (
  `id`         INT UNSIGNED NOT NULL,
  `token`      CHAR(32) NOT NULL,
  `status`     ENUM('dibuka','ditutup') NOT NULL DEFAULT 'dibuka',
  `updated_by` BIGINT UNSIGNED NULL DEFAULT NULL,
  `created_at` TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_video_desa_tautan_token` (`token`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE `video_desa_kiriman`
  -- antre/diproses: sedang dibangun ulang. siap: aman diputar. gagal: ditolak
  -- pemeriksa (bukan video sah, rusak, atau terlalu panjang).
  ADD COLUMN `pemrosesan`   ENUM('antre','diproses','siap','gagal') NOT NULL DEFAULT 'antre' AFTER `status`,
  ADD COLUMN `pesan_proses` VARCHAR(500) NULL DEFAULT NULL AFTER `pemrosesan`,
  -- Ukuran berkas yang diunggah desa; `ukuran` menjadi ukuran hasil bersih.
  ADD COLUMN `ukuran_asli`  BIGINT UNSIGNED NOT NULL DEFAULT 0 AFTER `ukuran`,
  -- Sidik jari berkas hasil, untuk audit dan mendeteksi kiriman kembar.
  ADD COLUMN `sha256`       CHAR(64) NULL DEFAULT NULL AFTER `ukuran_asli`,
  ADD KEY `idx_video_desa_kiriman_proses` (`pemrosesan`);
