-- Migration: Create tables for Nomor Surat (Letter Number Request) feature
-- Date: 2026-04-15

-- Table: klasifikasi_arsip - stores the classification codes
CREATE TABLE IF NOT EXISTS klasifikasi_arsip (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  kode VARCHAR(20) NOT NULL,
  nama VARCHAR(500) NOT NULL,
  parent_kode VARCHAR(20) NULL,
  level TINYINT UNSIGNED NOT NULL DEFAULT 1,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_kode (kode),
  INDEX idx_parent (parent_kode),
  INDEX idx_level (level)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Table: nomor_surat_requests - stores letter number requests by staff
CREATE TABLE IF NOT EXISTS nomor_surat_requests (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  klasifikasi_kode VARCHAR(20) NOT NULL,
  nomor_registrasi INT UNSIGNED NOT NULL,
  nomor_surat_generated VARCHAR(255) NOT NULL COMMENT 'The full generated letter number',
  perihal VARCHAR(500) NOT NULL,
  bidang_id INT UNSIGNED NOT NULL,
  bidang_nama VARCHAR(100) NOT NULL,
  requested_by BIGINT UNSIGNED NOT NULL,
  requested_by_name VARCHAR(255) NOT NULL,
  catatan TEXT NULL,
  tahun SMALLINT UNSIGNED NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_klasifikasi (klasifikasi_kode),
  INDEX idx_bidang (bidang_id),
  INDEX idx_requested_by (requested_by),
  INDEX idx_tahun (tahun),
  INDEX idx_tahun_kode (tahun, klasifikasi_kode),
  UNIQUE KEY uq_nomor_tahun (nomor_registrasi, klasifikasi_kode, tahun),
  CONSTRAINT fk_nomorsurat_user FOREIGN KEY (requested_by) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
