-- Catatan pribadi pengguna (tab Catatan di Ruang Pribadi dashboard Sekretaris Dinas),
-- lewat /api/catatan-pribadi. `versi` naik tiap perubahan untuk mencegah autosave dua
-- perangkat saling menimpa. Idempoten.

CREATE TABLE IF NOT EXISTS `catatan_pribadi` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `user_id` BIGINT UNSIGNED NOT NULL,
    `judul` VARCHAR(120) NOT NULL DEFAULT '',
    `isi` MEDIUMTEXT NOT NULL,
    `disematkan` BOOLEAN NOT NULL DEFAULT false,
    `versi` INT UNSIGNED NOT NULL DEFAULT 0,
    `created_at` TIMESTAMP(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_at` TIMESTAMP(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0) ON UPDATE CURRENT_TIMESTAMP(0),

    INDEX `catatan_pribadi_user_index`(`user_id`, `disematkan`, `updated_at`),
    PRIMARY KEY (`id`),
    CONSTRAINT `catatan_pribadi_user_id_foreign` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
