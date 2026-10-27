/**
 * Hak akses fitur halaman Kecamatan untuk akun OPERATOR kecamatan.
 *
 * Akun utama kecamatan (operator_kecamatan = 0) tidak memakai daftar ini: semua
 * fiturnya terbuka. Daftar ini hanya membatasi operator yang dibuat akun utama.
 *
 * Key HARUS sama persis dengan frontend `src/constants/kecamatanPermissions.js`.
 * Dashboard, Pengaturan, dan Ganti Password sengaja tidak masuk daftar: selalu
 * terbuka untuk semua akun kecamatan.
 */

const KECAMATAN_PERMISSIONS = [
  {
    key: 'bankeu',
    label: 'Bantuan Keuangan',
    description: 'Verifikasi proposal, berita acara, surat desa, dan tim verifikasi Bankeu.',
  },
  {
    key: 'bankeu-perubahan',
    label: 'Bankeu Perubahan',
    description: 'Verifikasi proposal dan berita acara Bantuan Keuangan Perubahan.',
  },
  {
    key: 'kelembagaan',
    label: 'Kelembagaan',
    description: 'Verifikasi data kelembagaan dan pengurus desa di wilayah kecamatan.',
  },
  {
    key: 'aparatur-desa',
    label: 'Aparatur Desa',
    description: 'Memantau data aparatur desa (lihat saja).',
  },
  {
    key: 'bumdes',
    label: 'BUMDes',
    description: 'Memantau data BUMDes (lihat saja).',
  },
  {
    key: 'pesan',
    label: 'Pesan',
    description: 'Percakapan dengan DPMD, desa, dan dinas terkait.',
  },
];

const KECAMATAN_PERMISSION_KEYS = KECAMATAN_PERMISSIONS.map((p) => p.key);

/** Saring input sembarang menjadi daftar key yang valid dan unik. */
const sanitizeKecamatanPermissionKeys = (input) => {
  const mentah = Array.isArray(input) ? input : [];
  return [...new Set(mentah.map((k) => String(k || '').trim()).filter((k) => KECAMATAN_PERMISSION_KEYS.includes(k)))];
};

/**
 * Modul halaman Akun Operator bidang → fitur kecamatan yang menjadi urusannya.
 *
 * Dipakai saat staf bidang membuatkan operator kecamatan dari tab Akun
 * Kecamatan: operator itu hanya membawa fitur milik bidang tersebut. Bankeu
 * ikut membawa Bankeu Perubahan karena keduanya diverifikasi bidang yang sama
 * (SPKED) dan Bankeu Perubahan tidak punya halaman akun sendiri. Modul yang
 * tidak ada di sini (mis. Kerja Sama Desa) memang tidak punya fitur kecamatan.
 */
const KECAMATAN_KEYS_PER_MODUL = {
  bankeu: ['bankeu', 'bankeu-perubahan'],
  bumdes: ['bumdes'],
  kelembagaan: ['kelembagaan'],
  'aparatur-desa': ['aparatur-desa'],
};

/** Fitur bersama yang selalu ikut diberikan bidang: tanpa Pesan, operator tidak bisa bertanya balik. */
const KECAMATAN_PERMISSION_LINTAS_BIDANG = ['pesan'];

const kecamatanKeysUntukModul = (modulSlug) => KECAMATAN_KEYS_PER_MODUL[String(modulSlug || '')] || [];

// Satu kecamatan biasanya hanya beberapa seksi; batas ini mencegah akun
// operator bertambah tanpa kendali — berlaku untuk akun utama maupun bidang.
const BATAS_OPERATOR_KECAMATAN = 30;

module.exports = {
  BATAS_OPERATOR_KECAMATAN,
  KECAMATAN_PERMISSIONS,
  KECAMATAN_PERMISSION_KEYS,
  KECAMATAN_PERMISSION_LINTAS_BIDANG,
  sanitizeKecamatanPermissionKeys,
  kecamatanKeysUntukModul,
};
