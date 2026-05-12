-- Re-normalize pendidikan setelah import baru membawa nilai-nilai tidak konsisten.
-- Menambah kasus yang belum ada di 20260418_normalize_pendidikan.sql:
--   SMEA, STM, SPG → SMA/SMK/MA
--   SI, SI/D4      → S1
--   Case variation "Tidak Diketahui" → TIDAK DIKETAHUI

-- ── SD/MI ─────────────────────────────────────────────────────────────────────
UPDATE pengurus SET pendidikan = 'SD/MI'
WHERE UPPER(TRIM(pendidikan)) IN (
  'SD', 'SDN', 'MI', 'SD/MI', 'SD/SEDERAJAT', 'SEKOLAH DASAR'
);

-- ── SMP/MTS ───────────────────────────────────────────────────────────────────
UPDATE pengurus SET pendidikan = 'SMP/MTS'
WHERE UPPER(TRIM(pendidikan)) IN (
  'SMP', 'MTS', 'SLTP', 'SMP/MTS', 'SLTP/SEDERAJAT', 'SMP/SEDERAJAT',
  'TSANAWIYAH', 'MTS.'
);

-- ── SMA/SMK/MA ────────────────────────────────────────────────────────────────
-- Termasuk: SMEA (SMK bisnis lama), STM (SMK teknik lama), SPG (setara SMA)
UPDATE pengurus SET pendidikan = 'SMA/SMK/MA'
WHERE UPPER(TRIM(pendidikan)) IN (
  'SMA', 'SMK', 'MA', 'MAN', 'SLTA', 'SLA',
  'SMA/SMK', 'SMA/MA', 'SMA/SMK/MA',
  'SLTA/SEDERAJAT', 'SMA/SEDERAJAT',
  'SMEA', 'STM', 'SPG', 'SMKK', 'SMAK', 'SMIP',
  'SEKOLAH MENENGAH ATAS', 'ALIYAH'
);

-- ── D1 ────────────────────────────────────────────────────────────────────────
UPDATE pengurus SET pendidikan = 'D1'
WHERE UPPER(TRIM(pendidikan)) IN ('D-1', 'D.1', 'DIPLOMA I', 'DIPLOMA 1', 'D1');

-- ── D2 ────────────────────────────────────────────────────────────────────────
UPDATE pengurus SET pendidikan = 'D2'
WHERE UPPER(TRIM(pendidikan)) IN ('D-2', 'D.2', 'DIPLOMA II', 'DIPLOMA 2', 'D2');

-- ── D3 ────────────────────────────────────────────────────────────────────────
UPDATE pengurus SET pendidikan = 'D3'
WHERE UPPER(TRIM(pendidikan)) IN (
  'D-3', 'D.3', 'DIPLOMA III', 'DIPLOMA 3', 'DIPLOMA', 'AKADEMI', 'D3'
);

-- ── S1 ────────────────────────────────────────────────────────────────────────
-- SI = ejaan lama S1; SI/D4 = setara S1
UPDATE pengurus SET pendidikan = 'S1'
WHERE UPPER(TRIM(pendidikan)) IN (
  'S1', 'S-1', 'S.1', 'S 1', 'SI', 'SI/D4', 'S1/D4', 'D4', 'D-4',
  'SARJANA', 'STRATA 1', 'STRATA I', 'S1/SEDERAJAT', 'S 1/SEDERAJAT'
);

-- ── S2 ────────────────────────────────────────────────────────────────────────
UPDATE pengurus SET pendidikan = 'S2'
WHERE UPPER(TRIM(pendidikan)) IN (
  'S2', 'S-2', 'S.2', 'S 2', 'MAGISTER', 'STRATA 2', 'STRATA II'
);

-- ── S3 ────────────────────────────────────────────────────────────────────────
UPDATE pengurus SET pendidikan = 'S3'
WHERE UPPER(TRIM(pendidikan)) IN (
  'S3', 'S-3', 'S.3', 'S 3', 'DOKTOR', 'STRATA 3', 'STRATA III'
);

-- ── TIDAK SEKOLAH ─────────────────────────────────────────────────────────────
UPDATE pengurus SET pendidikan = 'TIDAK SEKOLAH'
WHERE UPPER(TRIM(pendidikan)) IN (
  'TIDAK SEKOLAH', 'TDK SEKOLAH', 'TIDAK ADA', 'TDK ADA',
  'BELUM SEKOLAH', 'TIDAK PERNAH SEKOLAH'
);

-- ── TIDAK DIKETAHUI ───────────────────────────────────────────────────────────
-- Case variation: "Tidak Diketahui" → "TIDAK DIKETAHUI"
UPDATE pengurus SET pendidikan = 'TIDAK DIKETAHUI'
WHERE UPPER(TRIM(pendidikan)) = 'TIDAK DIKETAHUI'
  AND BINARY pendidikan != 'TIDAK DIKETAHUI';

-- NULL / kosong / strip/angka tidak valid → TIDAK DIKETAHUI
UPDATE pengurus SET pendidikan = 'TIDAK DIKETAHUI'
WHERE pendidikan IS NULL
   OR TRIM(pendidikan) IN ('', '-', '0');
