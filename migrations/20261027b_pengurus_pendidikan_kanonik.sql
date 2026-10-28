-- Menyeragamkan ejaan kolom pengurus.pendidikan.
--
-- Isian lama datang dari beberapa sumber impor dengan ejaan berbeda untuk
-- jenjang yang sama ("SD/MI" vs "SD", "SMA/SMK/MA" vs "SMA/SMK" vs "SMA",
-- "S1/D4" vs "S1"), sehingga satu jenjang terpecah jadi beberapa baris di
-- rekap dan nilainya tidak ada di daftar pilihan form (select tampil kosong
-- saat pengurus lama dibuka, dan nilainya bisa hilang saat disimpan).
--
-- Nilai kanonik mengikuti opsi form: TIDAK SEKOLAH, SD, SMP, SMA/SMK,
-- D1, D2, D3, S1, S2, S3, dan NULL untuk yang memang tidak diketahui.
-- Ejaan di luar daftar sengaja dibiarkan apa adanya: rekap di
-- src/utils/jenjangPendidikan.js tetap mengelompokkannya dengan benar,
-- jadi tidak ada data yang dipaksa masuk jenjang yang salah.
--
-- `updated_at = updated_at` disetel eksplisit supaya kolom ON UPDATE
-- CURRENT_TIMESTAMP tidak ikut berubah: ini pembenahan ejaan, bukan
-- perubahan data oleh desa, jadi jejak "terakhir diubah" harus tetap.
--
-- Aman dijalankan berulang: tiap statement hanya menyentuh ejaan lama, dan
-- nilai kanonik tidak pernah jadi sasaran WHERE mana pun sehingga tidak ada
-- konversi beruntun.

-- Rapikan spasi dulu supaya pencocokan di bawah tidak meleset karena spasi
-- di depan. BINARY dipakai karena collation utf8mb4_unicode_ci menganggap
-- spasi di ujung tidak berbeda, sehingga perbandingan biasa selalu false.
UPDATE pengurus SET pendidikan = TRIM(pendidikan), updated_at = updated_at
  WHERE pendidikan IS NOT NULL AND BINARY pendidikan <> BINARY TRIM(pendidikan);

UPDATE pengurus SET pendidikan = 'SD', updated_at = updated_at
  WHERE pendidikan IN ('SD/MI', 'MI', 'PAKET A');

UPDATE pengurus SET pendidikan = 'SMP', updated_at = updated_at
  WHERE pendidikan IN ('SMP/MTS', 'MTS', 'SLTP', 'PAKET B');

UPDATE pengurus SET pendidikan = 'SMA/SMK', updated_at = updated_at
  WHERE pendidikan IN ('SMA/SMK/MA', 'SMA', 'SMK', 'MA', 'SLTA', 'STM', 'SMEA', 'PAKET C');

UPDATE pengurus SET pendidikan = 'S1', updated_at = updated_at
  WHERE pendidikan IN ('S1/D4', 'D4');

UPDATE pengurus SET pendidikan = NULL, updated_at = updated_at
  WHERE pendidikan IN ('TIDAK DIKETAHUI', 'TIDAK ADA', '-', '');
