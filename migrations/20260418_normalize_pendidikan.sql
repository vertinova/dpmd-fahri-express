-- Normalize pendidikan values in pengurus table

-- SD / MI / SDN → SD/MI
UPDATE pengurus SET pendidikan = 'SD/MI' WHERE UPPER(TRIM(pendidikan)) IN ('SD', 'SDN', 'MI', 'SD/MI', 'SD/SEDERAJAT');

-- SMP / MTS / SLTP → SMP/MTS
UPDATE pengurus SET pendidikan = 'SMP/MTS' WHERE UPPER(TRIM(pendidikan)) IN ('SMP', 'MTS', 'SLTP', 'SMP/MTS', 'SLTP/SEDERAJAT', 'SMP/SEDERAJAT');

-- SMA / SMK / MA / SLTA / MAN / SLA → SMA/SMK/MA
UPDATE pengurus SET pendidikan = 'SMA/SMK/MA' WHERE UPPER(TRIM(pendidikan)) IN ('SMA', 'SMK', 'MA', 'MAN', 'SLTA', 'SLA', 'SMA/SMK', 'SMA/MA', 'SLTA/SEDERAJAT', 'SMA/SEDERAJAT', 'SMA/SMK/MA');

-- D1
UPDATE pengurus SET pendidikan = 'D1' WHERE UPPER(TRIM(pendidikan)) IN ('D-1', 'D.1', 'DIPLOMA I', 'DIPLOMA 1');

-- D2
UPDATE pengurus SET pendidikan = 'D2' WHERE UPPER(TRIM(pendidikan)) IN ('D-2', 'D.2', 'DIPLOMA II', 'DIPLOMA 2');

-- D3 / AKADEMI / DIPLOMA → D3
UPDATE pengurus SET pendidikan = 'D3' WHERE UPPER(TRIM(pendidikan)) IN ('D-3', 'D.3', 'DIPLOMA III', 'DIPLOMA 3', 'DIPLOMA', 'AKADEMI');

-- S1 / SARJANA / BERIJAZAH → S1
UPDATE pengurus SET pendidikan = 'S1' WHERE UPPER(TRIM(pendidikan)) IN ('S-1', 'S.1', 'S 1', 'SARJANA', 'STRATA 1', 'STRATA I', 'S 1/SEDERAJAT', 'S1/SEDERAJAT', 'BERIJAZAH', 'DIPLOMA I');

-- S2
UPDATE pengurus SET pendidikan = 'S2' WHERE UPPER(TRIM(pendidikan)) IN ('S-2', 'S.2', 'S 2', 'MAGISTER', 'STRATA 2', 'STRATA II');

-- S3
UPDATE pengurus SET pendidikan = 'S3' WHERE UPPER(TRIM(pendidikan)) IN ('S-3', 'S.3', 'S 3', 'DOKTOR', 'STRATA 3', 'STRATA III');

-- TDK ADA / TIDAK ADA → TIDAK SEKOLAH
UPDATE pengurus SET pendidikan = 'TIDAK SEKOLAH' WHERE UPPER(TRIM(pendidikan)) IN ('TDK ADA', 'TIDAK ADA', 'TIDAK SEKOLAH', 'TDK SEKOLAH', 'BELUM SEKOLAH');

-- Empty / dash / 0 / unknown → TIDAK DIKETAHUI
UPDATE pengurus SET pendidikan = 'TIDAK DIKETAHUI' WHERE pendidikan IS NULL OR TRIM(pendidikan) = '' OR TRIM(pendidikan) = '-' OR TRIM(pendidikan) = '0';
