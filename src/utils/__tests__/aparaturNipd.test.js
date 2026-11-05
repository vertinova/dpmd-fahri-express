/**
 * Aturan NIPD (Nomor Induk Perangkat Desa), ketetapan Bidang Pemdes 2026-10-19:
 *
 *   20 digit = tahun lahir (4) + bulan (2) + tanggal (2) + kode kabupaten (2)
 *            + kode kecamatan (2) + kode desa (4) + jenis kelamin (1)
 *            + kode jabatan (3)
 *
 *   Kabupaten Bogor = 01.  Laki-laki = 1, Perempuan = 2.
 *   Sekdes 001 · Kasi Pemerintahan 002 · Kasi Pelayanan 003 · Kasi Kesra 004
 *   Kaur Umum 005 · Kaur Keuangan 006 · Kaur Perencanaan 007 · Kadus 1 = 008, dst.
 *   Staf perangkat (dan kepala desa, BPD) hanya didata — tanpa NIPD.
 *
 * Tabel di bawah adalah aturan itu sendiri; mengubah kode di aparaturNipd.js
 * tanpa mengubah tabel ini akan membuat uji gagal.
 */

const { kodeJabatan, kodeWilayah, buatNipd, ringkasVerifikasi, catatanUntukDesa, itemBerubah, verifikasiSetelahUbah } = require('../aparaturNipd');

const DESA = '32.01.40.2007'; // Kec 40, Desa 2007

describe('kode jabatan sesuai ketetapan', () => {
	// [jabatan, kode] — ejaan formulir maupun ejaan yang hidup di data.
	const TABEL = [
		['Sekretaris Desa', '001'], ['SEKDES', '001'],
		['Kepala Seksi Pemerintahan', '002'], ['KASI PEMERINTAHAN', '002'],
		['Kepala Seksi Pelayanan', '003'], ['KASI PELAYANAN', '003'],
		['Kepala Seksi Kesejahteraan', '004'], ['KASI KESEJAHTERAAN RAKYAT', '004'], ['KASI KESRA', '004'],
		['Kepala Urusan Tata Usaha dan Umum', '005'], ['KAUR UMUM DAN TU', '005'], ['KAUR UMUM', '005'],
		['Kepala Urusan Keuangan', '006'], ['KAUR KEUANGAN', '006'],
		['Kepala Urusan Perencanaan', '007'], ['KAUR PERENCANAAN', '007'],
		['Kadus I', '008'], ['KADUS II', '009'], ['Kadus III', '010'], ['KADUS IV', '011'],
		['Kadus V', '012'], ['Kadus IX', '016'], ['Kadus X', '017'],
		['Kepala Dusun 1', '008'], ['KEPALA DUSUN II', '009'],
	];

	it.each(TABEL)('%s → %s', (jabatan, kode) => {
		expect(kodeJabatan(jabatan)).toEqual({ kode, berhak: true });
	});

	it('Kadus ke-N selalu 007 + N', () => {
		for (let n = 1; n <= 20; n++) {
			expect(kodeJabatan(`Kadus ${n}`).kode).toBe(String(7 + n).padStart(3, '0'));
		}
	});

	it.each([
		'Kepala Desa', 'KADES', 'Staf Desa', 'Staf Sekretariat', 'Staf Seksi Pemerintahan', 'STAFF DESA',
		'Ketua BPD', 'Wakil Ketua BPD', 'Sekretaris BPD', 'Anggota BPD',
	])('%s tidak mendapat NIPD', (jabatan) => {
		expect(kodeJabatan(jabatan)).toEqual({ kode: null, berhak: false });
	});

	// Keputusan 2026-10-19: jabatan gabungan ditahan, desa harus memilih satu.
	it.each(['Kaur Umum dan Perencanaan', 'KAUR KEUANGAN DAN PERENCANAAN', 'Kasi Pemerintahan dan Pelayanan'])(
		'%s (gabungan) ditahan dengan alasan',
		(jabatan) => {
			const hasil = kodeJabatan(jabatan);
			expect(hasil).toMatchObject({ kode: null, berhak: true });
			expect(hasil.alasan).toMatch(/gabungan/i);
		},
	);

	it('"Umum dan TU" satu urusan — bukan gabungan', () => {
		expect(kodeJabatan('Kaur Umum dan TU').kode).toBe('005');
		expect(kodeJabatan('Kepala Urusan Tata Usaha dan Umum').kode).toBe('005');
	});

	it('Kadus tanpa nomor berhak tapi ditahan dengan alasan', () => {
		const hasil = kodeJabatan('Kepala Dusun');
		expect(hasil.berhak).toBe(true);
		expect(hasil.kode).toBeNull();
		expect(hasil.alasan).toMatch(/nomor dusun/i);
	});
});

