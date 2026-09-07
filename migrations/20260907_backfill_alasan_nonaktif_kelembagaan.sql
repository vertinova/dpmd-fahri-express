-- Backfill alasan/keterangan untuk lembaga yang SUDAH nonaktif sebelum kedua
-- kolom itu ada. Tanpa ini, kartu di ProfilCard tidak menampilkan apa pun untuk
-- mereka — kartu "SK Penonaktifan" yang lama sudah dihapus, jadi informasinya
-- hilang tanpa pengganti.
--
-- Ditulis set-based (berdasarkan kondisi, bukan daftar id) supaya menyapu
-- berapa pun baris yang ada di server saat deploy — jumlah di DB lokal tidak
-- mewakili produksi. Kedelapan tabel disapu tanpa syarat karena tidak bisa
-- dipastikan dari luar jenis lembaga mana saja yang punya baris nonaktif.
--
-- Kategori aslinya memang tidak pernah direkam, jadi semuanya jadi 'Lainnya'
-- (harus ada di ALASAN_NONAKTIF_LEMBAGA pada base.controller.js) dan penjelasan
-- rincinya diambil dari SK lama bila ada.
--
-- Idempoten: syarat `alasan_nonaktif IS NULL` membuat jalan kedua tidak
-- mengubah apa pun, sekaligus melindungi baris yang sudah diisi lewat form baru.
--
-- nonaktif_at sengaja dibiarkan apa adanya — mengarang tanggal penonaktifan
-- lebih buruk daripada membiarkannya kosong.

UPDATE `rws` AS l
LEFT JOIN `produk_hukums` AS ph ON ph.id = l.produk_hukum_penonaktifan_id
SET l.alasan_nonaktif = 'Lainnya',
    l.keterangan_nonaktif = IF(
      ph.id IS NULL,
      'Dinonaktifkan sebelum keterangan diwajibkan; alasan tidak tercatat.',
      CONCAT('Dinonaktifkan berdasarkan ', ph.singkatan_jenis, ' No. ', ph.nomor,
             ' Tahun ', ph.tahun, ' — ', ph.judul)
    )
WHERE l.status_kelembagaan = 'nonaktif'
  AND l.alasan_nonaktif IS NULL;

UPDATE `rts` AS l
LEFT JOIN `produk_hukums` AS ph ON ph.id = l.produk_hukum_penonaktifan_id
SET l.alasan_nonaktif = 'Lainnya',
    l.keterangan_nonaktif = IF(
      ph.id IS NULL,
      'Dinonaktifkan sebelum keterangan diwajibkan; alasan tidak tercatat.',
      CONCAT('Dinonaktifkan berdasarkan ', ph.singkatan_jenis, ' No. ', ph.nomor,
             ' Tahun ', ph.tahun, ' — ', ph.judul)
    )
WHERE l.status_kelembagaan = 'nonaktif'
  AND l.alasan_nonaktif IS NULL;

UPDATE `posyandus` AS l
LEFT JOIN `produk_hukums` AS ph ON ph.id = l.produk_hukum_penonaktifan_id
SET l.alasan_nonaktif = 'Lainnya',
    l.keterangan_nonaktif = IF(
      ph.id IS NULL,
      'Dinonaktifkan sebelum keterangan diwajibkan; alasan tidak tercatat.',
      CONCAT('Dinonaktifkan berdasarkan ', ph.singkatan_jenis, ' No. ', ph.nomor,
             ' Tahun ', ph.tahun, ' — ', ph.judul)
    )
WHERE l.status_kelembagaan = 'nonaktif'
  AND l.alasan_nonaktif IS NULL;

UPDATE `karang_tarunas` AS l
LEFT JOIN `produk_hukums` AS ph ON ph.id = l.produk_hukum_penonaktifan_id
SET l.alasan_nonaktif = 'Lainnya',
    l.keterangan_nonaktif = IF(
      ph.id IS NULL,
      'Dinonaktifkan sebelum keterangan diwajibkan; alasan tidak tercatat.',
      CONCAT('Dinonaktifkan berdasarkan ', ph.singkatan_jenis, ' No. ', ph.nomor,
             ' Tahun ', ph.tahun, ' — ', ph.judul)
    )
WHERE l.status_kelembagaan = 'nonaktif'
  AND l.alasan_nonaktif IS NULL;

UPDATE `lpms` AS l
LEFT JOIN `produk_hukums` AS ph ON ph.id = l.produk_hukum_penonaktifan_id
SET l.alasan_nonaktif = 'Lainnya',
    l.keterangan_nonaktif = IF(
      ph.id IS NULL,
      'Dinonaktifkan sebelum keterangan diwajibkan; alasan tidak tercatat.',
      CONCAT('Dinonaktifkan berdasarkan ', ph.singkatan_jenis, ' No. ', ph.nomor,
             ' Tahun ', ph.tahun, ' — ', ph.judul)
    )
WHERE l.status_kelembagaan = 'nonaktif'
  AND l.alasan_nonaktif IS NULL;

UPDATE `pkks` AS l
LEFT JOIN `produk_hukums` AS ph ON ph.id = l.produk_hukum_penonaktifan_id
SET l.alasan_nonaktif = 'Lainnya',
    l.keterangan_nonaktif = IF(
      ph.id IS NULL,
      'Dinonaktifkan sebelum keterangan diwajibkan; alasan tidak tercatat.',
      CONCAT('Dinonaktifkan berdasarkan ', ph.singkatan_jenis, ' No. ', ph.nomor,
             ' Tahun ', ph.tahun, ' — ', ph.judul)
    )
WHERE l.status_kelembagaan = 'nonaktif'
  AND l.alasan_nonaktif IS NULL;

UPDATE `satlinmas` AS l
LEFT JOIN `produk_hukums` AS ph ON ph.id = l.produk_hukum_penonaktifan_id
SET l.alasan_nonaktif = 'Lainnya',
    l.keterangan_nonaktif = IF(
      ph.id IS NULL,
      'Dinonaktifkan sebelum keterangan diwajibkan; alasan tidak tercatat.',
      CONCAT('Dinonaktifkan berdasarkan ', ph.singkatan_jenis, ' No. ', ph.nomor,
             ' Tahun ', ph.tahun, ' — ', ph.judul)
    )
WHERE l.status_kelembagaan = 'nonaktif'
  AND l.alasan_nonaktif IS NULL;

UPDATE `lembaga_lainnyas` AS l
LEFT JOIN `produk_hukums` AS ph ON ph.id = l.produk_hukum_penonaktifan_id
SET l.alasan_nonaktif = 'Lainnya',
    l.keterangan_nonaktif = IF(
      ph.id IS NULL,
      'Dinonaktifkan sebelum keterangan diwajibkan; alasan tidak tercatat.',
      CONCAT('Dinonaktifkan berdasarkan ', ph.singkatan_jenis, ' No. ', ph.nomor,
             ' Tahun ', ph.tahun, ' — ', ph.judul)
    )
WHERE l.status_kelembagaan = 'nonaktif'
  AND l.alasan_nonaktif IS NULL;
