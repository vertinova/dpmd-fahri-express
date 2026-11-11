-- Daftar tugas pribadi pengguna (to-do di dashboard Sekretaris Dinas), lewat /api/tugas-pribadi.
-- Idempoten: run-migrations.js menjalankan setiap berkas tiap kali.

CREATE TABLE IF NOT EXISTS `tugas_pribadi` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `user_id` BIGINT UNSIGNED NOT NULL,
    `judul` VARCHAR(160) NOT NULL,
    `selesai` BOOLEAN NOT NULL DEFAULT false,
    `tanggal_pengingat` DATE NULL,
    `created_at` TIMESTAMP(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_at` TIMESTAMP(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0) ON UPDATE CURRENT_TIMESTAMP(0),

    INDEX `tugas_pribadi_user_selesai_index`(`user_id`, `selesai`, `tanggal_pengingat`),
    PRIMARY KEY (`id`),
    CONSTRAINT `tugas_pribadi_user_id_foreign` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
