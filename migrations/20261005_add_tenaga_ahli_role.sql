-- Migration: Register role "tenaga_ahli" untuk pendamping/konsultan di luar DPMD
-- Date: 2026-10-05
-- Description: Mendaftarkan role 'tenaga_ahli' di tabel master roles.
--              Kolom users.role sudah bertipe VARCHAR(50) (lihat
--              20260519b_users_role_to_varchar.sql) sehingga tidak perlu ALTER ENUM.
--
--              LINGKUP AKSES. Tenaga Ahli hanya MEMBACA dan mengekspor dua urusan
--              Bidang SPKED: pembinaan BUM Desa dan Kerja Sama Desa. Ia tidak
--              punya satu pun rute tulis, dan tidak ikut PERAN_INTERNAL_DPMD —
--              daftar peran itu membuka seluruh Core Dashboard. Enforcement-nya
--              di config/peranDpmd.js (PERAN_PEMANTAU_SPKED) untuk sisi server,
--              dan RoleProtectedRoute /tenaga-ahli untuk sisi peramban.
--
-- Idempotent: ON DUPLICATE KEY UPDATE → aman dijalankan berulang.

INSERT INTO `roles` (`name`, `label`, `color`, `description`, `category`, `is_system`, `needs_entity`, `created_at`, `updated_at`)
VALUES (
  'tenaga_ahli',
  'Tenaga Ahli',
  'cyan',
  'Pendamping di luar DPMD - lihat & ekspor data BUM Desa dan Kerja Sama Desa (tanpa hak ubah)',
  'external',
  0,
  0,
  NOW(),
  NOW()
)
ON DUPLICATE KEY UPDATE
  `label`       = VALUES(`label`),
  `color`       = VALUES(`color`),
  `description` = VALUES(`description`),
  `category`    = VALUES(`category`),
  `updated_at`  = NOW();
