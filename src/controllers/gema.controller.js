/**
 * Gema — asisten suara Core Dashboard.
 *
 * Ini otak pencariannya: satu teks bebas masuk, satu jawaban terstruktur keluar.
 *
 * BENTUK JAWABAN sengaja sama untuk semua pertanyaan:
 *
 *   { maksud, kalimat, kolom[], baris[], total }
 *
 * `kalimat` yang diucapkan Gema, `kolom` + `baris` yang digambar jadi tabel.
 * Halaman depan tidak perlu tahu pertanyaannya tentang apa — ia hanya menggambar
 * apa pun yang datang. Menambah kemampuan baru cukup menambah satu entri di
 * DAFTAR_MAKSUD, tanpa menyentuh tampilan.
 *
 * PENCOCOKANNYA MASIH KATA KUNCI, BUKAN MODEL BAHASA. Untuk purwarupa ini
 * disengaja: hasilnya bisa ditebak, tidak perlu kunci API, tidak ada biaya per
 * pertanyaan, dan tiap jawaban dijamin datang dari basis data — bukan karangan.
 * Saat nanti diganti model bahasa, yang berubah hanya `cariMaksud`; seluruh
 * penangan di bawahnya tetap dipakai sebagai alat yang boleh dipanggil model.
 */

const prisma = require('../config/prisma');
const logger = require('../utils/logger');

const nf = new Intl.NumberFormat('id-ID');