describe('susunan 20 digit', () => {
	it('contoh demo: Kadus III perempuan lahir 12-05-1990 di 32.01.02.2001', () => {
		const { nipd } = buatNipd({ tanggal_lahir: new Date('1990-05-12'), jenis_kelamin: 'Perempuan', jabatan: 'Kadus III' }, '32.01.02.2001');
		expect(nipd).toBe('19900512' + '01' + '02' + '2001' + '2' + '010');
	});

	it('tiap bagian berada di posisinya', () => {
		const { nipd } = buatNipd({ tanggal_lahir: new Date('1978-11-03'), jenis_kelamin: 'Laki_laki', jabatan: 'Sekretaris Desa' }, DESA);
		expect(nipd).toHaveLength(20);
		expect(nipd.slice(0, 4)).toBe('1978'); // tahun
		expect(nipd.slice(4, 6)).toBe('11'); // bulan
		expect(nipd.slice(6, 8)).toBe('03'); // tanggal
		expect(nipd.slice(8, 10)).toBe('01'); // Kabupaten Bogor
		expect(nipd.slice(10, 12)).toBe('40'); // kecamatan
		expect(nipd.slice(12, 16)).toBe('2007'); // desa
		expect(nipd.slice(16, 17)).toBe('1'); // laki-laki
		expect(nipd.slice(17)).toBe('001'); // sekdes
	});

	it('perempuan = 2, laki-laki = 1', () => {
		const dasar = { tanggal_lahir: new Date('1980-01-01'), jabatan: 'Kaur Keuangan' };
		expect(buatNipd({ ...dasar, jenis_kelamin: 'Laki_laki' }, DESA).nipd[16]).toBe('1');
		expect(buatNipd({ ...dasar, jenis_kelamin: 'Perempuan' }, DESA).nipd[16]).toBe('2');
	});

	it('tanggal lahir tidak bergeser oleh zona waktu (kolom DATE = tengah malam UTC)', () => {
		// 1 Jan tengah malam UTC = 31 Des pukul 07.00 WIB sebelumnya kalau dibaca lokal.
		const { nipd } = buatNipd({ tanggal_lahir: new Date('1985-01-01T00:00:00.000Z'), jenis_kelamin: 'Laki_laki', jabatan: 'Kadus I' }, DESA);
		expect(nipd.slice(0, 8)).toBe('19850101');
	});

	it('tanggal lahir taksiran Dapur Desa → NIPD ditahan', () => {
		const hasil = buatNipd(
			{ tanggal_lahir: new Date('1975-01-01'), tanggal_lahir_taksiran: true, jenis_kelamin: 'Laki_laki', jabatan: 'Kadus I' },
			DESA,
		);
		expect(hasil.nipd).toBeNull();
		expect(hasil.alasan).toMatch(/taksiran/i);
	});

	it('jabatan tanpa NIPD menghasilkan null tanpa alasan', () => {
		expect(buatNipd({ tanggal_lahir: new Date('1970-01-01'), jenis_kelamin: 'Laki_laki', jabatan: 'Kepala Desa' }, DESA)).toEqual({ nipd: null });
	});

	it.each([
		[{ tanggal_lahir: null, jenis_kelamin: 'Laki_laki', jabatan: 'Kadus I' }, DESA, /tanggal lahir/i],
		[{ tanggal_lahir: new Date('1980-01-01'), jenis_kelamin: null, jabatan: 'Kadus I' }, DESA, /jenis kelamin/i],
		[{ tanggal_lahir: new Date('1980-01-01'), jenis_kelamin: 'Laki_laki', jabatan: 'Kadus I' }, '32.01.40', /kode wilayah/i],
		[{ tanggal_lahir: new Date('1980-01-01'), jenis_kelamin: 'Laki_laki', jabatan: 'Kadus I' }, null, /kode wilayah/i],
	])('data kurang → tidak terbit, dengan alasan', (aparatur, kode, alasan) => {
		const hasil = buatNipd(aparatur, kode);
		expect(hasil.nipd).toBeNull();
		expect(hasil.alasan).toMatch(alasan);
	});
});

describe('kode wilayah', () => {
	it('mengambil kecamatan & desa dari kode desa, kabupaten selalu 01', () => {
		expect(kodeWilayah('32.01.40.2007')).toEqual({ kab: '01', kec: '40', desa: '2007' });
		expect(kodeWilayah('32.01.02.2001')).toEqual({ kab: '01', kec: '02', desa: '2001' });
	});
	it.each(['', null, '32.01.40', '32.01.4.2007', '32.01.40.207'])('menolak bentuk tak dikenal: %p', (kode) => {
		expect(kodeWilayah(kode)).toBeNull();
	});
});

