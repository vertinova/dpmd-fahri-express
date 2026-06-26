-- Seed hari libur nasional & cuti bersama 2026 ke tabel hari_libur.
-- Sumber: SKB 3 Menteri (Menag, Menaker, Menpan-RB), ditandatangani 19 September 2025.
-- 17 hari libur nasional + 8 hari cuti bersama.
--
-- Idempotent: ON DUPLICATE KEY UPDATE mengoreksi keterangan & mengaktifkan kembali
-- baris yang tanggalnya sudah ada (uq_hari_libur_tanggal). Aman dijalankan ulang.
-- Setelah ini, fitur absensi membaca tanggal merah dari tabel ini (lihat
-- services/holidayCache.service.js), bukan lagi dari daftar hardcoded.

INSERT INTO hari_libur (tanggal, keterangan, is_active) VALUES
  -- Hari Libur Nasional
  ('2026-01-01', 'Tahun Baru Masehi 2026', 1),
  ('2026-01-16', 'Isra Mi''raj Nabi Muhammad SAW', 1),
  ('2026-02-17', 'Tahun Baru Imlek 2577 Kongzili', 1),
  ('2026-03-19', 'Hari Suci Nyepi Tahun Baru Saka 1948', 1),
  ('2026-03-21', 'Hari Raya Idul Fitri 1447 H', 1),
  ('2026-03-22', 'Hari Raya Idul Fitri 1447 H', 1),
  ('2026-04-03', 'Wafat Isa Al Masih', 1),
  ('2026-04-05', 'Hari Paskah / Kebangkitan Isa Al Masih', 1),
  ('2026-05-01', 'Hari Buruh Internasional', 1),
  ('2026-05-14', 'Kenaikan Isa Al Masih', 1),
  ('2026-05-27', 'Hari Raya Idul Adha 1447 H', 1),
  ('2026-05-31', 'Hari Raya Waisak 2570 BE', 1),
  ('2026-06-01', 'Hari Lahir Pancasila', 1),
  ('2026-06-16', 'Tahun Baru Islam 1448 H (1 Muharam)', 1),
  ('2026-08-17', 'Proklamasi Kemerdekaan RI', 1),
  ('2026-08-25', 'Maulid Nabi Muhammad SAW', 1),
  ('2026-12-25', 'Hari Raya Natal', 1),
  -- Cuti Bersama
  ('2026-02-16', 'Cuti Bersama Tahun Baru Imlek', 1),
  ('2026-03-18', 'Cuti Bersama Hari Suci Nyepi', 1),
  ('2026-03-20', 'Cuti Bersama Idul Fitri 1447 H', 1),
  ('2026-03-23', 'Cuti Bersama Idul Fitri 1447 H', 1),
  ('2026-03-24', 'Cuti Bersama Idul Fitri 1447 H', 1),
  ('2026-05-15', 'Cuti Bersama Kenaikan Isa Al Masih', 1),
  ('2026-05-28', 'Cuti Bersama Idul Adha 1447 H', 1),
  ('2026-12-24', 'Cuti Bersama Hari Raya Natal', 1)
ON DUPLICATE KEY UPDATE
  keterangan = VALUES(keterangan),
  is_active = 1;

-- Bersihkan data lama yang keliru (Idul Adha sempat ter-hardcode di 26-27 Juni 2026).
-- Hapus hanya bila pernah ter-insert dengan tanggal salah tsb.
DELETE FROM hari_libur WHERE tanggal IN ('2026-06-26', '2026-06-27');
