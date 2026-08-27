// Daftar kolom BUMDes yang boleh ditulis lewat API, dipisah menurut siapa
// pemilik datanya.
//
// Sebelumnya controller memakai DAFTAR-BUANG (blacklist): apa pun yang tidak
// disebut ikut diteruskan ke Prisma. Akibatnya tiga field form desa
// (`Omzet2023`, `Omzet2024`, `LaporanKeuangan`) lolos sebagai argumen yang
// tidak dikenal Prisma dan membuat pembuatan BUMDes baru dari halaman desa
// selalu gagal. Sejak sekarang dipakai DAFTAR-IZIN (whitelist): field yang
// tidak terdaftar diabaikan, bukan diteruskan.
//
// Kolom path berkas (Perdes, AnggaranDasar, LaporanKeuangan2021, ...) SENGAJA
// tidak ada di sini. Berkas hanya boleh berubah lewat POST /upload-file dan
// DELETE /delete-file, supaya path tidak bisa ditimpa nilai sembarangan.

/** Data operasional yang dimiliki dan diisi desa sendiri. */
const KOLOM_DESA = [
  // Identitas
  'namabumdesa', 'TahunPendirian', 'AlamatBumdesa', 'Alamatemail', 'TelfonBumdes',
  'status', 'keterangan_tidak_aktif',

  // Legalitas
  'NIB', 'LKPP', 'NPWP', 'badanhukum',

  // Pengurus
  'NamaPenasihat', 'JenisKelaminPenasihat', 'HPPenasihat',
  'NamaPengawas', 'JenisKelaminPengawas', 'HPPengawas',
  'NamaDirektur', 'JenisKelaminDirektur', 'HPDirektur',
  'NamaSekretaris', 'JenisKelaminSekretaris', 'HPSekretaris',
  'NamaBendahara', 'JenisKelaminBendahara', 'HPBendahara',
  'NamaStafLainnya', 'JenisKelaminStafLainnya', 'HPStafLainnya',

  // Organisasi & usaha
  'TotalTenagaKerja',
  'JenisUsaha', 'JenisUsahaUtama', 'JenisUsahaLainnya', 'JenisUsaha2021',
  'JenisUsahaKetahananPangan', 'KeteranganUsahaKetahananPangan',
  'VolumeKetahananPangan', 'AnggaranModalKetahananPangan',

  // Keuangan
  'Omset2023', 'Laba2023',
  'Omset2024Sem1', 'Laba2024Sem1',
  'Omset2024', 'Laba2024',
  'Omset2025', 'Laba2025',
  'PenyertaanModal2019', 'PenyertaanModal2020', 'PenyertaanModal2021',
  'PenyertaanModal2022', 'PenyertaanModal2023', 'PenyertaanModal2024',
  'PenganggaranPenyertaanModal2025', 'PenyertaanModalTPKK',
  'TotalRealisasiPenyertaanModal20192025', 'JumlahModalAwal',
  'SumberLain', 'JenisAset', 'NilaiAset',

  // Kontribusi PADes
  'KontribusiTerhadapPADes2021', 'KontribusiTerhadapPADes2022',
  'KontribusiTerhadapPADes2023', 'KontribusiTerhadapPADes2024',
  'KontribusiTerhadapPADes2025',

  // Kemitraan
  'KerjasamaPihakKetiga', 'TahunMulai_TahunBerakhir',
  'KontribusiKemitraanPADes2024', 'KontribusiKemitraanPADes2025',

  // Peran dalam program pemerintah
  'Ketapang2024', 'Ketapang2025', 'DesaWisata', 'DesaWisataStatus',
  'PeranMBG', 'MekanismeKerjaSamaMBG', 'JumlahSPPG', 'TahunKerjaSamaMBG',

  // Bantuan
  'BantuanKementrian', 'BantuanLaptopShopee', 'BantuanLainnya',

  // Dokumen pendirian (nomor + relasi produk hukum, bukan path berkas)
  'NomorPerdes', 'produk_hukum_perdes_id', 'produk_hukum_sk_bumdes_id',

  // Tambahan
  'ECommerce', 'LinkSK', 'LinkLapKeuangan2021', 'LinkSKKepengurusan2021',
  'CatatanTambahan',
];

