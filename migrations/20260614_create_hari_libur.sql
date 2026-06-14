-- Tabel hari libur nasional (dikelola admin) untuk blokir tanggal merah
-- saat generate Berita Acara & Surat Pengantar bankeu.
-- Weekend (Sabtu/Minggu) ditangani di kode, tabel ini khusus libur nasional/cuti bersama.
CREATE TABLE IF NOT EXISTS hari_libur (
  id INT AUTO_INCREMENT PRIMARY KEY,
  tanggal DATE NOT NULL,
  keterangan VARCHAR(255) NOT NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_by INT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_hari_libur_tanggal (tanggal)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
