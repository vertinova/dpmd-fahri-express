// uuid versi ini hanya ESM sehingga tak termuat jest; fungsi yang diuji tidak memakainya.
jest.mock('uuid', () => ({ v4: () => 'uuid-uji' }));

const { cariPenghalangArsip, kursiJabatan, kunciNama } = require('../dapurDesa');

// Kasus-kasus ini diambil dari data produksi yang tergandakan oleh
// rekonsiliasi otomatis 2026-10-19.
describe('kunciNama', () => {
	test.each([
		['DUL MUIS', 'DULMUIS'],
		['IWAN SETIAWAN,S.IP', 'IWAN SETIAWAN'],
		['H ATU ANSYORI, S.E', 'H. ATU ANSYORI, SE'],
		['Bunyamin', 'BUNYAMIN'],
		['A N D R I A W A N', 'ANDRIAWAN'],
		['H. AGUS SAHRUDIN, S.Pd.I', 'H. AGUS SAHRUDIN'],
		['WAWAN, S.AP', 'WAWAN'],
	])('%s = %s', (a, b) => expect(kunciNama(a)).toBe(kunciNama(b)));

	test('nama berbeda tetap berbeda', () => {
		expect(kunciNama('AHMAD ARYANI')).not.toBe(kunciNama('R AGUS SUTISNA'));
	});
});

describe('kursiJabatan', () => {
	test.each([
		['KEPALA DESA', 'Kepala Desa'],
		['PJ KEPALA DESA', 'KEPALA DESA'],
		['KAUR UMUM DAN TU', 'Kepala Urusan Tata Usaha dan Umum'],
		['KASI KESEJAHTERAAN RAKYAT', 'Kepala Seksi Kesejahteraan'],
		['KADUS IV', 'Kadus IV'],
		['KETUA BPD', 'Ketua BPD'],
	])('%s sekursi dengan %s', (a, b) => {
		expect(kursiJabatan(a)).not.toBeNull();
		expect(kursiJabatan(a)).toBe(kursiJabatan(b));
	});

	test.each(['Staf Desa', 'KADUS', 'ANGGOTA BPD', 'RT'])('%s boleh banyak orang', (j) => {
		expect(kursiJabatan(j)).toBeNull();
	});

	test('kadus bernomor beda bukan kursi yang sama', () => {
		expect(kursiJabatan('KADUS I')).not.toBe(kursiJabatan('KADUS II'));
	});
});

describe('cariPenghalangArsip', () => {
	const desa = [
		{ id: 'a', nama_lengkap: 'Bunyamin', jabatan: 'KEPALA DESA', status: 'Aktif' },
		{ id: 'b', nama_lengkap: 'ASEP', jabatan: 'Sekretaris Desa', status: 'Tidak Aktif' },
		{ id: 'c', nama_lengkap: 'DEDI', jabatan: 'Kadus', status: 'Aktif' },
	];

	test('orang yang sama dengan ejaan lain → ditautkan', () => {
		expect(cariPenghalangArsip({ nama: 'BUNYAMIN', jabatan: 'KEPALA DESA' }, desa)).toEqual({ aparatur: desa[0], alasan: 'nama' });
	});

	test('kepala desa kedua (orang lain) → ditahan karena kursinya terisi', () => {
		expect(cariPenghalangArsip({ nama: 'Desa batok', jabatan: 'KEPALA DESA' }, desa)).toEqual({ aparatur: desa[0], alasan: 'kursi' });
	});

	test('kursi yang pemegangnya sudah tidak aktif boleh diisi arsip', () => {
		expect(cariPenghalangArsip({ nama: 'UJANG', jabatan: 'SEKRETARIS DESA' }, desa)).toBeNull();
	});

	test('jabatan yang boleh banyak orang tidak ditahan', () => {
		expect(cariPenghalangArsip({ nama: 'IDIS', jabatan: 'KADUS' }, desa)).toBeNull();
	});
});
