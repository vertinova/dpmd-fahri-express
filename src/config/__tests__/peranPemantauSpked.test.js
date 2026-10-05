/**
 * Pagar hak akses peran Tenaga Ahli.
 *
 * Yang diuji di sini bukan "apakah daftarnya berisi tenaga_ahli" — itu bisa
 * dibaca langsung. Yang diuji adalah hal yang mudah rusak tanpa disadari:
 * bahwa `tenaga_ahli` HANYA lolos di daftar pemantau SPKED dan TETAP DITOLAK di
 * PERAN_INTERNAL_DPMD. Daftar yang kedua dipakai sepuluh rute lain (Gema, Asta
 * Desa, akun operator desa, produk hukum Pemdes, aparatur, profil desa), dan
 * seseorang yang kelak ingin "merapikan" dua daftar yang mirip itu dengan
 * menggabungkannya akan membuka seluruh Core Dashboard untuk akun di luar DPMD.
 * Berkas ini yang akan gagal lebih dulu.
 */

// middlewares/auth memuat Prisma di tingkat modul, dan Prisma membuka koneksi
// begitu di-require. Tanpa tiruan ini seluruh berkas uji menuntut MySQL hidup —
// padahal checkRole adalah fungsi murni yang tidak menyentuh basis data sekali
// pun — dan Jest menggantung menunggu koneksi yang tidak pernah ditutup.
jest.mock('../prisma', () => ({
	users: { findUnique: jest.fn(), update: jest.fn() },
	bidangs: { findUnique: jest.fn() },
}));

const { checkRole } = require('../../middlewares/auth');
const { PERAN_INTERNAL_DPMD, PERAN_PEMANTAU_SPKED } = require('../peranDpmd');

/** Jalankan checkRole terhadap satu peran; true = diteruskan ke handler. */
const lolos = (daftar, role) =>
	new Promise((selesai) => {
		const req = { user: { id: 1, email: 'uji@dpmd.test', role, bidang_id: null } };
		// checkRole membalas lewat res.status(...).json(...) saat menolak, dan
		// memanggil next() saat meloloskan. Keduanya diterjemahkan ke boolean.
		const res = { status: () => ({ json: () => selesai(false) }) };
		checkRole(daftar)(req, res, () => selesai(true));
	});

describe('PERAN_PEMANTAU_SPKED', () => {
	it('meloloskan tenaga_ahli', async () => {
		await expect(lolos(PERAN_PEMANTAU_SPKED, 'tenaga_ahli')).resolves.toBe(true);
	});

	it('tetap meloloskan staf DPMD dan superadmin', async () => {
		for (const role of PERAN_INTERNAL_DPMD) {
			await expect(lolos(PERAN_PEMANTAU_SPKED, role)).resolves.toBe(true);
		}
	});

	it.each(['desa', 'admin_desa', 'kecamatan', 'dinas_terkait', 'verifikator_dinas', 'bpjs'])(
		'menolak %s',
		async (role) => {
			await expect(lolos(PERAN_PEMANTAU_SPKED, role)).resolves.toBe(false);
		},
	);
});

describe('PERAN_INTERNAL_DPMD', () => {
	it('TIDAK meloloskan tenaga_ahli — ia bukan staf dinas', async () => {
		await expect(lolos(PERAN_INTERNAL_DPMD, 'tenaga_ahli')).resolves.toBe(false);
	});

	it('tidak ikut membesar saat daftar pemantau bertambah', () => {
		// Pemantau = internal + tambahan. Kalau suatu hari keduanya jadi sama
		// panjang, berarti tambahannya bocor ke daftar internal.
		expect(PERAN_PEMANTAU_SPKED.length).toBeGreaterThan(PERAN_INTERNAL_DPMD.length);
		expect(PERAN_INTERNAL_DPMD).not.toContain('tenaga_ahli');
	});
});
