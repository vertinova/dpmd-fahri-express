-- Smart CCTV: kamera, wajah terdaftar beserta embedding-nya, dan peristiwa
-- deteksi dari layanan AI (Facial-recognition-cctv) lewat /api/smart-cctv.
--
-- Dihasilkan dari model cctv_* di prisma/schema.prisma (prisma migrate diff).
-- run-migrations.js menjalankan setiap berkas tiap kali, jadi semuanya
-- idempoten: CREATE TABLE IF NOT EXISTS, FK ditulis di dalam definisi tabel.

CREATE TABLE IF NOT EXISTS `cctv_cameras` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(255) NOT NULL,
    `lokasi` VARCHAR(255) NULL,
    `rtsp_url` VARCHAR(500) NOT NULL,
    `rtsp_url_main` VARCHAR(500) NULL,
    `rtsp_url_sub` VARCHAR(500) NULL,
    `username` VARCHAR(100) NULL,
    `password_enc` VARCHAR(500) NULL,
    `desa_id` BIGINT UNSIGNED NULL,
    `kecamatan_id` BIGINT UNSIGNED NULL,
    `status` ENUM('active', 'inactive', 'maintenance', 'offline') NOT NULL DEFAULT 'inactive',
    `recognition_enabled` BOOLEAN NOT NULL DEFAULT true,
    `fall_detection_enabled` BOOLEAN NOT NULL DEFAULT true,
    `go2rtc_src` VARCHAR(100) NULL,
    `last_online_at` TIMESTAMP(0) NULL,
    `created_by` BIGINT UNSIGNED NULL,
    `created_at` TIMESTAMP(0) NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_at` TIMESTAMP(0) NULL DEFAULT CURRENT_TIMESTAMP(0),

    UNIQUE INDEX `cctv_cameras_go2rtc_src_key`(`go2rtc_src`),
    INDEX `idx_cctv_cameras_status`(`status`),
    INDEX `idx_cctv_cameras_desa`(`desa_id`),
    INDEX `idx_cctv_cameras_kecamatan`(`kecamatan_id`),
    PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `cctv_faces` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `nama` VARCHAR(255) NOT NULL,
    `kode_pegawai` VARCHAR(50) NULL,
    `departemen` VARCHAR(255) NULL,
    `foto_path` VARCHAR(500) NULL,
    `created_by` BIGINT UNSIGNED NULL,
    `created_at` TIMESTAMP(0) NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_at` TIMESTAMP(0) NULL DEFAULT CURRENT_TIMESTAMP(0),

    INDEX `idx_cctv_faces_nama`(`nama`),
    INDEX `idx_cctv_faces_kode`(`kode_pegawai`),
    PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `cctv_face_embeddings` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `face_id` BIGINT UNSIGNED NOT NULL,
    `image_path` VARCHAR(500) NOT NULL,
    `embedding` JSON NOT NULL,
    `created_at` TIMESTAMP(0) NULL DEFAULT CURRENT_TIMESTAMP(0),

    INDEX `idx_cctv_face_embeddings_face`(`face_id`),
    PRIMARY KEY (`id`),
    CONSTRAINT `fk_cctv_face_embeddings_face` FOREIGN KEY (`face_id`) REFERENCES `cctv_faces`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `cctv_events` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `event_uuid` VARCHAR(64) NOT NULL,
    `camera_id` BIGINT UNSIGNED NOT NULL,
    `type` ENUM('known', 'unknown', 'fall', 'fall_warning', 'immobility', 'other') NOT NULL,
    `severity` ENUM('info', 'warning', 'critical') NOT NULL DEFAULT 'info',
    `face_id` BIGINT UNSIGNED NULL,
    `nama` VARCHAR(255) NULL,
    `similarity` DOUBLE NULL,
    `confidence` DOUBLE NULL,
    `bbox` JSON NULL,
    `track_id` VARCHAR(100) NULL,
    `snapshot_path` VARCHAR(500) NULL,
    `status` ENUM('active', 'acknowledged', 'resolved') NOT NULL DEFAULT 'active',
    `metadata` JSON NULL,
    `acknowledged_by` BIGINT UNSIGNED NULL,
    `acknowledged_at` TIMESTAMP(0) NULL,
    `occurred_at` TIMESTAMP(0) NOT NULL,
    `created_at` TIMESTAMP(0) NULL DEFAULT CURRENT_TIMESTAMP(0),

    UNIQUE INDEX `cctv_events_event_uuid_key`(`event_uuid`),
    INDEX `idx_cctv_events_camera_time`(`camera_id`, `occurred_at`),
    INDEX `idx_cctv_events_time`(`occurred_at`),
    INDEX `idx_cctv_events_status`(`status`),
    INDEX `idx_cctv_events_type`(`type`),
    INDEX `idx_cctv_events_severity`(`severity`),
    PRIMARY KEY (`id`),
    CONSTRAINT `fk_cctv_events_camera` FOREIGN KEY (`camera_id`) REFERENCES `cctv_cameras`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT `fk_cctv_events_face` FOREIGN KEY (`face_id`) REFERENCES `cctv_faces`(`id`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
