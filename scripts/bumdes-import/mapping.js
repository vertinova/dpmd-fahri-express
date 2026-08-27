// Peta kolom CSV "Rekap data Keseluruhan BUM Desa" -> tabel `bumdes`.
//
// Satu berkas ini jadi sumber kebenaran untuk DUA hal sekaligus:
//   1. DDL kolom baru (import-bumdes.js --print-ddl)
//   2. Pengisian nilai saat impor
// Digabung supaya DDL dan importer tidak bisa berbeda diam-diam.
//
// csv  : indeks kolom di CSV (header = baris ke-3, data mulai baris ke-5)
// col  : nama kolom di tabel bumdes
// tipe : cara membaca nilai - 'teks' | 'uang' | 'bulat' | 'enum'
// ddl  : null bila kolom SUDAH ADA di produksi; diisi bila kolom perlu dibuat
//
// CATATAN PENTING soal kolom dokumen:
// Di CSV, kolom "Laporan Keuangan 2021", "Perdes", "AD", "ART", dst berisi
// CEKLIS ("v", "disusulkan di WA"), sedangkan kolom bernama sama di database
// berisi PATH FILE yang dipakai aplikasi untuk menyajikan unduhan. Keduanya
// beda arti, jadi ceklis CSV TIDAK diimpor sama sekali dan kolom path file
// tidak pernah disentuh importer (lihat KOLOM_DIPERTAHANKAN). Berkas aslinya
// diunggah manual lewat akun pegawai SPKED.

