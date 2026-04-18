-- Migration: Add bank/rekening fields to pengurus table
-- Needed for RT/RW data import from Excel (insentif payment info)

-- Split into separate statements so auto-migrate can skip individually (errno 1060)
ALTER TABLE pengurus ADD COLUMN nama_bank VARCHAR(100) NULL AFTER no_telepon;
ALTER TABLE pengurus ADD COLUMN nomor_rekening VARCHAR(100) NULL AFTER nama_bank;
ALTER TABLE pengurus ADD COLUMN nama_rekening VARCHAR(255) NULL AFTER nomor_rekening;
