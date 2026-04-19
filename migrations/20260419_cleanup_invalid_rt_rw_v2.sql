-- Re-cleanup pengurus linked to RT/RW with invalid (non-numeric) nomor like "00-", "-", etc.
-- Previous migration ran but import script re-created the data. xlsx files now removed from git.

-- Delete pengurus linked to invalid RT
DELETE FROM pengurus WHERE pengurusable_type IN ('rts', 'rt')
AND pengurusable_id IN (SELECT id FROM rts WHERE nomor NOT REGEXP '^[0-9]+$');

-- Delete pengurus linked to invalid RW
DELETE FROM pengurus WHERE pengurusable_type IN ('rws', 'rw')
AND pengurusable_id IN (SELECT id FROM rws WHERE nomor NOT REGEXP '^[0-9]+$');

-- Delete the invalid RT records
DELETE FROM rts WHERE nomor NOT REGEXP '^[0-9]+$';

-- Delete the invalid RW records
DELETE FROM rws WHERE nomor NOT REGEXP '^[0-9]+$';
