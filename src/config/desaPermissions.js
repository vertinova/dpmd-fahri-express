/**
 * Daftar hak akses (permission) fitur halaman Desa.
 *
 * Satu key = satu modul di sidebar /desa. Admin Desa memilih key-key ini saat
 * membuat/mengubah akun operasional desa (role `desa`).
 *
 * Dashboard dan Pengaturan tidak masuk daftar: selalu terbuka untuk semua akun desa.
 * Key harus sama persis dengan yang ada di frontend `src/constants/desaPermissions.js`.
 */

const DESA_PERMISSIONS = [
  {
    key: 'profil-desa',
    label: 'Profil Desa',
    description: 'Melihat dan memperbarui data profil desa.',
  },
  {
    key: 'produk-hukum',
    label: 'Produk Hukum',
    description: 'Kelola Perdes, Perkades, dan SK Kepala Desa.',
  },
  {
    key: 'bumdes',
    label: 'BUMDes',
    description: 'Kelola data dan laporan BUMDes.',
  },
  {
    key: 'kelembagaan',
    label: 'Kelembagaan',
    description: 'Kelola RW, RT, Posyandu, LPM, PKK, Karang Taruna, dan pengurusnya.',
  },
  {
    key: 'aparatur-desa',
    label: 'Aparatur Desa',
    description: 'Kelola data perangkat desa.',
  },
  {
    key: 'bankeu',
    label: 'Bantuan Keuangan',
    description: 'Proposal, surat, dan LPJ Bantuan Keuangan.',
  },
  {
    key: 'bankeu-perubahan',
    label: 'Bankeu Perubahan',
    description: 'Proposal dan LPJ Bantuan Keuangan Perubahan.',
  },
  {
    key: 'bantuan-provinsi-lpj',
    label: 'LPJ Bantuan Provinsi',
    description: 'Unggah LPJ bantuan keuangan provinsi.',
  },
  {
    key: 'pesan',
    label: 'Pesan',
    description: 'Percakapan dengan DPMD, kecamatan, dan dinas terkait.',
  },
];

const DESA_PERMISSION_KEYS = DESA_PERMISSIONS.map((p) => p.key);

/**
 * Ambil hanya key yang valid dari input sembarang (array/string) tanpa duplikat.
 */
const sanitizePermissionKeys = (input) => {
  const raw = Array.isArray(input) ? input : [];
  const cleaned = raw
    .map((key) => String(key || '').trim())
    .filter((key) => DESA_PERMISSION_KEYS.includes(key));
  return [...new Set(cleaned)];
};

module.exports = {
  DESA_PERMISSIONS,
  DESA_PERMISSION_KEYS,
  sanitizePermissionKeys,
};