/**
 * Hasil penilaian dan pembinaan DPMD. Desa boleh MELIHAT (ikut terkirim saat
 * membaca data) tapi tidak boleh mengubah — nilainya ditetapkan bidang SPKED.
 */
const KOLOM_DPMD = [
  // Status versi penilaian tahun sebelumnya
  'Status2024', 'KeteranganTidakAktif2024',

  // Pemeringkatan
  'Pemeringkatan2022', 'NilaiPemeringkatan2022',
  'Pemeringkatan2023', 'NilaiPemeringkatan2023',
  'Pemeringkatan2024', 'KetPemeringkatan2024', 'Pemeringkatan2024Sem1',
  'PemeringkatanApp2023', 'EvaluasiRPJMN2024', 'PemeringkatanApp2024',
  'Pemeringkatan2026',

  // Riwayat status badan hukum
  'StatusBadanHukum2026', 'StatusBadanHukum2026Feb', 'StatusBadanHukum2025Pembinaan',
  'StatusBadanHukum2025', 'StatusBadanHukum2024', 'StatusBadanHukum2023',
  'StatusBadanHukum2022',

  // Pelatihan & pembinaan
  'Pelatihan2022', 'Pelatihan2023', 'PelatihanBUMDesa2024',
  'PelatihanPenasehatPengawas2024', 'Pelatihan2025Pertama',
  'PelatihanBusinessPlanUI2023', 'SABISA', 'FGDUI2024', 'FGDBRIN2024',
  'ToTSTAN', 'SosialisasiELearningUI', 'PesertaPelatihanBalaiBesarKemendesa',
  'Pembinaan2022', 'Pembinaan2023', 'Pembinaan2024', 'ProgressHasilPembinaan2024',

  // Desk pendataan
  'DeskPendataan2025', 'KehadiranDesk2026',

  // Permasalahan
  'PermintaanDataKPK', 'MasalahPendirianPenyertaanModal',
  'TahunPenyertaanModalBermasalah', 'SuratKonfirmasi', 'BerkasSurat',
  'PermasalahanLainnya',
];

/** Identitas desa — ditetapkan sistem dari tabel `desas`, bukan dari input. */
const KOLOM_IDENTITAS = ['desa_id', 'kode_desa', 'kecamatan', 'desa'];

/** Kolom yang boleh ditulis pegawai SPKED / dinas / superadmin. */
const KOLOM_ADMIN = [...KOLOM_DESA, ...KOLOM_DPMD];

const KOLOM_ANGKA_DESIMAL = [
  'Omset2023', 'Laba2023', 'Omset2024', 'Laba2024',
  'Omset2024Sem1', 'Laba2024Sem1', 'Omset2025', 'Laba2025',
  'PenyertaanModal2019', 'PenyertaanModal2020', 'PenyertaanModal2021',
  'PenyertaanModal2022', 'PenyertaanModal2023', 'PenyertaanModal2024',
  'PenganggaranPenyertaanModal2025', 'PenyertaanModalTPKK',
  'TotalRealisasiPenyertaanModal20192025', 'JumlahModalAwal',
  'SumberLain', 'NilaiAset', 'AnggaranModalKetahananPangan',
  'KontribusiTerhadapPADes2021', 'KontribusiTerhadapPADes2022',
  'KontribusiTerhadapPADes2023', 'KontribusiTerhadapPADes2024',
  'KontribusiTerhadapPADes2025',
  'KontribusiKemitraanPADes2024', 'KontribusiKemitraanPADes2025',
];

const KOLOM_ANGKA_BULAT = ['TotalTenagaKerja', 'JumlahSPPG'];

/**
 * Ejaan lama dari form yang belum diperbarui -> nama kolom sebenarnya.
 * `Omzet*` (z) dipetakan ke `Omset*` (s): kolom di basis data memakai "s",
 * sementara form lama memakai "z", sehingga omzet yang diisi desa tidak
 * pernah tersimpan.
 */
