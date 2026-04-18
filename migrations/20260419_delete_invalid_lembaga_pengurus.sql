-- Delete pengurus whose RT/RW lembaga has nomor = "-" or empty (invalid data)
DELETE p FROM pengurus p
INNER JOIN rws r ON p.pengurusable_id = r.id AND p.pengurusable_type IN ('rw', 'rws')
WHERE TRIM(r.nomor) = '-' OR TRIM(r.nomor) = '' OR r.nomor IS NULL;

DELETE p FROM pengurus p
INNER JOIN rts r ON p.pengurusable_id = r.id AND p.pengurusable_type IN ('rt', 'rts')
WHERE TRIM(r.nomor) = '-' OR TRIM(r.nomor) = '' OR r.nomor IS NULL;

-- Also delete the RW/RT lembaga records themselves that have nomor = "-"
DELETE FROM rts WHERE TRIM(nomor) = '-' OR TRIM(nomor) = '' OR nomor IS NULL;
DELETE FROM rws WHERE TRIM(nomor) = '-' OR TRIM(nomor) = '' OR nomor IS NULL;
