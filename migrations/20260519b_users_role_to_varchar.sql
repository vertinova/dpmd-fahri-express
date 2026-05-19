-- Migration: Konversi users.role dari ENUM ke VARCHAR(50)
-- Date: 2026-05-19
-- Description: Selaraskan kolom users.role dengan schema.prisma yang sudah memakai
--              `String @db.VarChar(50)`. ENUM lama menghambat penambahan role baru
--              (termasuk 'bpjs') karena nilai harus dideklarasikan eksplisit.
--              Setelah ini, role baru cukup didaftarkan via tabel master `roles`.
--
-- Idempotent: MODIFY ke tipe yang sama (VARCHAR(50)) adalah no-op di MySQL,
--             aman dijalankan berulang.

ALTER TABLE `users`
  MODIFY COLUMN `role` VARCHAR(50) NOT NULL DEFAULT 'desa';
