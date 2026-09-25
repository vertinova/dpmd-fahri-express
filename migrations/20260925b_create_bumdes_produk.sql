-- Katalog produk BUM Desa: etalase produk seluruh BUM Desa se-Kabupaten Bogor
-- yang tampil di dasbor akun operator BUM Desa (seperti e-commerce, TANPA
-- transaksi di aplikasi — pembeli menghubungi BUM Desa langsung atau lewat
-- tautan toko daringnya).
--
-- Satu BUM Desa bisa punya banyak produk. Foto disimpan sebagai WebP di
-- storage/uploads/bumdes_produk.

CREATE TABLE IF NOT EXISTS `bumdes_produk` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `bumdes_id` INT NOT NULL,
  `desa_id` BIGINT UNSIGNED NULL,
  `nama` VARCHAR(255) NOT NULL,
  `kategori` VARCHAR(100) NULL,
  `deskripsi` TEXT NULL,
  `harga` DECIMAL(15,2) NULL,
  `satuan` VARCHAR(50) NULL,
  `foto` VARCHAR(255) NULL,
  `tautan` VARCHAR(500) NULL,
  `unggulan` TINYINT(1) NOT NULL DEFAULT 0,
  `is_active` TINYINT(1) NOT NULL DEFAULT 1,
  `created_by` BIGINT UNSIGNED NULL,
  `created_at` TIMESTAMP NULL,
  `updated_at` TIMESTAMP NULL,
  PRIMARY KEY (`id`),
  KEY `bumdes_produk_bumdes_index` (`bumdes_id`),
  KEY `bumdes_produk_desa_index` (`desa_id`),
  KEY `bumdes_produk_kategori_index` (`kategori`),
  CONSTRAINT `fk_bumdes_produk_bumdes` FOREIGN KEY (`bumdes_id`) REFERENCES `bumdes` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
