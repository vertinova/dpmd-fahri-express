-- Produk hukum tingkat kabupaten, dipegang per bidang DPMD.
--
-- KENAPA TABEL BARU, BUKAN MENUMPANG `produk_hukums`.
-- `produk_hukums` adalah produk hukum DESA: `desa_id` NOT NULL dengan foreign
-- key ke `desas`, dan sepuluh tabel lain menunjuk ke sana (aparatur_desa,
-- bumdes lewat dua relasi, rts, rws, posyandus, lpms, pkks, karang_tarunas,
-- satlinmas, lembaga_lainnyas). Membuat `desa_id` nullable supaya bisa memuat
-- Perbup dan SK Kadis berarti setiap kueri di sepuluh tabel itu harus mulai
-- menangani baris tanpa desa — dan enum `jenis`-nya pun cuma memuat tiga nilai
-- desa (Perdes, Perkades, SK Kades). Dua jenis dokumen yang berbeda pemiliknya
-- dan berbeda daur hidupnya lebih murah dipisah daripada disatukan.
--
-- Core Dashboard yang menyatukan keduanya, di lapisan kueri, bukan di tabel.
--
-- Semua statement idempoten: runner mengirim file ini sebagai SATU batch, jadi
-- CREATE yang gagal karena objeknya sudah ada akan menghentikan sisanya.

-- ============================================================
-- 1. Produk hukum bidang (tingkat kabupaten)
-- ============================================================
CREATE TABLE IF NOT EXISTS `produk_hukum_bidang` (
  `id`                BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `bidang_id`         BIGINT UNSIGNED NOT NULL,

  -- Jenis dan singkatannya disimpan VARCHAR, bukan ENUM. Daftar jenis produk
  -- hukum kabupaten masih akan bertambah (SE, Instruksi Bupati, Keputusan
  -- Sekda), dan menambah nilai ENUM di MySQL berarti ALTER TABLE mengunci
  -- tabel. Daftar yang sah divalidasi di controller.
  `jenis`             VARCHAR(100) NOT NULL,
  `singkatan_jenis`   VARCHAR(30)  NOT NULL,

  `judul`             VARCHAR(500) NOT NULL,
  `nomor`             VARCHAR(100) NOT NULL,
  `tahun`             SMALLINT UNSIGNED NOT NULL,
  -- Ringkasan "tentang apa"; sejajar dengan kolom `subjek` di produk_hukums.
  `tentang`           VARCHAR(500) NULL DEFAULT NULL,

  `tempat_penetapan`  VARCHAR(255) NULL DEFAULT NULL,
  `tanggal_penetapan` DATE NULL DEFAULT NULL,
  `sumber`            VARCHAR(255) NULL DEFAULT NULL,
  `status_peraturan`  ENUM('berlaku','diubah','dicabut') NOT NULL DEFAULT 'berlaku',
  `keterangan_status` VARCHAR(500) NULL DEFAULT NULL,
  `bidang_hukum`      VARCHAR(100) NOT NULL DEFAULT 'Tata Negara',

  -- Nama berkas di `storage/produk_hukum_bidang/`. NULL berarti metadatanya
  -- sudah dicatat tapi berkasnya belum diunggah — keadaan yang wajar dan
  -- dihitung terpisah di statistik.
  `file`              VARCHAR(255) NULL DEFAULT NULL,
  -- Tautan ke JDIH bila dokumennya sudah terbit di sana.
  `url_sumber`        VARCHAR(1000) NULL DEFAULT NULL,

  `created_by`        BIGINT UNSIGNED NULL DEFAULT NULL,
  `updated_by`        BIGINT UNSIGNED NULL DEFAULT NULL,
  `created_at`        TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`        TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  PRIMARY KEY (`id`),
  -- Satu nomor, satu jenis, satu tahun hanya boleh ada sekali per bidang.
  -- Tanpa ini dokumen yang sama gampang masuk dua kali lewat dua orang.
  UNIQUE KEY `uniq_produk_hukum_bidang` (`bidang_id`, `singkatan_jenis`, `nomor`, `tahun`),
  KEY `idx_phb_bidang` (`bidang_id`, `tahun`),
  KEY `idx_phb_jenis` (`singkatan_jenis`),
  KEY `idx_phb_status` (`status_peraturan`),
  CONSTRAINT `fk_produk_hukum_bidang_bidang`
    FOREIGN KEY (`bidang_id`) REFERENCES `bidangs` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- 2. Referensi peraturan (rujukan luar, belum diunggah)
-- ============================================================
-- Peraturan nasional/provinsi/kabupaten yang mengikat desa tapi bukan produk
-- DPMD: UU, PP, Permendagri, Permendes, Perda Provinsi. Isinya rujukan —
-- metadata dan tautan ke JDIH — tanpa berkas di server, sehingga tidak pernah
-- basi terhadap sumber resminya.
--
-- Tabelnya dibuat sekarang bersama tabel di atas supaya skema hanya berubah
-- sekali; pengisian datanya menyusul.
CREATE TABLE IF NOT EXISTS `produk_hukum_referensi` (
  `id`                BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `tingkat`           ENUM('nasional','provinsi','kabupaten') NOT NULL DEFAULT 'nasional',
  `jenis`             VARCHAR(100) NOT NULL,
  `singkatan_jenis`   VARCHAR(30)  NOT NULL,
  `nomor`             VARCHAR(50)  NOT NULL,
  `tahun`             SMALLINT UNSIGNED NOT NULL,
  `judul`             VARCHAR(500) NOT NULL,
  `tentang`           VARCHAR(500) NOT NULL,

  -- Pengelompokan tema supaya daftarnya bisa dibaca: "Dasar Hukum Desa",
  -- "Keuangan Desa", "Aparatur Desa", "BUM Desa", "Kelembagaan Desa".
  `topik`             VARCHAR(100) NULL DEFAULT NULL,

  `url`               VARCHAR(1000) NULL DEFAULT NULL,
  `sumber_situs`      VARCHAR(255) NULL DEFAULT NULL,
  `status_peraturan`  ENUM('berlaku','diubah','dicabut') NOT NULL DEFAULT 'berlaku',
  `keterangan_status` VARCHAR(500) NULL DEFAULT NULL,

  `urutan`            INT NOT NULL DEFAULT 0,
  `aktif`             TINYINT(1) NOT NULL DEFAULT 1,
  `created_at`        TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`        TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_produk_hukum_referensi` (`singkatan_jenis`, `nomor`, `tahun`),
  KEY `idx_phr_tingkat` (`tingkat`, `urutan`),
  KEY `idx_phr_topik` (`topik`),
  KEY `idx_phr_aktif` (`aktif`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
