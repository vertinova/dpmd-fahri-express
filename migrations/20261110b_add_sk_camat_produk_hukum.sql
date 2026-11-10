-- ============================================================
-- Migrasi: Tambah jenis 'Keputusan Camat' (SK CAMAT) ke produk hukum desa.
-- Nilai lama tidak berubah, jadi baris yang sudah ada aman.
-- Tanggal: 2026-11-10
-- ============================================================

ALTER TABLE `produk_hukums`
  MODIFY COLUMN `jenis` ENUM('Peraturan Desa','Peraturan Kepala Desa','Keputusan Kepala Desa','Keputusan Camat')
    CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  MODIFY COLUMN `singkatan_jenis` ENUM('PERDES','PERKADES','SK KADES','SK CAMAT')
    CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL;