const ALIAS_FIELD = {
  AlamatBumdes: 'AlamatBumdesa',
  NoHpBumdes: 'TelfonBumdes',
  EmailBumdes: 'Alamatemail',
  NoPerdes: 'NomorPerdes',
  // Kolom basis datanya bernama 'TahunMulai-TahunBerakhir' (bertanda hubung),
  // tapi Prisma menamainya dengan garis bawah lewat @map. Daftar lama memakai
  // bentuk bertanda hubung, sehingga Prisma menolaknya sebagai argumen tak
  // dikenal dan field ini tidak pernah bisa tersimpan.
  'TahunMulai-TahunBerakhir': 'TahunMulai_TahunBerakhir',
  Omzet2023: 'Omset2023',
  Omzet2024: 'Omset2024',
  Omzet2025: 'Omset2025',
};

/**
 * Enum `status` di Prisma bernama `tidak_aktif` (dipetakan ke nilai basis data
 * 'tidak aktif'). Form mengirim 'tidak aktif' apa adanya, dan Prisma menolak
 * nilai itu — sehingga BUMDes tidak pernah bisa disetel Tidak Aktif lewat
 * aplikasi. Di sini kedua ejaan diterima lalu diseragamkan.
 */
const normalisasiStatus = (nilai) => {
  const v = String(nilai ?? '').trim().toLowerCase().replace(/[\s-]+/g, '_');
  if (v === 'aktif') return 'aktif';
  if (v === 'tidak_aktif') return 'tidak_aktif';
  return null;
};

/** Sufiks singkatan yang lazim dipakai penulis data. */
const SUFIKS = {
  rb: 1e3, ribu: 1e3,
  jt: 1e6, juta: 1e6,
  miliar: 1e9, milyar: 1e9, m: 1e9,
};

/** Batas atas kolom DECIMAL(15,2) di MySQL. */
const BATAS_DECIMAL_15_2 = 9999999999999.99;

/**
 * Baca angka dari input yang mungkin berformat rupiah atau ditulis bebas.
 *
 * Yang DISERAGAMKAN (murni beda penulisan, maknanya tidak berubah):
 *   "Rp 286,877,726"  "Rp.299.500.000;"  "150,000,000"  "1.000 000"
 *   "50 juta" -> 50000000          (sufiks rb/ribu/jt/juta/miliar)
 *   "100000000 (Tahun 2020)"       (keterangan dalam kurung di belakang dibuang)
 *   "0. ( perawatan )" -> 0
 *   "(50.000)" -> -50000           (kurung membungkus seluruhnya = negatif)
 *   "Tidak ada penyertaan modal dari desa" -> kosong
 *
 * Yang SENGAJA DITOLAK, karena menebaknya berarti mengarang angka:
 *   "2.000.000/bulan", "2 Jt Perbulan" -> nilai per BULAN pada kolom TAHUNAN.
 *      Dipakai apa adanya salah 12x; dikali 12 mengarang yang tak pernah ditulis.
 *   "10 unit kios" -> bukan nilai uang sama sekali.
 *   "Modal awal : 170jt, dari Dana Desa ..." -> angka terselip di kalimat;
 *      mengambilnya berarti menebak angka mana yang dimaksud.
 *   Nilai di luar jangkauan DECIMAL(15,2), mis. salah ketik Rp 16.270 triliun.
 *
 * Mengembalikan { ok, nilai }. `ok:false` berarti pemanggil harus MELEWATI
 * field itu, supaya nilai lama tidak tertimpa null gara-gara salah ketik.
 *
 * `desimalDiizinkan` dibedakan: lewat form, "1500000.50" wajar sebagai desimal;
 * saat impor CSV, dua kelompok seperti "171.35" ambigu (171,35 atau 171 juta?)
 * sehingga lebih baik ditolak dan dilaporkan.
 */
