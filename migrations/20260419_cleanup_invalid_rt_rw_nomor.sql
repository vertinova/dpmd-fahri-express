-- Cleanup pengurus linked to RT/RW with invalid (non-numeric) nomor like "00-", "-", etc.

-- Delete pengurus linked to invalid RT
DELETE FROM penguruses WHERE pengurusable_type IN ('rts', 'rt')
AND pengurusable_id IN (SELECT id FROM rts WHERE nomor NOT REGEXP '^[0-9]+$');

-- Delete pengurus linked to invalid RW
DELETE FROM penguruses WHERE pengurusable_type IN ('rws', 'rw')
AND pengurusable_id IN (SELECT id FROM rws WHERE nomor NOT REGEXP '^[0-9]+$');

-- Delete the invalid RT records
DELETE FROM rts WHERE nomor NOT REGEXP '^[0-9]+$';

-- Delete the invalid RW records
DELETE FROM rws WHERE nomor NOT REGEXP '^[0-9]+$';