describe('NIPD hanya untuk data valid', () => {
	const aparatur = { file_ktp: 'ktp.png', file_sk_terakhir: 'sk.pdf' };
	const semua = { biodata: { status: 'sesuai' }, jabatan_sk: { status: 'sesuai' }, file_ktp: { status: 'sesuai' }, file_sk_terakhir: { status: 'sesuai' } };

	it('semua item sesuai → terverifikasi', () => {
		expect(ringkasVerifikasi(aparatur, semua)).toBe('terverifikasi');
	});
	it('satu item tidak sesuai → ditolak', () => {
		expect(ringkasVerifikasi(aparatur, { ...semua, file_ktp: { status: 'tidak_sesuai', catatan: 'buram' } })).toBe('ditolak');
	});
	it('belum semua diperiksa → belum diputus', () => {
		expect(ringkasVerifikasi(aparatur, { biodata: { status: 'sesuai' } })).toBeNull();
	});
	it('SK terakhir belum diunggah → tidak bisa valid', () => {
		expect(ringkasVerifikasi({ file_ktp: 'ktp.png' }, semua)).toBe('ditolak');
	});
});

describe('jabatan ber-NIPD: semua persyaratan harus lengkap dan sesuai', () => {
	const sesuai = { status: 'sesuai' };
	const BERKAS = ['file_sk_terakhir', 'file_ktp', 'file_pas_foto', 'file_kk', 'file_akta_kelahiran', 'file_ijazah_terakhir', 'file_bpjs_kesehatan', 'file_bpjs_ketenagakerjaan'];
	const lengkap = {
		jabatan: 'Sekretaris Desa',
		bpjs_kesehatan_nomor: '0001',
		bpjs_ketenagakerjaan_nomor: '0002',
		...Object.fromEntries(BERKAS.map((k) => [k, `${k}.pdf`])),
	};
	const semuaSesuai = Object.fromEntries(['biodata', 'jabatan_sk', 'bpjs', ...BERKAS].map((k) => [k, sesuai]));

	it('semua ada dan sesuai → terverifikasi', () => {
		expect(ringkasVerifikasi(lengkap, semuaSesuai)).toBe('terverifikasi');
	});

	it('Sekdes hanya punya SK & KTP, keduanya sesuai → dikembalikan, catatan menyebut yang kurang', () => {
		const baris = { jabatan: 'Sekretaris Desa', file_sk_terakhir: 'sk.pdf', file_ktp: 'ktp.png' };
		expect(ringkasVerifikasi(baris, semuaSesuai)).toBe('ditolak');
		const catatan = catatanUntukDesa(baris, semuaSesuai);
		expect(catatan).toContain('Kartu Keluarga: belum diunggah');
		expect(catatan).toContain('Nomor BPJS: belum diisi');
		expect(catatan).not.toContain('KTP');
	});

	it('satu berkas belum diperiksa → belum diputus, NIPD belum boleh terbit', () => {
		const { file_kk, ...tanpaKk } = semuaSesuai;
		expect(file_kk).toBeDefined();
		expect(ringkasVerifikasi(lengkap, tanpaKk)).toBeNull();
	});

	it('hanya satu nomor BPJS terisi → belum lengkap', () => {
		expect(ringkasVerifikasi({ ...lengkap, bpjs_ketenagakerjaan_nomor: null }, semuaSesuai)).toBe('ditolak');
	});

	it.each(['Kepala Desa', 'Ketua BPD', 'Staf Desa'])('%s tidak ber-NIPD: cukup SK & KTP', (jabatan) => {
		expect(ringkasVerifikasi({ jabatan, file_sk_terakhir: 'sk.pdf', file_ktp: 'ktp.png' }, semuaSesuai)).toBe('terverifikasi');
	});
});

