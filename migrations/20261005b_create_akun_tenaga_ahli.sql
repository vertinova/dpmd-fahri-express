-- Migration: Akun Tenaga Ahli — Suki
-- Date: 2026-10-05
-- Description: Membuat akun login untuk Tenaga Ahli bernama Suki.
--
--              Sandi awal adalah SANDI_DEFAULT ('password', lihat
--              src/config/sandiDefault.js). Hash di bawah adalah bcrypt dari
--              kata itu — hash yang SAMA dipakai seluruh akun bawaan lain
--              (database-express/seeders/create_dinas_users.sql), dan auth
--              controller mengenalinya lewat isUsingDefaultPassword() sehingga
--              ForceChangePasswordModal muncul dan memaksa penggantian pada
--              login pertama. Jangan ganti hash ini dengan hash sandi lain:
--              akunnya akan langsung masuk tanpa dipaksa ganti sandi.
--
--              Tidak diberi desa_id/kecamatan_id/bidang_id/dinas_id. Tenaga Ahli
--              memantau se-kabupaten dan bukan bagian dari struktur dinas; satu
--              pun kolom lingkup yang terisi akan membuat middleware wilayah
--              menyaring datanya separuh.
--
-- Idempotent: users.email bersifat UNIQUE (users_email_unique), sehingga
--             ON DUPLICATE KEY UPDATE menyelaraskan akun yang sudah ada tanpa
--             menduplikasinya. Sandi SENGAJA tidak ikut ditimpa — kalau Suki
--             sudah mengganti sandinya, menjalankan ulang migrasi tidak boleh
--             mengembalikannya ke 'password'.

INSERT INTO `users`
  (`name`, `email`, `password`, `plain_password`, `role`, `is_active`, `created_at`, `updated_at`)
VALUES (
  'Suki',
  'suki@dpmd.bogorkab.go.id',
  '$2a$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi',
  'password',
  'tenaga_ahli',
  1,
  NOW(),
  NOW()
)
ON DUPLICATE KEY UPDATE
  `name`       = VALUES(`name`),
  `role`       = VALUES(`role`),
  `is_active`  = VALUES(`is_active`),
  `updated_at` = NOW();
