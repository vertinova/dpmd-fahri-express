-- =============================================================
-- Absensi: Titik Lokasi Khusus per Pegawai
-- =============================================================
-- Kasus: sebagian pegawai bertugas rutin di luar kantor, tapi absensinya
-- tetap REGULER (bukan WFH/WFA/dinas luar). Superadmin menetapkan titik
-- koordinat tertentu tempat pegawai itu boleh absen reguler.
--
-- Aturan:
--   - Titik khusus MENAMBAH, tidak menggantikan: pegawai tetap boleh absen
--     dari kantor DPMD seperti biasa.
--   - Satu pegawai boleh punya lebih dari satu titik.
--   - Radius diatur per titik (default 500 m, sama seperti kantor).
--   - berlaku_mulai / berlaku_sampai opsional; NULL = berlaku terus sampai
--     dinonaktifkan atau dihapus.
--   - Titik diidentifikasi murni dari koordinat — tanpa nama lokasi.
--
-- CATATAN DEPLOY: sejak modul ini, `prisma db push` sudah cukup untuk membuat
-- struktur tabel. Berkas ini disimpan sebagai dokumentasi maksud desain.
-- =============================================================

CREATE TABLE IF NOT EXISTS `absensi_lokasi_khusus` (
  `id`             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id`        BIGINT UNSIGNED NOT NULL,
  `latitude`       DOUBLE          NOT NULL,
  `longitude`      DOUBLE          NOT NULL,
  `radius_meter`   INT UNSIGNED    NOT NULL DEFAULT 500,
  `berlaku_mulai`  DATE            NULL COMMENT 'NULL = berlaku sejak kapan pun',
  `berlaku_sampai` DATE            NULL COMMENT 'NULL = tanpa batas akhir',
  `is_active`      TINYINT(1)      NOT NULL DEFAULT 1,
  `created_by`     BIGINT UNSIGNED NULL,
  `created_at`     TIMESTAMP       NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`     TIMESTAMP       NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_alk_user_aktif` (`user_id`, `is_active`),
  KEY `idx_alk_berlaku`    (`berlaku_mulai`, `berlaku_sampai`),
  CONSTRAINT `fk_alk_user`    FOREIGN KEY (`user_id`)    REFERENCES `users`(`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_alk_creator` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Jejak titik yang dipakai saat absen.
-- Disimpan sebagai SNAPSHOT KOORDINAT, bukan foreign key: kalau titiknya
-- dihapus/dipindah, riwayat absensi lama tetap menunjukkan lokasi sebenarnya.
-- NULL = absen dari kantor DPMD (termasuk semua data lama sebelum fitur ini).
ALTER TABLE `absensi_pegawai`
  ADD COLUMN `titik_absen_khusus` VARCHAR(64) NULL
    COMMENT 'Koordinat titik khusus tempat absen; NULL = Kantor DPMD'
    AFTER `lokasi_keluar`;
