/**
 * Kosakata Kerja Sama Desa.
 *
 * Jenis, bidang, dan dokumen wajibnya ditulis SEKALI di sini lalu dipakai
 * controller, validasi, dan dikirim ke frontend lewat endpoint meta. Tanpa itu
 * daftar yang sama akan hidup di tiga tempat — form desa, penyaring dashboard
 * SPKED, dan pemeriksaan server — dan tiga-tiganya pasti menyimpang begitu ada
 * bidang baru.
 *
 * Nilai `key` sama persis dengan enum di basis data (lihat migrasi
 * 20260922_create_kerjasama_desa.sql). Label boleh berubah kapan saja; key
 * tidak, karena ia sudah tertulis di baris-baris yang tersimpan.
 */

/**
 * Empat bidang kerja sama. Urutannya bukan selera: ini urutan baku yang dipakai
 * dokumen perencanaan desa, jadi nomor 1–4 ikut disimpan untuk penomoran di
 * layar.
 */
const BIDANG_KERJASAMA = [
  { key: 'penyelenggaraan_pemerintahan', nomor: 1, label: 'Penyelenggaraan Pemerintahan' },
  { key: 'pelaksanaan_pembangunan', nomor: 2, label: 'Pelaksanaan Pembangunan' },
  { key: 'pembinaan_kemasyarakatan', nomor: 3, label: 'Pembinaan Kemasyarakatan' },
  { key: 'pemberdayaan_masyarakat', nomor: 4, label: 'Pemberdayaan Masyarakat' },
];

/**
 * Dua jenis kerja sama, dengan dokumen yang berbeda — dan perbedaannya bukan
 * pilihan tampilan, melainkan syarat yang berbeda menurut aturannya:
 *
 *   KAD  (antar desa)    → Peraturan Bersama Kepala Desa + SK Badan Kerja Sama
 *   KDPK (pihak ketiga)  → Perjanjian Kerja Sama / MoU
 *
 * `wajib` menandai dokumen yang membuat satu entri terhitung lengkap. Dipakai
 * dashboard SPKED untuk menghitung kelengkapan berkas, bukan untuk menolak
 * penyimpanan — desa sering mengisi datanya lebih dulu dan menyusul berkasnya.
 */
const JENIS_KERJASAMA = [
  {
    key: 'antar_desa',
    kode: 'KAD',
    label: 'Antar Desa',
    keterangan: 'Kerja sama antardesa',
    dokumen: [
      { field: 'file_permakades', label: 'Peraturan Bersama Kepala Desa', singkat: 'Permakades', wajib: true },
      { field: 'file_sk_bkd', label: 'SK Badan Kerja Sama Desa', singkat: 'SK BKD', wajib: true },
    ],
  },
  {
    key: 'pihak_ketiga',
    kode: 'KDPK',
    label: 'Pihak Ketiga',
    keterangan: 'Kerja sama desa dengan pihak ketiga',
    dokumen: [{ field: 'file_pks_mou', label: 'Perjanjian Kerja Sama / MoU', singkat: 'PKS / MoU', wajib: true }],
  },
];

/** Seluruh kolom berkas yang dikenal, apa pun jenisnya. */
const SEMUA_FIELD_DOKUMEN = JENIS_KERJASAMA.flatMap((j) => j.dokumen.map((d) => d.field));

/**
 * Perdes payung kerja sama, saat didaftarkan ke modul Produk Hukum Desa.
 *
 * Bentuknya sengaja sama dengan PADANAN di sinkronProdukHukumBumdes.service.js:
 * dokumen yang lahir dari modul mana pun harus tampil sebagai jenis produk
 * hukum yang sama, bukan sebagai golongan tersendiri milik tiap modul.
 */
const PADANAN_PERDES_KERJASAMA = {
  jenis: 'Peraturan_Desa',
  singkatan_jenis: 'PERDES',
  subjek: 'Kerja Sama Desa',
  judul: () => 'Peraturan Desa tentang Kerja Sama Desa',
};

const BIDANG_KEYS = BIDANG_KERJASAMA.map((b) => b.key);
const JENIS_KEYS = JENIS_KERJASAMA.map((j) => j.key);

const cariBidang = (key) => BIDANG_KERJASAMA.find((b) => b.key === key) || null;
const cariJenis = (key) => JENIS_KERJASAMA.find((j) => j.key === key) || null;

/** Dokumen yang relevan untuk satu jenis. Jenis tak dikenal → daftar kosong. */
const dokumenUntukJenis = (jenisKey) => cariJenis(jenisKey)?.dokumen || [];

/**
 * Apakah berkas wajib satu entri sudah lengkap?
 * Entri berjenis tak dikenal dianggap belum lengkap, bukan dilewati diam-diam.
 */
const dokumenLengkap = (entri) => {
  const wajib = dokumenUntukJenis(entri?.jenis).filter((d) => d.wajib);
  if (wajib.length === 0) return false;
  return wajib.every((d) => Boolean(entri?.[d.field]));
};

/** Katalog untuk frontend — satu sumber, dikirim lewat endpoint meta. */
const katalog = () => ({
  bidang: BIDANG_KERJASAMA,
  jenis: JENIS_KERJASAMA,
});

module.exports = {
  BIDANG_KERJASAMA,
  JENIS_KERJASAMA,
  BIDANG_KEYS,
  JENIS_KEYS,
  SEMUA_FIELD_DOKUMEN,
  PADANAN_PERDES_KERJASAMA,
  cariBidang,
  cariJenis,
  dokumenUntukJenis,
  dokumenLengkap,
  katalog,
};