const bacaAngka = (mentah, opsi = {}) => {
  const { bulat = false, desimalDiizinkan = true, batas = BATAS_DECIMAL_15_2 } = opsi;

  let s = String(mentah ?? '').trim();
  if (s === '') return { ok: true, nilai: null };

  // Kalimat yang artinya "tidak ada" -> kosong, bukan anomali.
  if (/^(tidak ada|belum ada|tidak tersedia|nol|kosong)\b/i.test(s)) {
    return { ok: true, nilai: null };
  }

  s = s.replace(/^rp\.?,?/i, '').trim();

  // Kurung yang membungkus SELURUH nilai = format akuntansi untuk negatif.
  let negatif = false;
  if (/^\(.*\)$/.test(s)) { negatif = true; s = s.slice(1, -1).trim(); }

  // Kurung di BELAKANG angka = keterangan, bukan bagian nilainya.
  const tanpaKeterangan = s.replace(/\s*\([^)]*\)\s*$/, '').trim();
  if (tanpaKeterangan !== '') s = tanpaKeterangan;

  s = s.replace(/[;.,]+$/, '').trim();
  if (s === '' || s === '-') return { ok: true, nilai: null };

  // Sufiks singkatan. Harus menutup string; "2 Jt Perbulan" sengaja tidak cocok.
  let pengali = 1;
  const sufiks = s.match(/^([\d.,\s]+?)\s*(rb|ribu|jt|juta|miliar|milyar|m)$/i);
  if (sufiks) { pengali = SUFIKS[sufiks[2].toLowerCase()]; s = sufiks[1].trim(); }

  if (s.startsWith('-')) { negatif = true; s = s.slice(1).trim(); }
  if (!/^\d([\d.,\s]*\d)?$/.test(s)) return { ok: false, nilai: null };

  // Titik, koma, DAN spasi sama-sama dipakai orang sebagai pemisah ribuan.
  const grup = s.split(/[.,\s]+/).filter(Boolean);
  let angka;
  if (grup.length === 1) {
    angka = Number(grup[0]);
  } else if (grup.slice(1).every((g) => g.length === 3)) {
    angka = Number(grup.join(''));
    // Saat ada sufiks ("1,5 juta"), pecahan desimal tidak ambigu: tidak ada
    // yang menulis "1,5 juta" untuk maksud 1.500 juta. Jadi aturan tolak-
    // desimal saat impor CSV sengaja tidak berlaku di sini.
  } else if ((desimalDiizinkan || pengali > 1) && grup.length === 2 && grup[1].length <= 2) {
    angka = Number(`${grup[0]}.${grup[1]}`);
  } else {
    return { ok: false, nilai: null };
  }

  if (!Number.isFinite(angka)) return { ok: false, nilai: null };
  angka *= pengali;
  if (negatif) angka = -angka;
  if (Math.abs(angka) > batas) return { ok: false, nilai: null };
  return { ok: true, nilai: bulat ? Math.trunc(angka) : angka };
};

/**
 * Saring dan rapikan payload menjadi objek yang aman dikirim ke Prisma.
 * Field yang tidak terdaftar diabaikan, bukan diteruskan.
 */
const siapkanData = (body, kolomDiizinkan) => {
  const izin = new Set(kolomDiizinkan);
  const sumber = {};

  // Terapkan alias dulu, supaya form lama tetap bisa menyimpan.
  for (const [kunci, nilai] of Object.entries(body || {})) {
    const nama = ALIAS_FIELD[kunci] || kunci;
    if (!izin.has(nama)) continue;
    if (sumber[nama] === undefined || sumber[nama] === null || sumber[nama] === '') {
      sumber[nama] = nilai;
    }
  }

  const data = {};
  for (const [nama, mentah] of Object.entries(sumber)) {
    let nilai = mentah;

    if (typeof nilai === 'string') nilai = nilai.trim();
    if (nilai === '' || nilai === undefined) nilai = null;

    if (nama === 'status') {
      const status = normalisasiStatus(nilai);
      if (status) data.status = status;
      continue;
    }

    const desimal = KOLOM_ANGKA_DESIMAL.includes(nama);
    const bulat = KOLOM_ANGKA_BULAT.includes(nama);
    if (nilai !== null && (desimal || bulat)) {
      const hasil = bacaAngka(nilai, { bulat });
      // Angka yang tidak terbaca: field dilewati sama sekali, supaya nilai lama
      // tetap utuh alih-alih terhapus karena salah ketik.
      if (!hasil.ok) continue;
      nilai = hasil.nilai;
    }

    data[nama] = nilai;
  }

  return data;
};

module.exports = {
  bacaAngka,
  BATAS_DECIMAL_15_2,
  KOLOM_DESA,
  KOLOM_DPMD,
  KOLOM_ADMIN,
  KOLOM_IDENTITAS,
  KOLOM_ANGKA_DESIMAL,
  KOLOM_ANGKA_BULAT,
  ALIAS_FIELD,
  normalisasiStatus,
  siapkanData,
};
