/**
 * Siapa yang boleh mengelola akun, dan akun siapa yang boleh dikelola.
 *
 * Dulu daftar ini hanya ada di src/routes/user.routes.js. Sekarang Gema juga
 * memakainya untuk fitur setel ulang sandi, dan dua salinan daftar peran adalah
 * cara paling mudah membuat izin akses menyimpang diam-diam — jadi daftarnya
 * dipindah ke sini dan dipakai bersama.
 */

// Staf internal DPMD: boleh membuka Manajemen Pengguna dan menyetel ulang sandi.
const PERAN_ADMIN_AKUN = [
	'superadmin',
	'kepala_dinas',
	'sekretaris_dinas',
	'kepala_bidang',
	'ketua_tim',
	'pegawai',
	'bendahara',
];

// Akun yang boleh DICARI dan disetel ulang lewat Gema. Superadmin sengaja tidak
// masuk: akun itu dipegang pengelola sistem dan tidak boleh disentuh lewat
// perintah suara.
const PERAN_AKUN_PEGAWAI = [
	'kepala_dinas',
	'sekretaris_dinas',
	'kepala_bidang',
	'ketua_tim',
	'pegawai',
	'bendahara',
];

// Peran yang boleh MENYETEL ULANG SANDI lewat Gema. Sengaja jauh lebih sempit
// dari PERAN_ADMIN_AKUN: lewat Manajemen Pengguna tindakan itu butuh membuka
// halaman, mencari orangnya, dan menekan tombol; lewat suara ia hanya sekalimat.
// Kewenangan yang sama tidak berarti kemudahan yang sama, jadi pintu suaranya
// dibatasi ke pimpinan dan pengelola sistem.
const PERAN_SETEL_SANDI_SUARA = [
	'superadmin',
	'kepala_dinas',
	'sekretaris_dinas',
];

const normalkan = (peran) => String(peran || '').trim().toLowerCase();

const bolehSetelSandiSuara = (peran) => PERAN_SETEL_SANDI_SUARA.includes(normalkan(peran));

module.exports = {
	PERAN_ADMIN_AKUN,
	PERAN_AKUN_PEGAWAI,
	PERAN_SETEL_SANDI_SUARA,
	bolehSetelSandiSuara,
	normalkan,
};
