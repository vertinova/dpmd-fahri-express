-- Nomor WhatsApp penjual per produk katalog BUM Desa.
--
-- Tombol "Pesan" di katalog membuka WhatsApp langsung ke pemilik produk.
-- Bila kosong, backend memakai nomor telepon BUM Desa lalu HP Direktur.
-- Kolom NULL; tidak mengubah data yang sudah ada.

ALTER TABLE `bumdes_produk`
  ADD COLUMN `whatsapp` VARCHAR(20) NULL AFTER `tautan`;