/** Buang imbuhan panggilan dan tanda baca supaya pencocokan lebih longgar. */
const bersihkan = (teks) =>
	String(teks || '')
		.toLowerCase()
		.replace(/[^\w\s]/g, ' ')
		.replace(/\b(halo|hai|hei|hallo)\s+gema\b/g, ' ')
		.replace(/\bgema\b/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();

const adaSalahSatu = (teks, kata) => kata.some((k) => teks.includes(k));

/* --------------------------------------------------------------- penangan -- */

/** Nama kecamatan yang disebut di dalam pertanyaan, bila ada. */
const kecamatanDisebut = async (teks) => {
	const semua = await prisma.kecamatans.findMany({ select: { id: true, nama: true } });
	const cocok = semua.find((k) => teks.includes(String(k.nama).toLowerCase()));
	return cocok || null;
};

const KOLOM_DESA = [
	{ kunci: 'desa', label: 'Desa' },
	{ kunci: 'kecamatan', label: 'Kecamatan' },
	{ kunci: 'nilai', label: 'Status' },
];

/** Desa menurut kolom di profil_desas (status / klasifikasi / tipologi). */
const cariProfilDesa = async ({ kolom, nilai, labelKolom, labelNilai }) => {
	const baris = await prisma.profil_desas.findMany({
		where: { [kolom]: { contains: nilai } },
		select: {
			[kolom]: true,
			desas: { select: { nama: true, kecamatans: { select: { nama: true } } } },
		},
	});

	const hasil = baris
		.filter((b) => b.desas)
		.map((b) => ({
			desa: b.desas.nama,
			kecamatan: b.desas.kecamatans?.nama || '—',
			nilai: b[kolom],
		}))
		.sort((a, b) => a.kecamatan.localeCompare(b.kecamatan, 'id') || a.desa.localeCompare(b.desa, 'id'));

	return {
		kalimat: hasil.length
			? `Ada ${nf.format(hasil.length)} desa dengan ${labelKolom} ${labelNilai}.`
			: `Tidak ada desa dengan ${labelKolom} ${labelNilai} di data yang tercatat.`,
		kolom: [...KOLOM_DESA.slice(0, 2), { kunci: 'nilai', label: labelKolom }],
		baris: hasil,
		total: hasil.length,
	};
};

const NILAI_STATUS = [
	{ kata: ['mandiri'], nilai: 'Mandiri', ucap: 'Mandiri' },
	{ kata: ['maju'], nilai: 'Maju', ucap: 'Maju' },
	{ kata: ['berkembang'], nilai: 'Berkembang', ucap: 'Berkembang' },
	{ kata: ['tertinggal'], nilai: 'Tertinggal', ucap: 'Tertinggal' },
];

const NILAI_KLASIFIKASI = [
	{ kata: ['swakarya'], nilai: 'Swakarya', ucap: 'Swakarya' },
	{ kata: ['swasembada'], nilai: 'Swasembada', ucap: 'Swasembada' },
	{ kata: ['swadaya'], nilai: 'Swadaya', ucap: 'Swadaya' },
];

const NILAI_TIPOLOGI = [
	{ kata: ['persawahan', 'sawah'], nilai: 'Persawahan', ucap: 'Persawahan' },
	{ kata: ['perkebunan', 'kebun'], nilai: 'Perkebunan', ucap: 'Perkebunan' },
	{ kata: ['perindustrian', 'industri', 'jasa'], nilai: 'Perindustrian', ucap: 'Perindustrian atau Jasa' },
	{ kata: ['perladangan', 'ladang'], nilai: 'Perladangan', ucap: 'Perladangan' },
	{ kata: ['perikanan', 'ikan'], nilai: 'Perikanan', ucap: 'Perikanan' },
	{ kata: ['pertambangan', 'tambang'], nilai: 'Pertambangan', ucap: 'Pertambangan' },
];

/* ----------------------------------------------------------- daftar maksud -- */

const DAFTAR_MAKSUD = [
	{
		id: 'status-desa',
		contoh: 'desa berstatus mandiri',
		cocok: (t) => adaSalahSatu(t, ['status desa', 'berstatus', 'desa mandiri', 'desa maju', 'desa berkembang'])
			&& NILAI_STATUS.some((s) => adaSalahSatu(t, s.kata)),
		jalankan: async (t) => {
			const pilih = NILAI_STATUS.find((s) => adaSalahSatu(t, s.kata));
			return cariProfilDesa({
				kolom: 'status_desa', nilai: pilih.nilai,
				labelKolom: 'Status desa', labelNilai: pilih.ucap,
			});
		},
	},
	{
		id: 'klasifikasi-desa',
		contoh: 'desa swakarya',
		cocok: (t) => NILAI_KLASIFIKASI.some((s) => adaSalahSatu(t, s.kata)),
		jalankan: async (t) => {
			const pilih = NILAI_KLASIFIKASI.find((s) => adaSalahSatu(t, s.kata));
			return cariProfilDesa({
				kolom: 'klasifikasi_desa', nilai: pilih.nilai,
				labelKolom: 'Klasifikasi', labelNilai: pilih.ucap,
			});
		},
	},
	{
		id: 'tipologi-desa',
		contoh: 'desa bertipologi persawahan',
		cocok: (t) => adaSalahSatu(t, ['tipologi']) || NILAI_TIPOLOGI.some((s) => adaSalahSatu(t, s.kata)),
		jalankan: async (t) => {
			const pilih = NILAI_TIPOLOGI.find((s) => adaSalahSatu(t, s.kata));
			if (!pilih) {
				return {
					kalimat: 'Tipologi desa yang tercatat ada persawahan, perkebunan, perindustrian, perladangan, perikanan, dan pertambangan. Sebutkan salah satu.',
					kolom: [], baris: [], total: 0,
				};
			}
			return cariProfilDesa({
				kolom: 'tipologi_desa', nilai: pilih.nilai,
				labelKolom: 'Tipologi', labelNilai: pilih.ucap,
			});
		},
	},
	{
		id: 'bumdes',
		contoh: 'bumdes aktif di kecamatan Cibinong',
		cocok: (t) => adaSalahSatu(t, ['bumdes', 'bum desa', 'badan usaha']),
		jalankan: async (t) => {
			const kec = await kecamatanDisebut(t);
			const mintaAktif = adaSalahSatu(t, ['aktif']) && !adaSalahSatu(t, ['tidak aktif', 'non aktif']);
			const mintaBadanHukum = adaSalahSatu(t, ['badan hukum', 'berbadan hukum', 'sertifikat']);

			const where = {};
			if (kec) where.kecamatan = { contains: kec.nama };
			if (mintaAktif) where.status = 'aktif';
			if (mintaBadanHukum) where.badanhukum = { contains: 'Terbit' };

			const baris = await prisma.bumdes.findMany({
				where,
				select: { namabumdesa: true, desa: true, kecamatan: true, status: true, badanhukum: true },
				orderBy: [{ kecamatan: 'asc' }, { desa: 'asc' }],
				take: 500,
			});

			const sifat = [
				mintaAktif ? 'berstatus aktif' : null,
				mintaBadanHukum ? 'sudah terbit badan hukum' : null,
				kec ? `di Kecamatan ${kec.nama}` : null,
			].filter(Boolean).join(' dan ');

			return {
				kalimat: baris.length
					? `Ditemukan ${nf.format(baris.length)} BUM Desa${sifat ? ' ' + sifat : ''}.`
					: `Tidak ada BUM Desa${sifat ? ' ' + sifat : ''} di data yang tercatat.`,
				kolom: [
					{ kunci: 'nama', label: 'BUM Desa' },
					{ kunci: 'desa', label: 'Desa' },
					{ kunci: 'kecamatan', label: 'Kecamatan' },
					{ kunci: 'status', label: 'Status' },
				],
				baris: baris.map((b) => ({
					nama: b.namabumdesa, desa: b.desa, kecamatan: b.kecamatan, status: b.status,
				})),
				total: baris.length,
			};
		},
	},
	{
		id: 'aparatur',
		contoh: 'aparatur desa di kecamatan Ciawi',
		cocok: (t) => adaSalahSatu(t, ['aparatur', 'perangkat desa', 'kaur', 'kepala desa']),
		jalankan: async (t) => {
			const kec = await kecamatanDisebut(t);
			const where = {};
			if (kec) where.desas = { kecamatan_id: kec.id };

			const [jumlah, baris] = await Promise.all([
				prisma.aparatur_desa.count({ where }),
				prisma.aparatur_desa.findMany({
					where,
					select: {
						nama_lengkap: true, jabatan: true, status: true,
						desas: { select: { nama: true, kecamatans: { select: { nama: true } } } },
					},
					orderBy: { nama_lengkap: 'asc' },
					take: 300,
				}),
			]);

			return {
				kalimat: `Ada ${nf.format(jumlah)} aparatur desa${kec ? ` di Kecamatan ${kec.nama}` : ' se-Kabupaten Bogor'}.`
					+ (jumlah > baris.length ? ` Ditampilkan ${nf.format(baris.length)} teratas.` : ''),
				kolom: [
					{ kunci: 'nama', label: 'Nama' },
					{ kunci: 'jabatan', label: 'Jabatan' },
					{ kunci: 'desa', label: 'Desa' },
					{ kunci: 'kecamatan', label: 'Kecamatan' },
				],
				baris: baris.map((a) => ({
					nama: a.nama_lengkap,
					jabatan: a.jabatan,
					desa: a.desas?.nama || '—',
					kecamatan: a.desas?.kecamatans?.nama || '—',
				})),
				total: jumlah,
			};
		},
	},
	{
		id: 'produk-hukum',
		contoh: 'berapa produk hukum desa',
		cocok: (t) => adaSalahSatu(t, ['produk hukum', 'perdes', 'peraturan desa', 'perkades']),
		jalankan: async () => {
			const perJenis = await prisma.produk_hukums.groupBy({
				by: ['singkatan_jenis'], _count: { id: true },
			});
			const total = perJenis.reduce((t, r) => t + r._count.id, 0);
			return {
				kalimat: `Tercatat ${nf.format(total)} produk hukum desa, terbagi dalam ${perJenis.length} jenis.`,
				kolom: [
					{ kunci: 'jenis', label: 'Jenis' },
					{ kunci: 'jumlah', label: 'Jumlah' },
				],
				baris: perJenis
					.map((r) => ({ jenis: r.singkatan_jenis, jumlah: nf.format(r._count.id) }))
					.sort((a, b) => a.jenis.localeCompare(b.jenis)),
				total,
			};
		},
	},
	{
		id: 'jumlah-desa',
		contoh: 'berapa jumlah desa di Kabupaten Bogor',
		cocok: (t) => adaSalahSatu(t, ['jumlah desa', 'berapa desa', 'total desa', 'daftar kecamatan']),
		jalankan: async (t) => {
			const kec = await kecamatanDisebut(t);
			if (kec) {
				const baris = await prisma.desas.findMany({
					where: { kecamatan_id: kec.id },
					select: { nama: true, kode: true, status_pemerintahan: true },
					orderBy: { nama: 'asc' },
				});
				return {
					kalimat: `Kecamatan ${kec.nama} punya ${nf.format(baris.length)} desa atau kelurahan.`,
					kolom: [
						{ kunci: 'nama', label: 'Desa' },
						{ kunci: 'kode', label: 'Kode' },
						{ kunci: 'status', label: 'Status' },
					],
					baris: baris.map((d) => ({ nama: d.nama, kode: d.kode, status: d.status_pemerintahan })),
					total: baris.length,
				};
			}

			const perKecamatan = await prisma.desas.groupBy({ by: ['kecamatan_id'], _count: { id: true } });
			const kecamatan = await prisma.kecamatans.findMany({ select: { id: true, nama: true } });
			const nama = new Map(kecamatan.map((k) => [String(k.id), k.nama]));
			const total = perKecamatan.reduce((t, r) => t + r._count.id, 0);
			return {
				kalimat: `Kabupaten Bogor punya ${nf.format(total)} desa dan kelurahan, tersebar di ${kecamatan.length} kecamatan.`,
				kolom: [
					{ kunci: 'kecamatan', label: 'Kecamatan' },
					{ kunci: 'jumlah', label: 'Jumlah Desa' },
				],
				baris: perKecamatan
					.map((r) => ({ kecamatan: nama.get(String(r.kecamatan_id)) || '—', jumlah: r._count.id }))
					.sort((a, b) => b.jumlah - a.jumlah)
					.map((r) => ({ ...r, jumlah: nf.format(r.jumlah) })),
				total,
			};
		},
	},
];

const cariMaksud = (teks) => DAFTAR_MAKSUD.find((m) => m.cocok(teks)) || null;

/* ------------------------------------------------------------------- rute -- */

/** POST /api/gema/tanya  { teks } */
const tanya = async (req, res) => {
	const teksAsli = String(req.body?.teks || '').trim();
	if (!teksAsli) {
		return res.status(400).json({ success: false, message: 'Tidak ada yang ditanyakan' });
	}

	try {
		const teks = bersihkan(teksAsli);
		const maksud = cariMaksud(teks);

		if (!maksud) {
			return res.json({
				success: true,
				data: {
					maksud: 'tidak-dikenali',
					kalimat: 'Maaf, saya belum mengerti pertanyaan itu. Coba tanyakan tentang status desa, BUM Desa, aparatur, produk hukum, atau jumlah desa.',
					kolom: [], baris: [], total: 0,
					saran: DAFTAR_MAKSUD.map((m) => m.contoh),
				},
			});
		}

		const hasil = await maksud.jalankan(teks);
		return res.json({ success: true, data: { maksud: maksud.id, ...hasil } });
	} catch (error) {
		logger.error('Gema gagal menjawab:', error);
		return res.status(500).json({
			success: false,
			message: 'Gema gagal mengambil datanya',
			error: error.message,
		});
	}
};

/** GET /api/gema/kemampuan — dipakai halaman untuk menampilkan contoh perintah. */
const kemampuan = (req, res) =>
	res.json({
		success: true,
		data: DAFTAR_MAKSUD.map((m) => ({ id: m.id, contoh: m.contoh })),
	});

module.exports = { tanya, kemampuan, bersihkan, cariMaksud };
