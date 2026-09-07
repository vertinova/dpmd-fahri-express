-- Nonaktifkan pengurus yang masih 'aktif' padahal lembaga induknya sudah
-- 'nonaktif'.
--
-- Sampai sekarang menonaktifkan lembaga tidak menyentuh pengurus di bawahnya
-- sama sekali, sehingga mereka tetap terhitung aktif di bawah lembaga yang
-- sudah mati — ikut terbawa ke rekap dan daftar pengurus aktif. Kaskadenya
-- sudah dipasang di aplikasi (nonaktifkanPengurusLembaga pada
-- base.controller.js); file ini membereskan baris yang terlanjur ada.
--
-- Ditulis set-based (berdasarkan kondisi, bukan daftar id) supaya menyapu
-- berapa pun baris yang ada di server saat deploy — hitungan di DB lokal tidak
-- mewakili produksi yang datanya lebih baru.
--
-- Hanya status 'aktif' yang disentuh: 'selesai' dibiarkan utuh supaya riwayat
-- jabatan yang memang sudah berakhir tidak tertimpa.
--
-- Idempoten: setelah jalan pertama tidak ada lagi baris yang memenuhi
-- `status_jabatan = 'aktif'` untuk lembaga nonaktif, jadi jalan kedua
-- mengubah nol baris.
--
-- Kaskadenya SATU ARAH — mengaktifkan kembali lembaga tidak memulihkan
-- pengurusnya, karena tidak ada penanda yang membedakan nonaktif akibat
-- kaskade dari nonaktif yang disetel satu per satu.
--
-- pengurusable_type memakai nama tabel Prisma untuk semua jenis KECUALI
-- lembaga lainnya, yang tercatat dengan dua varian ('lembaga-lainnya' dari
-- form dan 'lembaga_lainnyas' dari data lama) — keduanya disapu.

UPDATE `pengurus` AS p
JOIN `rws` AS l ON l.id = p.pengurusable_id
SET p.status_jabatan = 'nonaktif',
    p.updated_at = NOW()
WHERE p.pengurusable_type = 'rws'
  AND l.status_kelembagaan = 'nonaktif'
  AND p.status_jabatan = 'aktif';

UPDATE `pengurus` AS p
JOIN `rts` AS l ON l.id = p.pengurusable_id
SET p.status_jabatan = 'nonaktif',
    p.updated_at = NOW()
WHERE p.pengurusable_type = 'rts'
  AND l.status_kelembagaan = 'nonaktif'
  AND p.status_jabatan = 'aktif';

UPDATE `pengurus` AS p
JOIN `posyandus` AS l ON l.id = p.pengurusable_id
SET p.status_jabatan = 'nonaktif',
    p.updated_at = NOW()
WHERE p.pengurusable_type = 'posyandus'
  AND l.status_kelembagaan = 'nonaktif'
  AND p.status_jabatan = 'aktif';

UPDATE `pengurus` AS p
JOIN `lpms` AS l ON l.id = p.pengurusable_id
SET p.status_jabatan = 'nonaktif',
    p.updated_at = NOW()
WHERE p.pengurusable_type = 'lpms'
  AND l.status_kelembagaan = 'nonaktif'
  AND p.status_jabatan = 'aktif';

UPDATE `pengurus` AS p
JOIN `karang_tarunas` AS l ON l.id = p.pengurusable_id
SET p.status_jabatan = 'nonaktif',
    p.updated_at = NOW()
WHERE p.pengurusable_type = 'karang_tarunas'
  AND l.status_kelembagaan = 'nonaktif'
  AND p.status_jabatan = 'aktif';

UPDATE `pengurus` AS p
JOIN `pkks` AS l ON l.id = p.pengurusable_id
SET p.status_jabatan = 'nonaktif',
    p.updated_at = NOW()
WHERE p.pengurusable_type = 'pkks'
  AND l.status_kelembagaan = 'nonaktif'
  AND p.status_jabatan = 'aktif';

UPDATE `pengurus` AS p
JOIN `satlinmas` AS l ON l.id = p.pengurusable_id
SET p.status_jabatan = 'nonaktif',
    p.updated_at = NOW()
WHERE p.pengurusable_type = 'satlinmas'
  AND l.status_kelembagaan = 'nonaktif'
  AND p.status_jabatan = 'aktif';

UPDATE `pengurus` AS p
JOIN `lembaga_lainnyas` AS l ON l.id = p.pengurusable_id
SET p.status_jabatan = 'nonaktif',
    p.updated_at = NOW()
WHERE p.pengurusable_type IN ('lembaga-lainnya', 'lembaga_lainnyas')
  AND l.status_kelembagaan = 'nonaktif'
  AND p.status_jabatan = 'aktif';
