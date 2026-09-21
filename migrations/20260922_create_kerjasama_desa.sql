-- Kerja Sama Desa — dikelola desa, dipantau Bidang SPKED.
--
-- Dua tabel, karena bentuk datanya memang dua hal yang berbeda umurnya:
--
--   kerjasama_desa_legalitas — SATU baris per desa. Perdes payung tentang kerja
--     sama desa, diunggah sekali di awal. Berkasnya TIDAK disimpan di sini:
--     kolom `produk_hukum_id` menunjuk ke modul Produk Hukum Desa, supaya Perdes
--     yang sama tidak berakhir terunggah dua kali di dua menu. Pola ini sama
--     dengan tautan dokumen badan hukum BUM Desa.
--
--   kerjasama_desa — BANYAK baris per desa, satu per kegiatan kerja sama, tanpa
--     batas jumlah. Dokumennya melekat per kegiatan, bukan per desa.
--
-- Dokumen per kegiatan berbeda menurut jenisnya, dan itu memang sifat aturannya:
--   antar_desa    (KAD)  → Peraturan Bersama Kepala Desa + SK Badan Kerja Sama
--   pihak_ketiga  (KDPK) → PKS / MoU
-- Ketiganya diberi kolom sendiri, bukan satu kolom serbaguna, supaya pertanyaan
-- "desa ini sudah unggah SK BKD belum?" bisa dijawab query, bukan tebakan.

CREATE TABLE IF NOT EXISTS `kerjasama_desa_legalitas` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `desa_id` BIGINT UNSIGNED NOT NULL,
  `nomor_perdes` VARCHAR(100) NULL DEFAULT NULL,
  `tahun_perdes` INT NULL DEFAULT NULL,
  `produk_hukum_id` CHAR(36) NULL DEFAULT NULL,
  `keterangan` VARCHAR(255) NULL DEFAULT NULL,
  `created_by` BIGINT UNSIGNED NULL DEFAULT NULL,
  `created_at` TIMESTAMP NULL DEFAULT NULL,
  `updated_at` TIMESTAMP NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  -- Satu desa satu Perdes payung. Keunikan dijaga basis data, bukan hanya
  -- pemeriksaan di controller yang bisa dilewati dua permintaan bersamaan.
  UNIQUE KEY `kerjasama_desa_legalitas_desa_unique` (`desa_id`),
  KEY `kerjasama_desa_legalitas_produk_hukum_index` (`produk_hukum_id`),
  CONSTRAINT `fk_kerjasama_legalitas_desa`
    FOREIGN KEY (`desa_id`) REFERENCES `desas` (`id`) ON DELETE CASCADE,
  -- SET NULL, bukan CASCADE: Perdes dihapus dari modul Produk Hukum tidak boleh
  -- ikut menghapus catatan legalitas beserta nomornya.
  CONSTRAINT `fk_kerjasama_legalitas_produk_hukum`
    FOREIGN KEY (`produk_hukum_id`) REFERENCES `produk_hukums` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `kerjasama_desa` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `desa_id` BIGINT UNSIGNED NOT NULL,
  `tahun` INT NOT NULL,
  `jenis` ENUM('antar_desa','pihak_ketiga') NOT NULL,
  `bidang` ENUM(
    'penyelenggaraan_pemerintahan',
    'pelaksanaan_pembangunan',
    'pembinaan_kemasyarakatan',
    'pemberdayaan_masyarakat'
  ) NOT NULL,
  `sub_bidang` VARCHAR(255) NULL DEFAULT NULL,
  `mitra` VARCHAR(255) NOT NULL,
  `ruang_lingkup` TEXT NULL DEFAULT NULL,
  `tanggal_mulai` DATE NULL DEFAULT NULL,
  `tanggal_selesai` DATE NULL DEFAULT NULL,
  `file_permakades` VARCHAR(255) NULL DEFAULT NULL,
  `file_sk_bkd` VARCHAR(255) NULL DEFAULT NULL,
  `file_pks_mou` VARCHAR(255) NULL DEFAULT NULL,
  `pelaksanaan` TEXT NULL DEFAULT NULL,
  `created_by` BIGINT UNSIGNED NULL DEFAULT NULL,
  `created_at` TIMESTAMP NULL DEFAULT NULL,
  `updated_at` TIMESTAMP NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  -- Indeks mengikuti tiga penyaring di dashboard monitoring: tahun, jenis,
  -- dan bidang — plus desa_id yang dipakai hampir setiap query.
  KEY `kerjasama_desa_desa_tahun_index` (`desa_id`, `tahun`),
  KEY `kerjasama_desa_jenis_index` (`jenis`),
  KEY `kerjasama_desa_bidang_index` (`bidang`),
  CONSTRAINT `fk_kerjasama_desa_desa`
    FOREIGN KEY (`desa_id`) REFERENCES `desas` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
