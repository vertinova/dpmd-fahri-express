-- Verifikasi 2 langkah (Google Authenticator / TOTP) untuk akun pegawai DPMD,
-- lewat /api/auth/2fa/*. `rahasia` terenkripsi AES-256-GCM, `langkah_terakhir`
-- mencegah kode dipakai dua kali. HP hilang: superadmin menghapus barisnya (Reset 2FA).
-- `aktif_at` NULL = rahasia sudah dibuat tetapi belum dikonfirmasi. Idempoten.

CREATE TABLE IF NOT EXISTS `user_totp` (
    `user_id` BIGINT UNSIGNED NOT NULL,
    `rahasia` VARCHAR(255) NOT NULL,
    `aktif_at` TIMESTAMP(0) NULL,
    `langkah_terakhir` BIGINT NOT NULL DEFAULT 0,
    `created_at` TIMESTAMP(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_at` TIMESTAMP(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0) ON UPDATE CURRENT_TIMESTAMP(0),

    PRIMARY KEY (`user_id`),
    CONSTRAINT `user_totp_user_id_foreign` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
