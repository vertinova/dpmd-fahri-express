const { bacaMasukan, bentukTugas, susunPengingat } = require('../tugasPribadi');

describe('susunPengingat', () => {
	const t = (judul, ymd) => ({ judul, tanggal_pengingat: new Date(`${ymd}T00:00:00Z`) });
	it('satu tugas hari ini: judul tugas jadi isi', () => {
		expect(susunPengingat([t('Rapat', '2026-11-11')], '2026-11-11')).toEqual({ title: '📝 Pengingat tugas hari ini', body: 'Rapat' });
	});
	it('satu tugas lewat', () => {
		expect(susunPengingat([t('SPJ', '2026-11-08')], '2026-11-11').title).toBe('📝 Tugas lewat tanggal');
	});
	it('banyak tugas: hitung hari ini & lewat, maksimal 3 baris', () => {
		const r = susunPengingat([t('a', '2026-11-01'), t('b', '2026-11-11'), t('c', '2026-11-11'), t('d', '2026-11-11')], '2026-11-11');
		expect(r.title).toBe('📝 3 tugas hari ini · 1 lewat tanggal');
		expect(r.body).toBe('• a\n• b\n• c\n+1 lainnya');
	});
	it('hanya yang lewat', () => {
		expect(susunPengingat([t('a', '2026-11-01'), t('b', '2026-11-02')], '2026-11-11').title).toBe('📝 2 lewat tanggal');
	});
});

describe('bacaMasukan (buat)', () => {
	it.each([[{ judul: '' }], [{ judul: '   ' }], [{}], [{ judul: 'a'.repeat(161) }]])('menolak judul tidak sah %j', (b) => {
		expect(bacaMasukan(b).galat).toMatch(/Judul wajib/);
	});
	it('men-trim judul dan mengabaikan selesai', () => {
		expect(bacaMasukan({ judul: '  Rapat  ', selesai: true }).data).toEqual({ judul: 'Rapat' });
	});
	it('tanggal kosong atau null menjadi null', () => {
		expect(bacaMasukan({ judul: 'a', tanggal_pengingat: '' }).data.tanggal_pengingat).toBeNull();
		expect(bacaMasukan({ judul: 'a', tanggal_pengingat: null }).data.tanggal_pengingat).toBeNull();
	});
	it('menerima tanggal sah', () => {
		const { data } = bacaMasukan({ judul: 'a', tanggal_pengingat: '2026-11-12' });
		expect(data.tanggal_pengingat.toISOString().startsWith('2026-11-12')).toBe(true);
	});
	it.each(['2026-02-31', '12/11/2026'])('menolak tanggal %s', (t) => {
		expect(bacaMasukan({ judul: 'a', tanggal_pengingat: t }).galat).toBe('Tanggal pengingat tidak valid');
	});
});

describe('bacaMasukan (sebagian/PATCH)', () => {
	it('menolak body kosong', () => {
		expect(bacaMasukan({}, true).galat).toBe('Tidak ada perubahan');
	});
	it('menolak selesai non-boolean', () => {
		expect(bacaMasukan({ selesai: 'ya' }, true).galat).toMatch(/true\/false/);
	});
	it('menerima selesai saja tanpa judul', () => {
		expect(bacaMasukan({ selesai: true }, true).data).toEqual({ selesai: true });
	});
});

describe('bentukTugas', () => {
	const dasar = { id: 1n, judul: 'a', selesai: false, created_at: new Date(), updated_at: new Date() };
	it('mengubah tanggal ke YYYY-MM-DD dan menjaga null', () => {
		expect(bentukTugas({ ...dasar, tanggal_pengingat: new Date('2026-11-12T00:00:00Z') }).tanggal_pengingat).toBe('2026-11-12');
		expect(bentukTugas({ ...dasar, tanggal_pengingat: null }).tanggal_pengingat).toBeNull();
	});
});
