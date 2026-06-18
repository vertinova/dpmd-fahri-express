-- Migration: Create absensi_success_messages table
-- Stores configurable popup images and text for each attendance success type
-- Managed by Bidang Sekretariat

CREATE TABLE IF NOT EXISTS absensi_success_messages (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    type VARCHAR(50) NOT NULL UNIQUE COMMENT 'masuk, pulang, wfh, dinas_luar, wfa, izin, sakit, cuti',
    title VARCHAR(255) NOT NULL DEFAULT '' COMMENT 'Judul popup',
    message TEXT NULL COMMENT 'Pesan/kata-kata di popup',
    image_path VARCHAR(500) NULL COMMENT 'Path gambar yang ditampilkan di popup',
    is_active TINYINT(1) NOT NULL DEFAULT 1 COMMENT 'Apakah popup aktif',
    updated_by BIGINT UNSIGNED NULL,
    created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_type (type),
    INDEX idx_active (is_active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Seed default data for each type
INSERT INTO absensi_success_messages (type, title, message, is_active) VALUES
('masuk', 'Absen Masuk Berhasil!', 'Selamat bekerja, semangat hari ini!', 1),
('pulang', 'Absen Pulang Berhasil!', 'Terima kasih atas kerja kerasnya hari ini!', 1),
('wfh', 'WFH Tercatat!', 'Selamat bekerja dari rumah, tetap produktif!', 1),
('dinas_luar', 'Dinas Luar Tercatat!', 'Semoga perjalanan dinas lancar dan sukses!', 1),
('wfa', 'WFA Tercatat!', 'Selamat bekerja dari mana saja, tetap semangat!', 1),
('izin', 'Izin Tercatat!', 'Izin Anda sudah tercatat. Semoga urusannya lancar!', 1),
('sakit', 'Izin Sakit Tercatat!', 'Semoga lekas sembuh dan sehat kembali!', 1),
('cuti', 'Cuti Tercatat!', 'Selamat berlibur, jaga kesehatan!', 1)
ON DUPLICATE KEY UPDATE type = type;
