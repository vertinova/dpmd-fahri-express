const { alasanSpam, periksaKolomSpam } = require('../teksSpam');

// Teks spam asli yang ditemukan di data produksi (arsip Dapur Desa, 2026-07-08).
const SPAM_PRODUKSI = [
	'Cara Menghubungi CS Adakami Hubungi call center resmi Adakami 0817-474-2225. atau CS Adakami 0851-6666-2133.',
	'Cara restrukturisasi Pinjaman EasyCash kamu bisa hubungi CS EasyCash 0851•6666•4573',
	'Cs Trip.com Indonesia layanan bantuan pelanggan 24 Jam Call Center Trip.com Hubungi Telepon: 0818836245',
];

describe('alasanSpam', () => {
	test.each(SPAM_PRODUKSI)('menolak: %s', (teks) => expect(alasanSpam(teks)).not.toBeNull());

	test.each(['WA 081234567890', 'kunjungi www.contoh.xyz', 'promo-murah.com'])('menolak: %s', (teks) => {
		expect(alasanSpam(teks)).not.toBeNull();
	});

	test.each([
		'H. AGUS SAHRUDIN, S.Pd.I',
		'IWAN SETIAWAN,S.IP',
		'Hj. SITI ISMAWATI, S.E., M.M.',
		'A N D R I A W A N',
		'JAMHALI BIN JAMBRI',
		'NURJAMAN, S.Ap',
		'GINA RAMDHANI NURSALEH,S.Kom',
		'Bogor',
		'',
		null,
	])('menerima nama wajar: %s', (teks) => expect(alasanSpam(teks)).toBeNull());
});

describe('periksaKolomSpam', () => {
	test('pesan menyebut kolomnya', () => {
		expect(periksaKolomSpam({ nama_lengkap: SPAM_PRODUKSI[0] })).toMatch(/^Nama lengkap ditolak/);
	});

	test('kolom yang tidak dikirim dilewati', () => {
		expect(periksaKolomSpam({ jabatan: 'KEPALA DESA' })).toBeNull();
	});
});
