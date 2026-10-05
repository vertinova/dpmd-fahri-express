/**
 * Peran pegawai internal DPMD.
 *
 * Daftar ini sempat disalin ke banyak rute, dan salinan yang lupa diperbarui
 * membuat izin menyimpang diam-diam: rute pemdes lahir tanpa `sekretaris_dinas`,
 * sehingga Sekretaris Dinas menerima 403 di seluruh Core Dashboard padahal
 * Kepala Dinas lolos. Satu daftar dipakai bersama supaya menambah peran baru
 * cukup di satu tempat.
 */

// Peran pegawai DPMD — sama dengan isi tab "Pegawai DPMD" di Manajemen Akun.
const PERAN_PEGAWAI_DPMD = [
	'kepala_dinas',
	'sekretaris_dinas',
	'kepala_bidang',
	'ketua_tim',
	'bendahara',
	'pegawai',
];

// Pegawai DPMD ditambah pengelola sistem. Ini yang dipakai rute internal yang
// boleh dibuka seluruh staf, misalnya halaman-halaman Core Dashboard.
const PERAN_INTERNAL_DPMD = [...PERAN_PEGAWAI_DPMD, 'superadmin'];

/**
 * Pemantau pembinaan desa: staf DPMD ditambah Tenaga Ahli.
 *
 * Tenaga Ahli bukan pegawai dinas — ia pendamping yang membaca data pembinaan
 * BUM Desa dan Kerja Sama Desa untuk menyusun rekomendasi. Karena itu ia duduk
 * di daftar TERSENDIRI, bukan ditambahkan ke PERAN_INTERNAL_DPMD: daftar itu
 * dipakai sepuluh rute lain (Gema, Asta Desa, akun operator desa, produk hukum,
 * aparatur, profil desa) dan menambahkannya di sana berarti membuka seluruh
 * Core Dashboard untuk akun luar hanya karena ia butuh dua halaman.
 *
 * Dipakai HANYA di rute baca: /api/spked/ikhtisar dan /api/dpmd/kerjasama-desa.
 * Data BUM Desa-nya datang dari /api/kepala-dinas/bumdes yang memang sudah
 * `auth` saja. Tidak ada rute tulis yang memakai daftar ini, dan itu bukan
 * kebetulan yang menunggu dilengkapi.
 */
const PERAN_PEMANTAU_SPKED = [...PERAN_INTERNAL_DPMD, 'tenaga_ahli'];

module.exports = {
	PERAN_PEGAWAI_DPMD,
	PERAN_INTERNAL_DPMD,
	PERAN_PEMANTAU_SPKED,
};
