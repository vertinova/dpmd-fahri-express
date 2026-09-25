-- Perbaikan aplikasi BUM Desa (dokumen "PERBAIKAN APLIKASI BUMDESA", 2026-09).
--
-- Bagian formulir yang diminta bisa "pilih tahun, isi, simpan, tambah lagi"
-- (permodalan, aset, omset & laba, kontribusi PADes, kemitraan, peran program
-- pemerintah, laporan pertanggungjawaban) disimpan sebagai daftar JSON dalam
-- kolom LONGTEXT. Kolom tahunan lama (PenyertaanModal2024, Omset2025, dst.)
-- TETAP ada dan tetap diisi backend dari daftar ini (lihat sinkronKolomLama di
-- src/config/bumdesFields.js), supaya statistik & dasbor yang membacanya tidak
-- berubah.
--
-- LONGTEXT, bukan JSON: server MariaDB/MySQL di lingkungan berbeda tidak sama
-- dukungan tipe JSON-nya, sedangkan isinya selalu divalidasi backend.
--
-- Semua kolom NULL dan tidak mengubah data yang sudah ada. Satu ALTER supaya
-- auto-migrate.js (yang melewati satu berkas utuh bila kolom sudah ada, errno
-- 1060) tidak meninggalkan sebagian kolom.

ALTER TABLE `bumdes`
  ADD COLUMN `KategoriUsaha` LONGTEXT NULL,
  ADD COLUMN `KategoriUsahaPangan` LONGTEXT NULL,
  ADD COLUMN `UnitUsaha` LONGTEXT NULL,
  ADD COLUMN `RiwayatPermodalan` LONGTEXT NULL,
  ADD COLUMN `RiwayatAset` LONGTEXT NULL,
  ADD COLUMN `RiwayatOmsetLaba` LONGTEXT NULL,
  ADD COLUMN `RiwayatKontribusiPADes` LONGTEXT NULL,
  ADD COLUMN `RiwayatKemitraan` LONGTEXT NULL,
  ADD COLUMN `PeranProgram` LONGTEXT NULL,
  ADD COLUMN `LaporanPertanggungjawaban` LONGTEXT NULL,
  ADD COLUMN `MediaSosial` LONGTEXT NULL,
  ADD COLUMN `StudiKelayakanUsaha` VARCHAR(255) NULL,
  ADD COLUMN `RABKetahananPangan` VARCHAR(255) NULL,
  ADD COLUMN `DokumentasiGeotagging` VARCHAR(255) NULL;
