-- Ubah nama kegiatan pilihan infrastruktur (Bankeu Perubahan):
-- "Pembangunan/Rehab Kantor Desa" -> "Pembangunan/Rehabilitasi/Rekonstruksi Kantor Desa"

UPDATE `bankeu_perubahan_master_kegiatan`
SET `nama_kegiatan` = 'Pembangunan/Rehabilitasi/Rekonstruksi Kantor Desa'
WHERE `nama_kegiatan` = 'Pembangunan/Rehab Kantor Desa';

-- Sinkronkan nama yang terdenormalisasi di proposal yang sudah ada
UPDATE `bankeu_perubahan_proposals`
SET `kegiatan_nama` = 'Pembangunan/Rehabilitasi/Rekonstruksi Kantor Desa'
WHERE `kegiatan_nama` = 'Pembangunan/Rehab Kantor Desa';
