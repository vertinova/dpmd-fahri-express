-- Fix KETUA RT yang salah berada di kelembagaan RW → ubah jadi KETUA RW
UPDATE pengurus SET jabatan = 'KETUA RW'
WHERE UPPER(TRIM(jabatan)) = 'KETUA RT'
  AND pengurusable_type IN ('rw', 'rws');
