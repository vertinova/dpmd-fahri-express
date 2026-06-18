-- Add device_id column to users table for device registration/binding
ALTER TABLE users ADD COLUMN device_id VARCHAR(100) NULL AFTER plain_password;

-- Add device_id column to absensi_pegawai table for tracking attendance device
ALTER TABLE absensi_pegawai ADD COLUMN device_id VARCHAR(100) NULL AFTER lokasi_keluar;
