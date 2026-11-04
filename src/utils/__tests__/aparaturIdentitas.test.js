const { periksaIdentitas, identitasKurang, hanyaMelengkapiIdentitas } = require('../aparaturIdentitas');

const NIK = '3201010101800001';

describe('periksaIdentitas', () => {
	it('membersihkan NIK dan menormalkan WhatsApp ke 62…', () => {
		expect(periksaIdentitas({ nik: '3201 0101 0180 0001', whatsapp: '0812-3456-7890' })).toEqual({ nik: NIK, whatsapp: '6281234567890' });
		expect(periksaIdentitas({ nik: NIK, whatsapp: '+62 812 3456 7890' }).whatsapp).toBe('6281234567890');
	});
	it.each([
		[{ nik: '', whatsapp: '081234567890' }, /NIK wajib/],
		[{ nik: null, whatsapp: '081234567890' }, /NIK wajib/],
		[{ nik: NIK, whatsapp: '' }, /WhatsApp wajib/],
		[{ nik: NIK, whatsapp: undefined }, /WhatsApp wajib/],
		[{ nik: '320101', whatsapp: '081234567890' }, /16 digit/],
		[{ nik: `${NIK}9`, whatsapp: '081234567890' }, /16 digit/],
		[{ nik: '1111111111111111', whatsapp: '081234567890' }, /16 digit/],
		[{ nik: NIK, whatsapp: '12345' }, /tidak valid/],
	])('menolak %j', (kiriman, pesan) => {
		expect(periksaIdentitas(kiriman).galat).toMatch(pesan);
	});
	it('wajib: false menerima kosong, tapi isian salah tetap ditolak', () => {
		expect(periksaIdentitas({ nik: '', whatsapp: null }, { wajib: false })).toEqual({ nik: null, whatsapp: null });
		expect(periksaIdentitas({ nik: '123', whatsapp: '' }, { wajib: false }).galat).toMatch(/16 digit/);
	});
});

describe('identitasKurang', () => {
	it('menyebut kolom yang masih kosong', () => {
		expect(identitasKurang({ nik: null, whatsapp: null })).toEqual(['NIK', 'nomor WhatsApp']);
		expect(identitasKurang({ nik: NIK, whatsapp: '6281234567890' })).toEqual([]);
	});
});

describe('hanyaMelengkapiIdentitas', () => {
	const lama = {
		status_verifikasi: 'terverifikasi',
		nik: null,
		whatsapp: null,
		nama_lengkap: 'Siti',
		tanggal_lahir: new Date('1980-02-03T00:00:00.000Z'),
		keterangan: null,
		status: 'Aktif',
	};
	const kiriman = { nik: NIK, whatsapp: '6281234567890', nama_lengkap: 'Siti', tanggal_lahir: new Date('1980-02-03'), keterangan: null, status: 'Aktif' };

	it('melengkapi NIK & WhatsApp tidak menggugurkan verifikasi', () => {
		expect(hanyaMelengkapiIdentitas(lama, kiriman)).toBe(true);
	});
	it('mengganti WhatsApp saja tidak menggugurkan verifikasi', () => {
		expect(hanyaMelengkapiIdentitas({ ...lama, nik: NIK, whatsapp: '6281111111111' }, kiriman)).toBe(true);
	});
	it('mengganti NIK yang sudah ada menggugurkan verifikasi', () => {
		expect(hanyaMelengkapiIdentitas({ ...lama, nik: '3201010101800002' }, kiriman)).toBe(false);
	});
	it.each([
		[{ nama_lengkap: 'Sitti' }],
		[{ tanggal_lahir: new Date('1980-02-04') }],
		[{ status: 'Tidak_Aktif' }],
	])('mengubah isian lain menggugurkan verifikasi: %j', (ubahan) => {
		expect(hanyaMelengkapiIdentitas(lama, { ...kiriman, ...ubahan })).toBe(false);
	});
	it('berkas baru menggugurkan verifikasi', () => {
		expect(hanyaMelengkapiIdentitas(lama, kiriman, true)).toBe(false);
	});
	it.each([['ditolak'], [null]])('status %p selalu kembali ke antrean', (status) => {
		expect(hanyaMelengkapiIdentitas({ ...lama, status_verifikasi: status }, kiriman)).toBe(false);
	});
});
