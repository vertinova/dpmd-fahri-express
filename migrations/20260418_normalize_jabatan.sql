-- Normalize jabatan values for existing pengurus data
-- Fix typos, inconsistent casing, and extra info in jabatan field

-- "0" in RW context → KETUA RW
UPDATE pengurus SET jabatan = 'KETUA RW'
WHERE TRIM(jabatan) = '0' AND pengurusable_type IN ('rw', 'rws');

-- "0" in RT context → KETUA RT
UPDATE pengurus SET jabatan = 'KETUA RT'
WHERE TRIM(jabatan) = '0' AND pengurusable_type IN ('rt', 'rts');

-- Bare "RW" → KETUA RW
UPDATE pengurus SET jabatan = 'KETUA RW'
WHERE UPPER(TRIM(jabatan)) = 'RW';

-- Bare "RT" → KETUA RT
UPDATE pengurus SET jabatan = 'KETUA RT'
WHERE UPPER(TRIM(jabatan)) = 'RT';

-- Bare "KETUA" in RW → KETUA RW
UPDATE pengurus SET jabatan = 'KETUA RW'
WHERE UPPER(TRIM(jabatan)) = 'KETUA' AND pengurusable_type IN ('rw', 'rws');

-- Bare "KETUA" in RT → KETUA RT
UPDATE pengurus SET jabatan = 'KETUA RT'
WHERE UPPER(TRIM(jabatan)) = 'KETUA' AND pengurusable_type IN ('rt', 'rts');

-- Typo: KETAU RW → KETUA RW
UPDATE pengurus SET jabatan = 'KETUA RW'
WHERE UPPER(TRIM(jabatan)) = 'KETAU RW';

-- Typo: KETAU RT → KETUA RT
UPDATE pengurus SET jabatan = 'KETUA RT'
WHERE UPPER(TRIM(jabatan)) = 'KETAU RT';

-- Typo: KETUA RTW → KETUA RW
UPDATE pengurus SET jabatan = 'KETUA RW'
WHERE UPPER(TRIM(jabatan)) = 'KETUA RTW';

-- KET. RW → KETUA RW
UPDATE pengurus SET jabatan = 'KETUA RW'
WHERE UPPER(TRIM(jabatan)) IN ('KET. RW', 'KET RW');

-- KET. RT → KETUA RT
UPDATE pengurus SET jabatan = 'KETUA RT'
WHERE UPPER(TRIM(jabatan)) IN ('KET. RT', 'KET RT');

-- Strip trailing numbers/dots: "Ketua RT.001", "Ketua RT 002 RW 02", "Ketua RT 01 RW 02" etc → KETUA RT
UPDATE pengurus SET jabatan = 'KETUA RT'
WHERE UPPER(TRIM(jabatan)) REGEXP '^KETUA RT[. ]+[0-9]'
  AND UPPER(TRIM(jabatan)) != 'KETUA RT';

-- Strip trailing numbers/dots for RW: "Ketua RW.001" etc → KETUA RW
UPDATE pengurus SET jabatan = 'KETUA RW'
WHERE UPPER(TRIM(jabatan)) REGEXP '^KETUA RW[. ]+[0-9]'
  AND UPPER(TRIM(jabatan)) != 'KETUA RW';

-- Normalize casing: ensure all jabatan with KETUA RT/RW are uppercase
UPDATE pengurus SET jabatan = 'KETUA RT'
WHERE UPPER(TRIM(jabatan)) = 'KETUA RT' AND BINARY jabatan != 'KETUA RT';

UPDATE pengurus SET jabatan = 'KETUA RW'
WHERE UPPER(TRIM(jabatan)) = 'KETUA RW' AND BINARY jabatan != 'KETUA RW';

-- Normalize: Sekretaris/Bendahara etc uppercase
UPDATE pengurus SET jabatan = UPPER(TRIM(jabatan))
WHERE BINARY jabatan != UPPER(TRIM(jabatan))
  AND pengurusable_type IN ('rw', 'rws', 'rt', 'rts');
