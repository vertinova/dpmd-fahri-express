-- Bukti STS pengembalian dana Bankeu (opsional, diunggah desa). Idempoten.
-- Tabel bankeu_monev sempat dibuat oleh versi awal berkas ini (fitur monev dibatalkan 11 Nov 2026).

CREATE TABLE IF NOT EXISTS `bankeu_lpj_sts` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `desa_id` BIGINT UNSIGNED NOT NULL,
    `tahun_anggaran` YEAR NOT NULL,
    `nominal` BIGINT UNSIGNED NOT NULL,
    `tanggal_setor` DATE NOT NULL,
    `nama_file` VARCHAR(255) NOT NULL,
    `file_path` VARCHAR(500) NOT NULL,
    `file_size` INT UNSIGNED NULL,
    `uploaded_by` BIGINT UNSIGNED NOT NULL,
    `created_at` TIMESTAMP(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),

    INDEX `idx_bankeu_lpj_sts_desa_tahun`(`desa_id`, `tahun_anggaran`),
    INDEX `fk_bankeu_lpj_sts_user`(`uploaded_by`),
    PRIMARY KEY (`id`),
    CONSTRAINT `fk_bankeu_lpj_sts_desa` FOREIGN KEY (`desa_id`) REFERENCES `desas`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT `fk_bankeu_lpj_sts_user` FOREIGN KEY (`uploaded_by`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
