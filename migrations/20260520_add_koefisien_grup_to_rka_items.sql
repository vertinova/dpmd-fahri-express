-- Tambah kolom koefisien dan grup ke anggaran_rka_items
-- Perbesar kode_rekening dari VARCHAR(100) ke VARCHAR(500)

ALTER TABLE `anggaran_rka_items`
  ADD COLUMN `koefisien` TEXT NULL AFTER `keterangan`,
  ADD COLUMN `grup` VARCHAR(200) NULL AFTER `koefisien`,
  MODIFY COLUMN `kode_rekening` VARCHAR(500) NULL;
