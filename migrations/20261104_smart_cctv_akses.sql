-- Hak akses Smart CCTV per pengguna, diatur superadmin (halaman Akses di menu CCTV).
-- Satu baris per (pengguna, izin). Izin: lihat | peringatan | kamera | wajah.
-- berlaku_sampai NULL = tanpa batas waktu. Superadmin selalu berakses penuh
-- tanpa baris di tabel ini.
--
-- Idempoten (run-migrations.js menjalankan setiap berkas tiap deploy).

CREATE TABLE IF NOT EXISTS `cctv_akses` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `user_id` BIGINT UNSIGNED NOT NULL,
    `izin` VARCHAR(20) NOT NULL,
    `berlaku_sampai` DATETIME NULL,
    `diberi_oleh` BIGINT UNSIGNED NULL,
    `created_at` TIMESTAMP(0) NULL DEFAULT CURRENT_TIMESTAMP,

    UNIQUE INDEX `cctv_akses_user_izin_unique`(`user_id`, `izin`),
    INDEX `cctv_akses_user_index`(`user_id`),
    PRIMARY KEY (`id`),
    CONSTRAINT `fk_cctv_akses_user` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE NO ACTION
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