const PETA = [
  // ---------- Identitas (kode/kecamatan/desa diambil dari tabel desas) ----------
  { csv: 5, col: 'namabumdesa', tipe: 'teks', ddl: null },

  // ---------- Status ----------
  { csv: 8, col: 'status', tipe: 'enum', ddl: null }, // 2025, fallback ke 2024
  { csv: 9, col: 'keterangan_tidak_aktif', tipe: 'teks', ddl: null },
  { csv: 6, col: 'Status2024', tipe: 'teks', ddl: 'VARCHAR(20)' },
  { csv: 7, col: 'KeteranganTidakAktif2024', tipe: 'teks', ddl: 'VARCHAR(20)' },

  // ---------- Pemeringkatan ----------
  { csv: 10, col: 'Pemeringkatan2022', tipe: 'teks', ddl: 'VARCHAR(30)' },
  { csv: 11, col: 'NilaiPemeringkatan2022', tipe: 'teks', ddl: 'VARCHAR(10)' },
  { csv: 12, col: 'Pemeringkatan2023', tipe: 'teks', ddl: 'VARCHAR(30)' },
  { csv: 13, col: 'NilaiPemeringkatan2023', tipe: 'teks', ddl: 'VARCHAR(10)' },
  { csv: 14, col: 'Pemeringkatan2024', tipe: 'teks', ddl: 'VARCHAR(30)' },
  { csv: 15, col: 'KetPemeringkatan2024', tipe: 'teks', ddl: 'VARCHAR(10)' },
  { csv: 16, col: 'Pemeringkatan2024Sem1', tipe: 'teks', ddl: 'VARCHAR(30)' },
  { csv: 17, col: 'PemeringkatanApp2023', tipe: 'teks', ddl: 'VARCHAR(30)' },
  { csv: 18, col: 'EvaluasiRPJMN2024', tipe: 'teks', ddl: 'VARCHAR(30)' },
  { csv: 19, col: 'PemeringkatanApp2024', tipe: 'teks', ddl: 'VARCHAR(30)' },
  { csv: 20, col: 'Pemeringkatan2026', tipe: 'teks', ddl: 'VARCHAR(30)' },

  // ---------- Legalitas ----------
  { csv: 21, col: 'NIB', tipe: 'teks', ddl: null },
  { csv: 22, col: 'LKPP', tipe: 'teks', ddl: null },
  { csv: 23, col: 'NPWP', tipe: 'teks', ddl: null },
  // badanhukum diisi khusus (lihat import-bumdes.js): kosakata CSV dipetakan ke
  // kosakata yang dibaca dashboard. Nilai apa adanya disimpan di kolom 2026.
  { csv: 24, col: 'StatusBadanHukum2026', tipe: 'teks', ddl: 'VARCHAR(60)' },
  { csv: 25, col: 'StatusBadanHukum2026Feb', tipe: 'teks', ddl: 'VARCHAR(60)' },
  { csv: 26, col: 'StatusBadanHukum2025Pembinaan', tipe: 'teks', ddl: 'VARCHAR(60)' },
  { csv: 27, col: 'StatusBadanHukum2025', tipe: 'teks', ddl: 'VARCHAR(60)' },
  { csv: 28, col: 'StatusBadanHukum2024', tipe: 'teks', ddl: 'VARCHAR(60)' },
  { csv: 29, col: 'StatusBadanHukum2023', tipe: 'teks', ddl: 'VARCHAR(60)' },
  { csv: 30, col: 'StatusBadanHukum2022', tipe: 'teks', ddl: 'VARCHAR(60)' },

  // ---------- Pengurus ----------
  { csv: 31, col: 'NamaPenasihat', tipe: 'teks', ddl: null },
  { csv: 32, col: 'JenisKelaminPenasihat', tipe: 'teks', ddl: null },
  { csv: 33, col: 'HPPenasihat', tipe: 'teks', ddl: null },
  { csv: 34, col: 'NamaPengawas', tipe: 'teks', ddl: null },
  { csv: 35, col: 'JenisKelaminPengawas', tipe: 'teks', ddl: null },
  { csv: 36, col: 'HPPengawas', tipe: 'teks', ddl: null },
  { csv: 37, col: 'NamaDirektur', tipe: 'teks', ddl: null },
  { csv: 38, col: 'JenisKelaminDirektur', tipe: 'teks', ddl: null },
  { csv: 39, col: 'HPDirektur', tipe: 'teks', ddl: null },
  { csv: 40, col: 'NamaSekretaris', tipe: 'teks', ddl: null },
  { csv: 41, col: 'JenisKelaminSekretaris', tipe: 'teks', ddl: null },
  { csv: 42, col: 'HPSekretaris', tipe: 'teks', ddl: null },
  { csv: 43, col: 'NamaBendahara', tipe: 'teks', ddl: null },
  { csv: 44, col: 'JenisKelaminBendahara', tipe: 'teks', ddl: null },
  { csv: 45, col: 'HPBendahara', tipe: 'teks', ddl: null },
  { csv: 46, col: 'NamaStafLainnya', tipe: 'teks', ddl: 'VARCHAR(255)' },
  { csv: 47, col: 'JenisKelaminStafLainnya', tipe: 'teks', ddl: 'VARCHAR(20)' },
  { csv: 48, col: 'HPStafLainnya', tipe: 'teks', ddl: 'VARCHAR(50)' },

  // ---------- Profil organisasi ----------
  { csv: 49, col: 'TahunPendirian', tipe: 'teks', ddl: null },
  { csv: 50, col: 'AlamatBumdesa', tipe: 'teks', ddl: null },
  { csv: 51, col: 'Alamatemail', tipe: 'teks', ddl: null },
  { csv: 52, col: 'TotalTenagaKerja', tipe: 'bulat', ddl: null },

  // ---------- Usaha ----------
  // CSV "KATEGORI USAHA" sepadan dengan isi kolom JenisUsaha yang sekarang
  // (kategori), bukan "JENIS USAHA 2021" yang berisi usaha spesifik.
  { csv: 54, col: 'JenisUsaha', tipe: 'teks', ddl: null },
  { csv: 55, col: 'JenisUsahaUtama', tipe: 'teks', ddl: null },
  { csv: 56, col: 'JenisUsahaLainnya', tipe: 'teks', ddl: null },
  { csv: 53, col: 'JenisUsaha2021', tipe: 'teks', ddl: 'TEXT' },
  { csv: 57, col: 'JenisUsahaKetahananPangan', tipe: 'teks', ddl: 'TEXT' },
  { csv: 58, col: 'KeteranganUsahaKetahananPangan', tipe: 'teks', ddl: 'TEXT' },
  { csv: 59, col: 'VolumeKetahananPangan', tipe: 'teks', ddl: 'TEXT' },
  { csv: 60, col: 'AnggaranModalKetahananPangan', tipe: 'uang', ddl: 'DECIMAL(15,2)' },

  // ---------- Keuangan ----------
  { csv: 61, col: 'Omset2023', tipe: 'uang', ddl: null },
  { csv: 62, col: 'Laba2023', tipe: 'uang', ddl: null },
  { csv: 65, col: 'Omset2024', tipe: 'uang', ddl: null },
  { csv: 66, col: 'Laba2024', tipe: 'uang', ddl: null },
  { csv: 63, col: 'Omset2024Sem1', tipe: 'uang', ddl: 'DECIMAL(15,2)' },
  { csv: 64, col: 'Laba2024Sem1', tipe: 'uang', ddl: 'DECIMAL(15,2)' },
  { csv: 67, col: 'Omset2025', tipe: 'uang', ddl: 'DECIMAL(15,2)' },
  { csv: 68, col: 'Laba2025', tipe: 'uang', ddl: 'DECIMAL(15,2)' },
  { csv: 69, col: 'PenyertaanModal2019', tipe: 'uang', ddl: null },
  { csv: 70, col: 'PenyertaanModal2020', tipe: 'uang', ddl: null },
  { csv: 71, col: 'PenyertaanModal2021', tipe: 'uang', ddl: null },
  { csv: 72, col: 'PenyertaanModal2022', tipe: 'uang', ddl: null },
  { csv: 73, col: 'PenyertaanModal2023', tipe: 'uang', ddl: null },
  { csv: 74, col: 'PenyertaanModal2024', tipe: 'uang', ddl: null },
  { csv: 75, col: 'PenganggaranPenyertaanModal2025', tipe: 'uang', ddl: 'DECIMAL(15,2)' },
  { csv: 76, col: 'PenyertaanModalTPKK', tipe: 'uang', ddl: 'DECIMAL(15,2)' },
  { csv: 77, col: 'TotalRealisasiPenyertaanModal20192025', tipe: 'uang', ddl: 'DECIMAL(15,2)' },
  { csv: 78, col: 'JumlahModalAwal', tipe: 'uang', ddl: 'DECIMAL(15,2)' },
  { csv: 79, col: 'JenisAset', tipe: 'teks', ddl: null },
  { csv: 80, col: 'NilaiAset', tipe: 'uang', ddl: null },

  // ---------- Kontribusi PADes ----------
  { csv: 81, col: 'KontribusiTerhadapPADes2021', tipe: 'uang', ddl: null },
  { csv: 82, col: 'KontribusiTerhadapPADes2022', tipe: 'uang', ddl: null },
  { csv: 83, col: 'KontribusiTerhadapPADes2023', tipe: 'uang', ddl: null },
  { csv: 84, col: 'KontribusiTerhadapPADes2024', tipe: 'uang', ddl: null },
  { csv: 85, col: 'KontribusiTerhadapPADes2025', tipe: 'uang', ddl: 'DECIMAL(15,2)' },

  // ---------- Kemitraan ----------
  { csv: 86, col: 'KerjasamaPihakKetiga', tipe: 'teks', ddl: null },
  { csv: 87, col: 'TahunMulai-TahunBerakhir', tipe: 'teks', ddl: null },
  { csv: 88, col: 'KontribusiKemitraanPADes2024', tipe: 'uang', ddl: 'DECIMAL(15,2)' },
  { csv: 89, col: 'KontribusiKemitraanPADes2025', tipe: 'uang', ddl: 'DECIMAL(15,2)' },

  // ---------- Peran dalam program pemerintah ----------
  { csv: 90, col: 'Ketapang2024', tipe: 'teks', ddl: null },
  { csv: 91, col: 'Ketapang2025', tipe: 'teks', ddl: null },
  // CSV kolom 92 (peran desa wisata) KOSONG seluruhnya, sedangkan kolom
  // DesaWisata di produksi terisi 65 baris -> kolom itu tidak diimpor.
  // Kolom 93 (Ya/Tidak) ditaruh terpisah supaya hitungan desa wisata di Prolap
  // tidak berubah arti.
  { csv: 93, col: 'DesaWisataStatus', tipe: 'teks', ddl: 'VARCHAR(20)' },
  { csv: 94, col: 'PeranMBG', tipe: 'teks', ddl: 'TEXT' },
  { csv: 95, col: 'MekanismeKerjaSamaMBG', tipe: 'teks', ddl: 'TEXT' },
  { csv: 96, col: 'JumlahSPPG', tipe: 'bulat', ddl: 'INT' },
  { csv: 97, col: 'TahunKerjaSamaMBG', tipe: 'teks', ddl: 'VARCHAR(20)' },

  // ---------- Bantuan ----------
  { csv: 98, col: 'BantuanLaptopShopee', tipe: 'teks', ddl: null },
  { csv: 99, col: 'BantuanKementrian', tipe: 'teks', ddl: null },
  { csv: 100, col: 'BantuanLainnya', tipe: 'teks', ddl: 'TEXT' },

  // ---------- Dokumen ----------
  // Hanya nomor perdes yang diimpor. Kolom ceklis dokumen di CSV (Laporan
  // Keuangan 2021-2025, Perdes, Profil, Berita Acara, AD, ART, PROKER, SK =
  // kolom CSV 101-105 dan 107-113) SENGAJA TIDAK DIIMPOR: isinya cuma penanda
  // "v", sementara berkas sesungguhnya akan diunggah manual lewat akun pegawai
  // SPKED. Kolom path file di database juga tidak pernah disentuh importer
  // (lihat KOLOM_DIPERTAHANKAN).
  { csv: 106, col: 'NomorPerdes', tipe: 'teks', ddl: null },

  // ---------- Pelatihan & pembinaan ----------
  { csv: 114, col: 'Pelatihan2022', tipe: 'teks', ddl: 'TEXT' },
  { csv: 115, col: 'Pelatihan2023', tipe: 'teks', ddl: 'TEXT' },
  { csv: 116, col: 'PelatihanBUMDesa2024', tipe: 'teks', ddl: 'TEXT' },
  { csv: 117, col: 'PelatihanPenasehatPengawas2024', tipe: 'teks', ddl: 'TEXT' },
  { csv: 118, col: 'Pelatihan2025Pertama', tipe: 'teks', ddl: 'TEXT' },
  { csv: 119, col: 'PelatihanBusinessPlanUI2023', tipe: 'teks', ddl: 'TEXT' },
  { csv: 120, col: 'SABISA', tipe: 'teks', ddl: 'TEXT' },
  { csv: 121, col: 'FGDUI2024', tipe: 'teks', ddl: 'TEXT' },
  { csv: 122, col: 'FGDBRIN2024', tipe: 'teks', ddl: 'TEXT' },
  { csv: 123, col: 'ToTSTAN', tipe: 'teks', ddl: 'TEXT' },
  { csv: 124, col: 'SosialisasiELearningUI', tipe: 'teks', ddl: 'TEXT' },
  { csv: 125, col: 'PesertaPelatihanBalaiBesarKemendesa', tipe: 'teks', ddl: 'TEXT' },
  { csv: 126, col: 'Pembinaan2022', tipe: 'teks', ddl: 'TEXT' },
  { csv: 127, col: 'Pembinaan2023', tipe: 'teks', ddl: 'TEXT' },
  { csv: 128, col: 'Pembinaan2024', tipe: 'teks', ddl: 'TEXT' },
  { csv: 129, col: 'ProgressHasilPembinaan2024', tipe: 'teks', ddl: 'TEXT' },

  // ---------- Desk pendataan ----------
  { csv: 130, col: 'DeskPendataan2025', tipe: 'teks', ddl: 'VARCHAR(20)' },
  { csv: 131, col: 'KehadiranDesk2026', tipe: 'teks', ddl: 'VARCHAR(20)' },

  // ---------- Permasalahan ----------
  { csv: 132, col: 'PermintaanDataKPK', tipe: 'teks', ddl: 'TEXT' },
  { csv: 133, col: 'MasalahPendirianPenyertaanModal', tipe: 'teks', ddl: 'TEXT' },
  { csv: 134, col: 'TahunPenyertaanModalBermasalah', tipe: 'teks', ddl: 'TEXT' },
  { csv: 135, col: 'SuratKonfirmasi', tipe: 'teks', ddl: 'TEXT' },
  { csv: 136, col: 'BerkasSurat', tipe: 'teks', ddl: 'TEXT' },
  { csv: 137, col: 'PermasalahanLainnya', tipe: 'teks', ddl: 'TEXT' },

  // ---------- Tambahan ----------
  { csv: 138, col: 'ECommerce', tipe: 'teks', ddl: 'TEXT' },
  { csv: 139, col: 'LinkSK', tipe: 'teks', ddl: 'TEXT' },
  { csv: 140, col: 'LinkLapKeuangan2021', tipe: 'teks', ddl: 'TEXT' },
  { csv: 141, col: 'LinkSKKepengurusan2021', tipe: 'teks', ddl: 'TEXT' },
  { csv: 142, col: 'CatatanTambahan', tipe: 'teks', ddl: 'TEXT' },
];