describe('verifikasiSetelahUbah: simpanan desa hanya menggugurkan item yang berubah', () => {
	const sesuai = { status: 'sesuai' };
	const baris = (extra = {}) => ({
		nik: '3201010101010001',
		whatsapp: '628123456789',
		nama_lengkap: 'Budi',
		tempat_lahir: 'Bogor',
		tanggal_lahir: new Date('1990-05-17'),
		jenis_kelamin: 'Laki_laki',
		agama: 'Islam',
		pendidikan_terakhir: 'SMA',
		jabatan: 'Sekretaris Desa',
		niap: null,
		pangkat_golongan: null,
		tanggal_pengangkatan: new Date('2020-01-01'),
		nomor_sk_pengangkatan: '12/2020',
		produk_hukum_id: null,
		file_sk_terakhir: 'sk.pdf',
		file_ktp: 'ktp.png',
		status_verifikasi: 'ditolak',
		dpmd_verified_at: new Date('2026-10-20'),
		dpmd_verified_by: 'u1',
		nipd: null,
		verifikasi_item: {
			biodata: sesuai,
			jabatan_sk: sesuai,
			file_sk_terakhir: sesuai,
			file_ktp: { status: 'tidak_sesuai', catatan: 'buram' },
		},
		...extra,
	});
	const ubah = (lama, baru, berkas = []) => {
		const berubah = itemBerubah(lama, baru, berkas);
		return verifikasiSetelahUbah(lama, { ...lama, ...baru }, berubah);
	};

	it('KTP diganti pada baris ditolak: hanya keputusan KTP gugur', () => {
		const hasil = ubah(baris(), {}, ['file_ktp']);
		expect(Object.keys(hasil.verifikasi_item).sort()).toEqual(['biodata', 'file_sk_terakhir', 'jabatan_sk']);
		expect(hasil.status_verifikasi).toBeNull();
		expect(hasil.nipd).toBeNull();
	});

	it('dua item ditolak, satu direvisi: tetap ditolak, catatan hanya item yang belum direvisi', () => {
		const lama = baris({
			verifikasi_item: {
				biodata: { status: 'tidak_sesuai', catatan: 'nama salah' },
				jabatan_sk: sesuai,
				file_sk_terakhir: sesuai,
				file_ktp: { status: 'tidak_sesuai', catatan: 'buram' },
			},
		});
		const hasil = ubah(lama, {}, ['file_ktp']);
		expect(hasil.status_verifikasi).toBe('ditolak');
		expect(hasil.catatan_verifikasi).toContain('nama salah');
		expect(hasil.catatan_verifikasi).not.toContain('buram');
	});

	it('simpanan tanpa perubahan: tidak ada item berubah', () => {
		const lama = baris({ nama_lengkap: 'Budi', tempat_lahir: null });
		const baru = { nama_lengkap: ' Budi ', tempat_lahir: '', tanggal_lahir: new Date('1990-05-17'), jabatan: 'Sekretaris Desa' };
		expect(itemBerubah(lama, baru)).toEqual([]);
		expect(itemBerubah(lama, { tanggal_lahir: '1990-05-17' })).toEqual([]);
	});

	it('baris terverifikasi + berkas opsional baru: status null, NIPD null, keputusan lain tetap', () => {
		const lama = baris({
			status_verifikasi: 'terverifikasi',
			nipd: '19900517014020071001',
			verifikasi_item: { biodata: sesuai, jabatan_sk: sesuai, file_sk_terakhir: sesuai, file_ktp: sesuai },
		});
		const hasil = ubah(lama, { file_kk: 'kk.png' }, ['file_kk']);
		expect(hasil.status_verifikasi).toBeNull();
		expect(hasil.nipd).toBeNull();
		expect(Object.keys(hasil.verifikasi_item).sort()).toEqual(['biodata', 'file_ktp', 'file_sk_terakhir', 'jabatan_sk']);
	});

	it('tidak pernah naik menjadi terverifikasi dari simpanan desa', () => {
		const lama = baris({
			// Jabatan tanpa NIPD: pada jabatan ber-NIPD, BPJS kosong berarti dikembalikan ke desa.
			jabatan: 'Kepala Desa',
			bpjs_kesehatan_nomor: '0001',
			verifikasi_item: {
				biodata: sesuai,
				jabatan_sk: sesuai,
				file_sk_terakhir: sesuai,
				file_ktp: sesuai,
				bpjs: { status: 'tidak_sesuai', catatan: 'nomor salah' },
			},
		});
		const hasil = ubah(lama, { bpjs_kesehatan_nomor: '' });
		expect(hasil.status_verifikasi).toBeNull();
		expect(hasil.nipd).toBeNull();
	});

	it('biodata tidak_sesuai karena NIK kosong, lalu NIK diisi: item gugur', () => {
		const lama = baris({
			nik: null,
			verifikasi_item: {
				biodata: { status: 'tidak_sesuai', catatan: 'NIK kosong' },
				jabatan_sk: sesuai,
				file_sk_terakhir: sesuai,
				file_ktp: sesuai,
			},
		});
		const hasil = ubah(lama, { nik: '3201010101010002' });
		expect(hasil.verifikasi_item.biodata).toBeUndefined();
		expect(hasil.status_verifikasi).toBeNull();
	});
});
