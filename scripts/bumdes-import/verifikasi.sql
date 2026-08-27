-- Pemeriksaan setelah impor BUMDes. Jalankan:
--   mysql -h127.0.0.1 -u<user> -p dpmd < verifikasi.sql

SELECT '1. Jumlah baris & kelengkapan kunci' AS pemeriksaan;
SELECT
  COUNT(*)                                   AS total_baris,
  SUM(desa_id IS NULL)                       AS desa_id_kosong,
  SUM(kode_desa IS NULL OR kode_desa = '')   AS kode_desa_kosong,
  COUNT(DISTINCT desa_id)                    AS desa_unik,
  COUNT(DISTINCT kode_desa)                  AS kode_unik
FROM bumdes;

SELECT '2. Tidak boleh ada desa ganda' AS pemeriksaan;
SELECT kode_desa, COUNT(*) AS jumlah
FROM bumdes GROUP BY kode_desa HAVING COUNT(*) > 1;

SELECT '3. Semua desa_id harus nyambung ke tabel desas' AS pemeriksaan;
SELECT COUNT(*) AS desa_id_yatim
FROM bumdes b LEFT JOIN desas d ON d.id = b.desa_id
WHERE b.desa_id IS NOT NULL AND d.id IS NULL;

SELECT '4. Sebaran status' AS pemeriksaan;
SELECT status, COUNT(*) AS jumlah FROM bumdes GROUP BY status;

SELECT '5. Badan hukum — harus memakai kosakata dashboard' AS pemeriksaan;
SELECT badanhukum, COUNT(*) AS jumlah
FROM bumdes GROUP BY badanhukum ORDER BY jumlah DESC;

SELECT '6. Kecamatan — cek tidak ada yang pecah karena beda huruf' AS pemeriksaan;
SELECT COUNT(DISTINCT kecamatan) AS kecamatan_unik FROM bumdes;

SELECT '7. Dokumen terunggah HARUS masih utuh (bandingkan dengan backup)' AS pemeriksaan;
SELECT
  SUM(Perdes              IS NOT NULL AND Perdes <> '')              AS perdes,
  SUM(ProfilBUMDesa       IS NOT NULL AND ProfilBUMDesa <> '')       AS profil,
  SUM(BeritaAcara         IS NOT NULL AND BeritaAcara <> '')         AS berita_acara,
  SUM(AnggaranDasar       IS NOT NULL AND AnggaranDasar <> '')       AS ad,
  SUM(AnggaranRumahTangga IS NOT NULL AND AnggaranRumahTangga <> '') AS art,
  SUM(ProgramKerja        IS NOT NULL AND ProgramKerja <> '')        AS proker,
  SUM(SK_BUM_Desa         IS NOT NULL AND SK_BUM_Desa <> '')         AS sk,
  SUM(LaporanKeuangan2021 IS NOT NULL AND LaporanKeuangan2021 <> '') AS lk2021
FROM bumdes;

SELECT '8. Kolom baru sudah terisi' AS pemeriksaan;
SELECT
  SUM(Pemeringkatan2026            IS NOT NULL) AS pemeringkatan_2026,
  SUM(StatusBadanHukum2026         IS NOT NULL) AS status_bh_2026,
  SUM(Omset2025                    IS NOT NULL) AS omset_2025,
  SUM(KontribusiTerhadapPADes2025  IS NOT NULL) AS pades_2025,
  SUM(PeranMBG                     IS NOT NULL) AS peran_mbg,
  SUM(KehadiranDesk2026            IS NOT NULL) AS desk_2026
FROM bumdes;

SELECT '9. Nilai keuangan janggal (> 100x median) — periksa manual' AS pemeriksaan;
SELECT id, kode_desa, desa, namabumdesa, NilaiAset, Omset2024, TotalRealisasiPenyertaanModal20192025
FROM bumdes
WHERE NilaiAset > 100000000000 OR Omset2024 > 100000000000
ORDER BY NilaiAset DESC
LIMIT 20;

SELECT '10. Jumlah kolom tabel (batas InnoDB 1017)' AS pemeriksaan;
SELECT COUNT(*) AS jumlah_kolom
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'bumdes';
