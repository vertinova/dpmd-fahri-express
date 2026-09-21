/**
 * Template username (email) untuk pembuatan massal akun operator desa.
 *
 * Akun desa login memakai EMAIL — tabel `users` tidak punya kolom username.
 * Jadi yang disusun staf di pop-up bukan sekadar nama pengguna, melainkan
 * alamat email lengkap yang harus lolos validasi login. Semua penyusunannya
 * lewat berkas ini supaya pratinjau dan eksekusi tidak mungkin menyimpang:
 * apa yang dilihat staf sebelum menekan tombol persis yang ditulis ke basis
 * data.
 *
 * Bentuk bawaannya mengikuti contoh yang dipakai bidang:
 *   bumdes.caringin.caringin@dpmd.bogorkab.go.id
 *   └fitur┘ └kecamatan┘ └desa┘
 */

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Token yang dikenali di dalam template. Di luar ini ditolak, bukan diabaikan. */
const TOKEN_TEMPLATE = [
  { token: '{fitur}', keterangan: 'Slug fitur, mis. bankeu atau bumdes' },
  { token: '{kecamatan}', keterangan: 'Nama kecamatan tanpa spasi, mis. caringin' },
  { token: '{desa}', keterangan: 'Nama desa/kelurahan tanpa spasi, mis. caringin' },
  { token: '{kode}', keterangan: 'Kode wilayah desa, mis. 3201052001' },
];

const TEMPLATE_BAWAAN = '{fitur}.{kecamatan}.{desa}@dpmd.bogorkab.go.id';

/**
 * Sebuah token WAJIB ada di setiap template: tanpanya seluruh desa menghasilkan
 * alamat yang sama dan hanya satu akun yang jadi. Ini diperiksa di depan, bukan
 * dibiarkan muncul sebagai ratusan galat "email sudah dipakai".
 */
const TOKEN_PEMBEDA = ['{desa}', '{kode}'];

/**
 * Nama wilayah → potongan alamat email.
 *
 * Aksen dan tanda baca dibuang, spasi dirapatkan (bukan diganti tanda hubung)
 * supaya hasilnya sependek contoh yang dipakai bidang. Konsekuensinya "Suka
 * Maju" dan "Sukamaju" di kecamatan yang sama menghasilkan alamat kembar —
 * itu ditangkap sebagai bentrokan saat pratinjau, bukan dibiarkan lolos.
 */
const slugWilayah = (teks) =>
  String(teks || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');

/** Susun satu alamat dari template. `nilai` berisi fitur/kecamatan/desa/kode. */
const susunEmail = (template, nilai) =>
  String(template || '')
    .trim()
    .replace(/\{fitur\}/g, slugWilayah(nilai.fitur))
    .replace(/\{kecamatan\}/g, slugWilayah(nilai.kecamatan))
    .replace(/\{desa\}/g, slugWilayah(nilai.desa))
    .replace(/\{kode\}/g, slugWilayah(nilai.kode))
    .toLowerCase();

/**
 * Periksa template sebelum dipakai.
 * Mengembalikan { valid, message } — message hanya diisi bila tidak valid.
 */
const periksaTemplate = (template) => {
  const teks = String(template || '').trim();
  if (!teks) return { valid: false, message: 'Template username wajib diisi.' };

  if (!teks.includes('@')) {
    return { valid: false, message: 'Template harus berupa alamat email lengkap, termasuk bagian setelah @.' };
  }

  const tokenDipakai = teks.match(/\{[^}]*\}/g) || [];
  const dikenali = TOKEN_TEMPLATE.map((t) => t.token);
  const asing = tokenDipakai.filter((t) => !dikenali.includes(t));
  if (asing.length > 0) {
    return {
      valid: false,
      message: `Token tidak dikenali: ${asing.join(', ')}. Yang tersedia: ${dikenali.join(', ')}.`,
    };
  }

  if (!TOKEN_PEMBEDA.some((t) => teks.includes(t))) {
    return {
      valid: false,
      message: 'Template wajib memuat {desa} atau {kode}, kalau tidak semua desa menghasilkan email yang sama.',
    };
  }

  // Diuji dengan nilai contoh: template bisa saja lolos semua aturan di atas
  // tapi tetap menghasilkan alamat yang ditolak validasi email.
  const contoh = susunEmail(teks, {
    fitur: 'bumdes',
    kecamatan: 'Caringin',
    desa: 'Caringin',
    kode: '3201052001',
  });
  if (!EMAIL_REGEX.test(contoh)) {
    return { valid: false, message: `Template menghasilkan email tidak valid: ${contoh}` };
  }

  return { valid: true, message: null, contoh };
};

module.exports = {
  EMAIL_REGEX,
  TOKEN_TEMPLATE,
  TEMPLATE_BAWAAN,
  slugWilayah,
  susunEmail,
  periksaTemplate,
};
