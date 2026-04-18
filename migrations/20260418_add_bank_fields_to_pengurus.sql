-- Migration: Add bank/rekening fields to pengurus table
-- Needed for RT/RW data import from Excel (insentif payment info)

ALTER TABLE pengurus
  ADD COLUMN IF NOT EXISTS nama_bank     VARCHAR(100)  NULL AFTER no_telepon,
  ADD COLUMN IF NOT EXISTS nomor_rekening VARCHAR(100) NULL AFTER nama_bank,
  ADD COLUMN IF NOT EXISTS nama_rekening  VARCHAR(255) NULL AFTER nomor_rekening;
