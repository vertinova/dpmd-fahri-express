-- Migration: Register role "bpjs" untuk instansi eksternal BPJS
-- Date: 2026-05-19
-- Description: Mendaftarkan role 'bpjs' di tabel master roles.
--              Kolom users.role sudah bertipe VARCHAR(50) sehingga tidak perlu ALTER ENUM.
--              Akun BPJS hanya boleh mengakses fitur RT/RW Comparison (dienforce di frontend).
--
-- Idempotent: ON DUPLICATE KEY UPDATE → aman dijalankan berulang oleh auto-migrate.js.

INSERT INTO `roles` (`name`, `label`, `color`, `description`, `category`, `is_system`, `needs_entity`, `created_at`, `updated_at`)
VALUES (
  'bpjs',
  'BPJS Ketenagakerjaan',
  'emerald',
  'Akun instansi BPJS - akses terbatas ke fitur RT/RW Comparison',
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
