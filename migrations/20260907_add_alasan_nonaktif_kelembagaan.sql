-- Penonaktifan lembaga tidak lagi dikaitkan ke produk hukum, melainkan wajib
-- disertai alasan (kategori baku) + keterangan (penjelasan bebas) supaya
-- keputusannya bisa dipertanggungjawabkan dan angkanya bisa diagregasi.
--
-- Kolom produk_hukum_penonaktifan_id sengaja TIDAK di-drop: baris lama masih
-- mereferensikannya dan datanya dibiarkan utuh. Kolom itu hanya berhenti
-- diisi/ditampilkan oleh aplikasi.
--
-- CATATAN IDEMPOTENSI — auto-migrate.js menjalankan satu file sebagai satu
-- batch multi-statement dan, kalau ada pernyataan yang gagal dengan errno
-- 1060 (kolom sudah ada), ia mencatat file ini sebagai selesai walau sisa
-- pernyataannya belum jalan. Karena itu tiap kolom ditambahkan lewat helper
-- yang memeriksa information_schema dulu: file ini aman dijalankan berapa kali
-- pun, dan aman juga kalau sebagian kolom sudah terpasang manual.
--
-- DELIMITER tidak dipakai: itu fitur mysql CLI, sedangkan auto-migrate.js
-- memakai driver mysql2. Body prosedur di bawah sudah diuji lolos lewat driver.

DROP PROCEDURE IF EXISTS _dpmd_tambah_kolom;

CREATE PROCEDURE _dpmd_tambah_kolom(IN nama_tabel VARCHAR(64), IN nama_kolom VARCHAR(64), IN definisi TEXT)
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = nama_tabel
      AND COLUMN_NAME = nama_kolom
  ) THEN
    SET @perintah = CONCAT('ALTER TABLE `', nama_tabel, '` ADD COLUMN `', nama_kolom, '` ', definisi);
    PREPARE pernyataan FROM @perintah;
    EXECUTE pernyataan;
    DEALLOCATE PREPARE pernyataan;
  END IF;
END;

-- Alasan + keterangan untuk kedelapan jenis lembaga.
CALL _dpmd_tambah_kolom('rws',              'alasan_nonaktif',     'VARCHAR(100) NULL');
CALL _dpmd_tambah_kolom('rws',              'keterangan_nonaktif', 'TEXT NULL');
CALL _dpmd_tambah_kolom('rts',              'alasan_nonaktif',     'VARCHAR(100) NULL');
CALL _dpmd_tambah_kolom('rts',              'keterangan_nonaktif', 'TEXT NULL');
CALL _dpmd_tambah_kolom('posyandus',        'alasan_nonaktif',     'VARCHAR(100) NULL');
CALL _dpmd_tambah_kolom('posyandus',        'keterangan_nonaktif', 'TEXT NULL');
CALL _dpmd_tambah_kolom('karang_tarunas',   'alasan_nonaktif',     'VARCHAR(100) NULL');
CALL _dpmd_tambah_kolom('karang_tarunas',   'keterangan_nonaktif', 'TEXT NULL');
CALL _dpmd_tambah_kolom('lpms',             'alasan_nonaktif',     'VARCHAR(100) NULL');
CALL _dpmd_tambah_kolom('lpms',             'keterangan_nonaktif', 'TEXT NULL');
CALL _dpmd_tambah_kolom('pkks',             'alasan_nonaktif',     'VARCHAR(100) NULL');
CALL _dpmd_tambah_kolom('pkks',             'keterangan_nonaktif', 'TEXT NULL');
CALL _dpmd_tambah_kolom('satlinmas',        'alasan_nonaktif',     'VARCHAR(100) NULL');
CALL _dpmd_tambah_kolom('satlinmas',        'keterangan_nonaktif', 'TEXT NULL');
CALL _dpmd_tambah_kolom('lembaga_lainnyas', 'alasan_nonaktif',     'VARCHAR(100) NULL');
CALL _dpmd_tambah_kolom('lembaga_lainnyas', 'keterangan_nonaktif', 'TEXT NULL');

-- satlinmas & lembaga_lainnyas belum punya nonaktif_at, padahal controller-nya
-- selalu menulis kolom itu saat menonaktifkan -> Prisma menolak arg tak dikenal
-- dan endpoint balas 500. Enam tabel lain sudah punya, jadi helper di atas akan
-- melewatinya dengan sendirinya.
CALL _dpmd_tambah_kolom('satlinmas',        'nonaktif_at', 'TIMESTAMP NULL');
CALL _dpmd_tambah_kolom('lembaga_lainnyas', 'nonaktif_at', 'TIMESTAMP NULL');

DROP PROCEDURE IF EXISTS _dpmd_tambah_kolom;
