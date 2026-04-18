-- Remove pengurus records with empty/invalid jabatan
DELETE FROM pengurus
WHERE jabatan IS NULL
   OR TRIM(jabatan) = ''
   OR TRIM(jabatan) = '-';

-- Remove RT pengurus that are linked to an RW (wrong assignment due to missing RT number)
-- These are records where jabatan contains 'RT' but pengurusable_type = 'App\\Models\\Rw'
DELETE FROM pengurus
WHERE UPPER(jabatan) LIKE '%KETUA RT%'
  AND pengurusable_type = 'App\\Models\\Rw';
