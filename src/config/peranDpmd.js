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

module.exports = {
	PERAN_PEGAWAI_DPMD,
	PERAN_INTERNAL_DPMD,
};
