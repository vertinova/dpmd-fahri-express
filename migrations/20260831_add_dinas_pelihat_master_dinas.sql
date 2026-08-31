-- BPKAD & Inspektorat sebagai dinas terkait berperan PELIHAT pada modul Bantuan
-- Keuangan Perubahan: hanya melihat & mengunduh arsip proposal yang sudah final
-- di DPMD, tanpa kewenangan verifikasi/edit apa pun.
--
-- Kode dinasnya (BPKAD, INSPEKTORAT) dipakai backend sebagai penanda peran
-- pelihat (lihat KODE_DINAS_PELIHAT di src/middlewares/auth.js), jadi jangan
-- diubah tanpa menyesuaikan konstanta tersebut.
--
-- Idempoten: INSERT ... SELECT ... WHERE NOT EXISTS supaya aman dijalankan ulang
-- tanpa menabrak unique key `kode_dinas`.
INSERT INTO `master_dinas` (`kode_dinas`, `nama_dinas`, `singkatan`, `is_active`, `created_at`, `updated_at`)
SELECT 'BPKAD', 'Badan Pengelolaan Keuangan dan Aset Daerah', 'BPKAD', 1, NOW(), NOW()
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM `master_dinas` WHERE `kode_dinas` = 'BPKAD');

INSERT INTO `master_dinas` (`kode_dinas`, `nama_dinas`, `singkatan`, `is_active`, `created_at`, `updated_at`)
SELECT 'INSPEKTORAT', 'Inspektorat Daerah', 'INSPEKTORAT', 1, NOW(), NOW()
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM `master_dinas` WHERE `kode_dinas` = 'INSPEKTORAT');
