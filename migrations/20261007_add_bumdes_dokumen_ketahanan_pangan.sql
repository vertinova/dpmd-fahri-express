-- Dokumen ketahanan pangan per TAHUN.
--
-- Sebelumnya satu BUM Desa hanya punya tiga kolom berkas tunggal
-- (StudiKelayakanUsaha, RABKetahananPangan, DokumentasiGeotagging), sehingga
-- BUM Desa yang menerima kegiatan ketahanan pangan di lebih dari satu tahun
-- harus menimpa berkas tahun sebelumnya — dokumen tahun lama hilang tanpa jejak.
--
-- Bentuknya mengikuti pola daftar JSON yang sudah dipakai formulir BUM Desa
-- (lihat KOLOM_DAFTAR di src/config/bumdesFields.js):
--   [{ "tahun": 2026, "studi_kelayakan": "bumdes_lampiran/x.pdf",
--      "rab": "bumdes_lampiran/y.pdf", "geotagging": "bumdes_lampiran/z.jpg",
--      "keterangan": "..." }]
--
-- Tiga kolom lama TIDAK dihapus dan TIDAK dipindahkan: tahunnya tidak pernah
-- tercatat, jadi memindahkannya berarti mengarang tahun. Berkasnya tetap
-- terbaca dan tetap tampil sebagai "tanpa tahun" di formulir, Kelola Dokumen,
-- dan ekspor berkas.
ALTER TABLE `bumdes`
  ADD COLUMN `DokumenKetahananPangan` LONGTEXT NULL;
