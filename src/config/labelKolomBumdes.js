// Judul kolom ekspor BUM Desa yang SAMA dengan label formulir pengisian.
//
// Pengguna mencari "Keterangan Jenis Usaha Utama" (label di formulir) di
// berkas ekspor, sementara kolomnya bernama `JenisUsahaUtama` — lalu
// menyimpulkan datanya tidak ada. Label di sini disalin dari
// dpmd-frontend/src/components/bumdes/skemaBumdes.js; ubah keduanya bersama.
//
// Kolom yang tidak punya isian di formulir (impor rekap lama, catatan SPKED)
// diberi label yang bisa dibaca, dan kolom lama yang konsepnya sudah
// digantikan isian baru ditandai "(impor lama)" supaya tidak tertukar.

const PENGURUS = [
  ['Penasihat', 'Penasihat'],
  ['Pengawas', 'Pengawas'],
  ['Direktur', 'Direktur'],
  ['Sekretaris', 'Sekretaris'],
  ['Bendahara', 'Bendahara'],
  ['StafLainnya', 'Staf Lainnya'],
];

const LABEL_KOLOM = {
  // ── Identitas BUM Desa ──
  id: 'ID BUM Desa',
  namabumdesa: 'Nama BUM Desa',
  desa: 'Nama Desa',
  desa_id: 'ID Desa',
  kecamatan: 'Kecamatan',
  kode_desa: 'Kode Desa',
  TahunPendirian: 'Tahun Pendirian BUM Desa',
  status: 'Status Keaktifan BUM Desa',
  keterangan_tidak_aktif: 'Alasan Tidak Aktif',
  TelfonBumdes: 'Nomor Telepon BUM Desa',
  Alamatemail: 'Email BUM Desa',
  AlamatBumdesa: 'Alamat Kantor BUM Desa',

  // ── Dasar hukum & legalitas ──
  NomorPerdes: 'Nomor Perdes Pendirian',
  LKPP: 'Nomor LKPP',
  NIB: 'Nomor NIB',
  NPWP: 'Nomor NPWP',
  badanhukum: 'Status Badan Hukum',
  Perdes: 'Perdes Pendirian',
  ProfilBUMDesa: 'Profil BUM Desa',
  BeritaAcara: 'Berita Acara',
  AnggaranDasar: 'Anggaran Dasar (AD)',
  AnggaranRumahTangga: 'Anggaran Rumah Tangga (ART)',
  ProgramKerja: 'Program Kerja',
  SK_BUM_Desa: 'SK Pendirian BUM Desa',
  produk_hukum_perdes_id: 'ID Produk Hukum Perdes',
  produk_hukum_sk_bumdes_id: 'ID Produk Hukum SK BUM Desa',

  // ── Kepengurusan: "Nama Direktur", "Nomor HP Direktur", ... ──
  ...Object.fromEntries(PENGURUS.flatMap(([k, jabatan]) => [
    [`Nama${k}`, `Nama ${jabatan}`],
    [`HP${k}`, `Nomor HP ${jabatan}`],
    [`JenisKelamin${k}`, `Jenis Kelamin ${jabatan}`],
  ])),

  // ── Tenaga kerja & bidang usaha ──
  TotalTenagaKerja: 'Jumlah Tenaga Kerja',
  KategoriUsaha: 'Kategori Usaha Utama',
  JenisUsahaUtama: 'Keterangan Jenis Usaha Utama',
  KategoriUsahaPangan: 'Kategori Usaha Ketahanan Pangan',
  KeteranganUsahaKetahananPangan: 'Keterangan Jenis Usaha Ketahanan Pangan',
  UnitUsaha: 'Unit Usaha BUM Desa',
  JenisUsaha: 'Kategori Usaha Utama (impor lama)',
  JenisUsahaKetahananPangan: 'Kategori Usaha Ketahanan Pangan (impor lama)',
  JenisUsahaLainnya: 'Unit Usaha (impor lama)',
  JenisUsaha2021: 'Jenis Usaha 2021',

  // ── Permodalan, aset, omset (isian bertahun di lembar sendiri) ──
  RiwayatPermodalan: 'Penyertaan Modal',
  RiwayatAset: 'Nilai & Jenis Aset',
  RiwayatOmsetLaba: 'Omset & Laba per Tahun',
  RiwayatKontribusiPADes: 'Kontribusi PADes per Tahun',
  RiwayatKemitraan: 'Kerja Sama dengan Pihak Ketiga',
  PeranProgram: 'Program & Peran BUM Desa',
  LaporanPertanggungjawaban: 'Laporan Pertanggungjawaban',
  DokumenKetahananPangan: 'Dokumen Ketahanan Pangan per Tahun',

  // ── Ketahanan pangan (berkas tanpa tahun) ──
  StudiKelayakanUsaha: 'Studi Kelayakan Usaha (tanpa tahun)',
  RABKetahananPangan: 'RAB (tanpa tahun)',
  DokumentasiGeotagging: 'Dokumentasi Geotagging (tanpa tahun)',

  // ── Laporan keuangan per tahun ──
  LaporanKeuangan2021: 'Laporan Pertanggungjawaban 2021',
  LaporanKeuangan2022: 'Laporan Pertanggungjawaban 2022',
  LaporanKeuangan2023: 'Laporan Pertanggungjawaban 2023',
  LaporanKeuangan2024: 'Laporan Pertanggungjawaban 2024',

  // ── Bantuan, media sosial, catatan ──
  BantuanKementrian: 'Bantuan Pengembangan Kemendesa',
  BantuanLaptopShopee: 'Bantuan Laptop Shopee',
  BantuanLainnya: 'Bantuan Lainnya',
  MediaSosial: 'Media Sosial & E-Commerce',
  ECommerce: 'E-Commerce (impor lama)',
  CatatanTambahan: 'Catatan Tambahan',

  // ── Pemeringkatan & status badan hukum ──
  Pemeringkatan2022: 'Pemeringkatan 2022',
  NilaiPemeringkatan2022: 'Nilai Pemeringkatan 2022',
  Pemeringkatan2023: 'Pemeringkatan 2023',
  NilaiPemeringkatan2023: 'Nilai Pemeringkatan 2023',
  PemeringkatanApp2023: 'Pemeringkatan Aplikasi 2023',
  Pemeringkatan2024: 'Pemeringkatan 2024',
  Pemeringkatan2024Sem1: 'Pemeringkatan 2024 (Semester 1)',
  KetPemeringkatan2024: 'Keterangan Pemeringkatan 2024',
  PemeringkatanApp2024: 'Pemeringkatan Aplikasi 2024',
  Pemeringkatan2026: 'Pemeringkatan 2026 (dari penilaian 2025)',
  EvaluasiRPJMN2024: 'Evaluasi RPJMN 2024',
  StatusBadanHukum2022: 'Status Badan Hukum 2022',
  StatusBadanHukum2023: 'Status Badan Hukum 2023',
  StatusBadanHukum2024: 'Status Badan Hukum 2024',
  StatusBadanHukum2025: 'Status Badan Hukum 2025',
  StatusBadanHukum2025Pembinaan: 'Status Badan Hukum 2025 (Pembinaan)',
  StatusBadanHukum2026: 'Status Badan Hukum 2026',
  StatusBadanHukum2026Feb: 'Status Badan Hukum 2026 (Februari)',
  Status2024: 'Status Keaktifan 2024',
  KeteranganTidakAktif2024: 'Alasan Tidak Aktif 2024',

  // ── Pembinaan, pelatihan & pendataan ──
  Pembinaan2022: 'Pembinaan 2022',
  Pembinaan2023: 'Pembinaan 2023',
  Pembinaan2024: 'Pembinaan 2024',
  ProgressHasilPembinaan2024: 'Progres Hasil Pembinaan 2024',
  DeskPendataan2025: 'Desk Pendataan 2025',
  KehadiranDesk2026: 'Kehadiran Desk 2026',
  Pelatihan2022: 'Pelatihan 2022',
  Pelatihan2023: 'Pelatihan 2023',
  PelatihanBUMDesa2024: 'Pelatihan BUM Desa 2024',
  PelatihanPenasehatPengawas2024: 'Pelatihan Penasihat & Pengawas 2024',
  Pelatihan2025Pertama: 'Pelatihan 2025 (Pertama)',
  PelatihanBusinessPlanUI2023: 'Pelatihan Business Plan UI 2023',
  SABISA: 'SABISA',
  FGDUI2024: 'FGD UI 2024',
  FGDBRIN2024: 'FGD BRIN 2024',
  ToTSTAN: 'ToT STAN',
  SosialisasiELearningUI: 'Sosialisasi E-Learning UI',
  PesertaPelatihanBalaiBesarKemendesa: 'Peserta Pelatihan Balai Besar Kemendesa',

  // ── Data lama (impor rekap) ──
  Omset2023: 'Omset 2023 (Rp)',
  Laba2023: 'Laba 2023 (Rp)',
  Omset2024: 'Omset 2024 (Rp)',
  Laba2024: 'Laba 2024 (Rp)',
  Omset2024Sem1: 'Omset 2024 Semester 1 (Rp)',
  Laba2024Sem1: 'Laba 2024 Semester 1 (Rp)',
  Omset2025: 'Omset 2025 (Rp)',
  Laba2025: 'Laba 2025 (Rp)',
  PenyertaanModal2019: 'Penyertaan Modal 2019 (Rp)',
  PenyertaanModal2020: 'Penyertaan Modal 2020 (Rp)',
  PenyertaanModal2021: 'Penyertaan Modal 2021 (Rp)',
  PenyertaanModal2022: 'Penyertaan Modal 2022 (Rp)',
  PenyertaanModal2023: 'Penyertaan Modal 2023 (Rp)',
  PenyertaanModal2024: 'Penyertaan Modal 2024 (Rp)',
  PenyertaanModalTPKK: 'Penyertaan Modal TPKK/Kelompok (Rp)',
  PenganggaranPenyertaanModal2025: 'Penganggaran Penyertaan Modal 2025 (Rp)',
  TotalRealisasiPenyertaanModal20192025: 'Total Realisasi 2019-2025 (Rp)',
  JumlahModalAwal: 'Jumlah Modal Awal (Rp)',
  SumberLain: 'Sumber Modal Lain (impor lama)',
  JenisAset: 'Jenis Aset (impor lama)',
  NilaiAset: 'Nilai Aset (Rp, impor lama)',
  KerjasamaPihakKetiga: 'Kerja Sama Pihak Ketiga (impor lama)',
  TahunMulai_TahunBerakhir: 'Tahun Mulai - Tahun Berakhir Kerja Sama',
  KontribusiTerhadapPADes2021: 'Kontribusi PADes 2021 (Rp)',
  KontribusiTerhadapPADes2022: 'Kontribusi PADes 2022 (Rp)',
  KontribusiTerhadapPADes2023: 'Kontribusi PADes 2023 (Rp)',
  KontribusiTerhadapPADes2024: 'Kontribusi PADes 2024 (Rp)',
  KontribusiTerhadapPADes2025: 'Kontribusi PADes 2025 (Rp)',
  KontribusiKemitraanPADes2024: 'Kontribusi Kemitraan ke PADes 2024 (Rp)',
  KontribusiKemitraanPADes2025: 'Kontribusi Kemitraan ke PADes 2025 (Rp)',
  VolumeKetahananPangan: 'Volume Ketahanan Pangan',
  AnggaranModalKetahananPangan: 'Anggaran Penyertaan Modal Ketahanan Pangan (Rp)',
  Ketapang2024: 'Peran Ketahanan Pangan 2024',
  Ketapang2025: 'Peran Ketahanan Pangan 2025',
  DesaWisata: 'Desa Wisata',
  DesaWisataStatus: 'Status Desa Wisata',
  PeranMBG: 'Peran dalam MBG',
  MekanismeKerjaSamaMBG: 'Mekanisme Kerja Sama MBG',
  JumlahSPPG: 'Jumlah SPPG',
  TahunKerjaSamaMBG: 'Tahun Kerja Sama MBG',
  LinkSK: 'Tautan SK',
  LinkLapKeuangan2021: 'Tautan Laporan Keuangan 2021',
  LinkSKKepengurusan2021: 'Tautan SK Kepengurusan 2021',

  // ── Catatan permasalahan (SPKED) ──
  PermintaanDataKPK: 'Permintaan Data KPK',
  MasalahPendirianPenyertaanModal: 'Masalah Pendirian & Penyertaan Modal',
  TahunPenyertaanModalBermasalah: 'Tahun Penyertaan Modal Bermasalah',
  SuratKonfirmasi: 'Surat Konfirmasi',
  BerkasSurat: 'Berkas Surat',
  PermasalahanLainnya: 'Permasalahan Lainnya',

  // ── Jejak sistem ──
  diisi_desa_at: 'Terakhir Diisi Desa',
  diisi_desa_oleh: 'Diisi Desa Oleh',
  created_at: 'Dibuat',
  updated_at: 'Terakhir Diperbarui',
};

