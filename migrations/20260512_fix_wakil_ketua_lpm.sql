-- Ubah jabatan "WAKIL KETUA LPM" menjadi "ANGGOTA" pada lembaga LPM
-- Jabatan ini tidak dikenal dalam struktur LPM dan seharusnya menjadi ANGGOTA

UPDATE pengurus
SET jabatan = 'ANGGOTA'
WHERE UPPER(TRIM(jabatan)) = 'WAKIL KETUA LPM'
  AND pengurusable_type IN ('lpm', 'lpms');
