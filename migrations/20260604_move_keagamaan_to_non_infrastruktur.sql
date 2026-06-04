-- Pindahkan "Sarana dan Prasarana Keagamaan" dari kategori
-- pilihan_infrastruktur ke pilihan_non_infrastruktur pada master kegiatan
-- Bankeu Perubahan. Idempotent: hanya mengubah baris yang masih ber-kategori infrastruktur.
--
-- Konteks: di seeder (seedBankeuPerubahanMaster.js) data ini dipindah ke
-- non-infrastruktur dengan urutan 8. Migrasi ini menyelaraskan data yang
-- sudah ter-seed sebelumnya di database.

UPDATE bankeu_perubahan_master_kegiatan
SET kategori = 'pilihan_non_infrastruktur',
    urutan = 8
WHERE nama_kegiatan = 'Sarana dan Prasarana Keagamaan'
  AND kategori = 'pilihan_infrastruktur';