/** Isian di dalam lembar daftar bertahun (label sama dengan formulir). */
const LABEL_ISIAN = {
  RiwayatPermodalan: { tahun: 'Tahun', sumber: 'Sumber Modal', keterangan: 'Asal Modal Lain', jumlah: 'Nilai Penyertaan Modal (Rp)' },
  RiwayatAset: { tahun: 'Tahun', nilai: 'Nilai Aset (Rp)', jenis: 'Jenis Aset' },
  RiwayatOmsetLaba: { tahun: 'Tahun', omset: 'Omset (Rp)', laba: 'Laba / Rugi (Rp)' },
  RiwayatKontribusiPADes: { tahun: 'Tahun', jumlah: 'Nilai Kontribusi (Rp)', bukti: 'Bukti Penyerahan PADes' },
  RiwayatKemitraan: { tahun: 'Tahun', mitra: 'Nama Mitra', periode: 'Jangka Waktu Kerja Sama', kontribusi: 'Kontribusi ke PADes (Rp)', mou: 'Dokumen MoU / Perjanjian' },
  PeranProgram: { program: 'Program', program_lain: 'Nama Program Lainnya', peran: 'Peran BUM Desa', produk: 'Produk yang Dipasok ke MBG', keterangan: 'Keterangan (opsional)' },
  LaporanPertanggungjawaban: { tahun: 'Tahun', berkas: 'Berkas Laporan' },
  DokumenKetahananPangan: { tahun: 'Tahun Kegiatan', studi_kelayakan: 'Studi Kelayakan Usaha', rab: 'RAB (Rencana Anggaran Biaya)', geotagging: 'Dokumentasi Geotagging', keterangan: 'Keterangan (opsional)' },
};

/** "KolomBaruXyz2026" -> "Kolom Baru Xyz 2026": cadangan untuk kolom yang belum dipetakan. */
const rapikanNama = (k) =>
  String(k)
    .replace(/_/g, ' ')
    .replace(/([a-z])([A-Z0-9])/g, '$1 $2')
    .replace(/([0-9])([A-Za-z])/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim();

const labelKolom = (k) => LABEL_KOLOM[k] || rapikanNama(k);
const labelIsian = (daftar, k) => LABEL_ISIAN[daftar]?.[k] || rapikanNama(k);

module.exports = { LABEL_KOLOM, LABEL_ISIAN, labelKolom, labelIsian };