// Kolom yang TIDAK BOLEH disentuh importer: berisi path file unggahan atau
// relasi produk hukum yang tidak ada padanannya di CSV. Menimpanya berarti
// memutus dokumen yang sudah diunggah desa.
const KOLOM_DIPERTAHANKAN = [
  'LaporanKeuangan2021', 'LaporanKeuangan2022', 'LaporanKeuangan2023', 'LaporanKeuangan2024',
  'Perdes', 'ProfilBUMDesa', 'BeritaAcara', 'AnggaranDasar', 'AnggaranRumahTangga',
  'ProgramKerja', 'SK_BUM_Desa',
  'produk_hukum_perdes_id', 'produk_hukum_sk_bumdes_id',
  'DesaWisata', 'SumberLain', 'TelfonBumdes',
];

// Kosakata status badan hukum di CSV -> kosakata yang dibaca dashboard
// (BumdesDashboardModern + bumdes.controller getStatistics).
const PETA_BADAN_HUKUM = {
  'dokumen badan hukum terverifikasi': 'Terbit Sertifikat Badan Hukum',
  'perbaikan dokumen badan hukum': 'Perbaikan Dokumen',
  'nama terverifikasi': 'Nama Terverifikasi',
};
const BADAN_HUKUM_KOSONG = 'Belum Melakukan Proses';

module.exports = { PETA, KOLOM_DIPERTAHANKAN, PETA_BADAN_HUKUM, BADAN_HUKUM_KOSONG };
