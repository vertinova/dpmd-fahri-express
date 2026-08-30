/**
 * Mesin pencari Gema.
 *
 * Menggantikan daftar maksud tetap yang sebelumnya cuma bisa menjawab tujuh
 * pertanyaan yang ditulis di kode. Sekarang jalannya terbalik: kalimatnya
 * dibedah dulu — entitas apa yang disebut, topik apa yang dimaksud, dan apakah
 * yang diminta angka atau daftar — baru datanya diambil.
 *
 * TIGA LAPIS, dari yang paling pasti ke yang paling longgar:
 *
 *   1. ENTITAS TUNGGAL. Menyebut satu nama desa, kecamatan, atau BUM Desa
 *      mengembalikan rapor lengkap tentangnya. Ini yang membuat "Cijayanti"
 *      saja sudah cukup jadi pertanyaan.
 *   2. DAFTAR TERSARING. Topik + penyaring: "bumdes aktif di Jonggol",
 *      "kepala desa di Cibungbulang", "desa berstatus mandiri".
 *   3. PENCARIAN MENYELURUH. Kalau dua lapis di atas tidak mengena, katanya
 *      dicari ke seluruh nama yang ada — desa, BUM Desa, aparatur, produk
 *      hukum — lalu hasilnya dikelompokkan. Inilah yang membuat "apa saja"
 *      benar-benar berarti apa saja.
 *
 * YANG SENGAJA TIDAK DIPAKAI: model bahasa. Jawaban Gema harus bisa
 * dipertanggungjawabkan baris per baris ke basis data, dan data desa di sini
 * bukan milik kami untuk dikirim ke layanan luar. Kalau nanti diputuskan
 * memakai model, seluruh penangan di bawah ini tetap terpakai sebagai alat yang
 * boleh dipanggilnya — yang berubah cuma cara memilih alatnya.
 */

const prisma = require('../config/prisma');
const { muatKamus } = require('./gemaKamus.service');

const nf = new Intl.NumberFormat('id-ID');

const BATAS_BARIS = 300;

/* ------------------------------------------------------------------ bantu -- */

const bersihkan = (teks) =>
	String(teks || '')
		.toLowerCase()
		.replace(/[^\w\s]/g, ' ')
		.replace(/\b(halo|hai|hei|hallo|hey|oke|ok)\s+(gema|gemma|gima|jema)\b/g, ' ')
		.replace(/\b(gema|gemma)\b/g, ' ')
		.replace(/\b(tolong|coba|saya|aku|ingin|mau|minta|carikan|cari|tampilkan|lihat|data|datanya|dong|ya)\b/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();

const punya = (t, kata) => kata.some((k) => t.includes(k));

const rupiah = (n) => (n === null || n === undefined ? '—' : `Rp ${nf.format(Math.round(Number(n)))}`);

/** Cocokkan kamus ke dalam kalimat; yang namanya paling panjang menang. */
const cocokkan = (teks, daftar) => {
	let terbaik = null;
	for (const item of daftar) {
		if (!teks.includes(item.kunci)) continue;
		if (!terbaik || item.kunci.length > terbaik.kunci.length) terbaik = item;
	}
	return terbaik;
};

/* --------------------------------------------------------------- analisis -- */

const TOPIK = [
	{ id: 'bumdes', kata: ['bumdes', 'bum desa', 'badan usaha'] },
	{ id: 'aparatur', kata: ['aparatur', 'perangkat desa', 'kepala desa', 'sekretaris desa', 'bpd', 'kaur', 'kasi', 'kadus'] },
	{ id: 'produk-hukum', kata: ['produk hukum', 'perdes', 'peraturan desa', 'perkades', 'sk kades'] },
	{ id: 'desa', kata: ['desa', 'kelurahan', 'kecamatan'] },
];

const analisis = async (teksAsli) => {
	const teks = bersihkan(teksAsli);
	const kamus = await muatKamus();

	const kecamatan = cocokkan(teks, kamus.kecamatan);
	// Nama desa sering sama dengan nama kecamatannya (Cibinong, Jonggol).
	// Kalau keduanya cocok pada kata yang sama, yang dipakai kecamatannya —
	// pertanyaan "di Jonggol" hampir selalu berarti wilayahnya, bukan satu desa.
	const desaCocok = cocokkan(teks, kamus.desa);
	const desa = desaCocok && (!kecamatan || desaCocok.kunci !== kecamatan.kunci) ? desaCocok : null;

	const nilai = cocokkan(teks, kamus.nilai);
	const jabatan = cocokkan(teks, kamus.jabatan);

	let topik = null;
	for (const t of TOPIK) {
		if (punya(teks, t.kata)) { topik = t.id; break; }
	}
	if (!topik && jabatan) topik = 'aparatur';
	if (!topik && nilai) topik = 'desa';

	return {
		teks,
		kecamatan,
		desa,
		nilai,
		jabatan,
		topik,
		agregasi: punya(teks, ['berapa', 'jumlah', 'total', 'hitung', 'banyaknya']),
		mintaAktif: punya(teks, ['aktif']) && !punya(teks, ['tidak aktif', 'non aktif', 'nonaktif']),
		mintaBadanHukum: punya(teks, ['badan hukum', 'berbadan hukum', 'sertifikat']),
	};
};

/* -------------------------------------------------- lapis 1: entitas tunggal -- */

/** Rapor satu desa: profil, aparatur, BUM Desa, produk hukum. */
const raporDesa = async (desa) => {
	const [profil, jumlahAparatur, kades, bumdes, jumlahPh] = await Promise.all([
		prisma.profil_desas.findFirst({ where: { desa_id: desa.id } }),
		prisma.aparatur_desa.count({ where: { desa_id: desa.id } }),
		prisma.aparatur_desa.findFirst({
			where: { desa_id: desa.id, jabatan: { contains: 'KEPALA DESA' } },
			select: { nama_lengkap: true },
		}),
		prisma.bumdes.findFirst({
			where: { desa_id: Number(desa.id) },
			select: { namabumdesa: true, status: true, badanhukum: true, NilaiAset: true, Omset2025: true },
		}),
		prisma.produk_hukums.count({ where: { desa_id: desa.id } }),
	]);

	const rincian = [
		{ label: 'Kecamatan', nilai: desa.kecamatan || '—' },
		{ label: 'Kode desa', nilai: desa.kode || '—' },
		{ label: 'Status desa', nilai: profil?.status_desa || 'Belum terdata' },
		{ label: 'Klasifikasi', nilai: profil?.klasifikasi_desa || 'Belum terdata' },
		{ label: 'Tipologi', nilai: profil?.tipologi_desa || 'Belum terdata' },
		{ label: 'Jumlah penduduk', nilai: profil?.jumlah_penduduk ? nf.format(profil.jumlah_penduduk) : 'Belum terdata' },
		{ label: 'Kepala desa', nilai: kades?.nama_lengkap || 'Belum terdata' },
		{ label: 'Aparatur terdaftar', nilai: nf.format(jumlahAparatur) },
		{ label: 'BUM Desa', nilai: bumdes?.namabumdesa || 'Belum ada' },
		{ label: 'Status BUM Desa', nilai: bumdes?.status || '—' },
		{ label: 'Badan hukum BUM Desa', nilai: bumdes?.badanhukum || '—' },
		{ label: 'Produk hukum', nilai: `${nf.format(jumlahPh)} dokumen` },
	];

	return {
		maksud: 'rapor-desa',
		kalimat: `Desa ${desa.nama}, Kecamatan ${desa.kecamatan || '—'}.`
			+ (profil?.status_desa ? ` Berstatus ${profil.status_desa}.` : ' Status desanya belum terdata.')
			+ ` Ada ${nf.format(jumlahAparatur)} aparatur terdaftar`
			+ (bumdes?.namabumdesa ? ` dan BUM Desa bernama ${bumdes.namabumdesa}.` : ' dan belum punya BUM Desa.'),
		judul: `Desa ${desa.nama}`,
		rincian,
		kolom: [], baris: [], total: 0,
	};
};

/** Rapor satu kecamatan: jumlah desa, aparatur, BUM Desa, sebaran status. */
const raporKecamatan = async (kec) => {
	const [jumlahDesa, jumlahAparatur, jumlahBumdes, bumdesAktif, statusDesa] = await Promise.all([
		prisma.desas.count({ where: { kecamatan_id: kec.id } }),
		prisma.aparatur_desa.count({ where: { desas: { kecamatan_id: kec.id } } }),
		prisma.bumdes.count({ where: { kecamatan: { contains: kec.nama } } }),
		prisma.bumdes.count({ where: { kecamatan: { contains: kec.nama }, status: 'aktif' } }),
		prisma.profil_desas.groupBy({
			by: ['status_desa'],
			where: { desas: { kecamatan_id: kec.id } },
			_count: { id: true },
		}),
	]);

	return {
		maksud: 'rapor-kecamatan',
		kalimat: `Kecamatan ${kec.nama} punya ${nf.format(jumlahDesa)} desa, `
			+ `${nf.format(jumlahAparatur)} aparatur terdaftar, dan ${nf.format(jumlahBumdes)} BUM Desa `
			+ `(${nf.format(bumdesAktif)} aktif).`,
		judul: `Kecamatan ${kec.nama}`,
		rincian: [
			{ label: 'Jumlah desa', nilai: nf.format(jumlahDesa) },
			{ label: 'Aparatur terdaftar', nilai: nf.format(jumlahAparatur) },
			{ label: 'BUM Desa', nilai: nf.format(jumlahBumdes) },
			{ label: 'BUM Desa aktif', nilai: nf.format(bumdesAktif) },
			...statusDesa
				.filter((s) => s.status_desa)
				.map((s) => ({ label: s.status_desa, nilai: `${nf.format(s._count.id)} desa` })),
		],
		kolom: [], baris: [], total: 0,
	};
};

/* ------------------------------------------------ lapis 2: daftar tersaring -- */

const daftarDesa = async (a) => {
	const where = {};
	if (a.nilai) where[a.nilai.kolom] = { contains: a.nilai.nilai };
	if (a.kecamatan) where.desas = { kecamatan_id: a.kecamatan.id };

	// Jumlah dihitung terpisah dari baris yang ditampilkan. Memakai panjang
	// array sebagai total membuat batas tampilan menyamar jadi fakta: "300 desa"
	// padahal itu cuma BATAS_BARIS.
	const [jumlah, baris] = await Promise.all([
		prisma.profil_desas.count({ where }),
		prisma.profil_desas.findMany({
			where,
			select: {
				status_desa: true, klasifikasi_desa: true, tipologi_desa: true,
				desas: { select: { nama: true, kecamatans: { select: { nama: true } } } },
			},
			take: BATAS_BARIS,
		}),
	]);

	const isi = baris
		.filter((b) => b.desas)
		.map((b) => ({
			desa: b.desas.nama,
			kecamatan: b.desas.kecamatans?.nama || '—',
			status: b.status_desa || '—',
			klasifikasi: b.klasifikasi_desa || '—',
			tipologi: b.tipologi_desa || '—',
		}))
		.sort((x, y) => x.kecamatan.localeCompare(y.kecamatan, 'id') || x.desa.localeCompare(y.desa, 'id'));

	// "status desa Desa Mandiri" terbaca janggal saat diucapkan. Awalan "Desa "
	// pada nilainya dibuang dan labelnya diubah jadi bentuk berimbuhan.
	const KATA_SIFAT = {
		status_desa: 'berstatus',
		klasifikasi_desa: 'berklasifikasi',
		tipologi_desa: 'bertipologi',
	};
	const sifat = [
		a.nilai
			? `${KATA_SIFAT[a.nilai.kolom] || 'dengan'} ${a.nilai.nilai.replace(/^Desa\s+/i, '')}`
			: null,
		a.kecamatan ? `di Kecamatan ${a.kecamatan.nama}` : null,
	].filter(Boolean).join(' ');

	return {
		maksud: 'daftar-desa',
		kalimat: jumlah
			? `Ada ${nf.format(jumlah)} desa ${sifat || 'yang terdata'}.`
				+ (jumlah > isi.length ? ` Ditampilkan ${nf.format(isi.length)} teratas.` : '')
			: `Tidak ada desa ${sifat || ''} di data yang tercatat.`,
		kolom: [
			{ kunci: 'desa', label: 'Desa' },
			{ kunci: 'kecamatan', label: 'Kecamatan' },
			{ kunci: 'status', label: 'Status' },
			{ kunci: 'klasifikasi', label: 'Klasifikasi' },
			{ kunci: 'tipologi', label: 'Tipologi' },
		],
		baris: isi,
		total: jumlah,
	};
};

const daftarBumdes = async (a) => {
	const where = {};
	if (a.kecamatan) where.kecamatan = { contains: a.kecamatan.nama };
	if (a.desa) where.desa = { contains: a.desa.nama };
	if (a.mintaAktif) where.status = 'aktif';
	if (a.mintaBadanHukum) where.badanhukum = { contains: 'Terbit' };

	const [jumlah, baris] = await Promise.all([
		prisma.bumdes.count({ where }),
		prisma.bumdes.findMany({
			where,
			select: {
				namabumdesa: true, desa: true, kecamatan: true, status: true,
				badanhukum: true, NilaiAset: true, Omset2025: true,
			},
			orderBy: [{ kecamatan: 'asc' }, { desa: 'asc' }],
			take: BATAS_BARIS,
		}),
	]);

	const sifat = [
		a.mintaAktif ? 'berstatus aktif' : null,
		a.mintaBadanHukum ? 'sudah terbit badan hukum' : null,
		a.kecamatan ? `di Kecamatan ${a.kecamatan.nama}` : null,
		a.desa ? `di Desa ${a.desa.nama}` : null,
	].filter(Boolean).join(' dan ');

	return {
		maksud: 'daftar-bumdes',
		kalimat: jumlah
			? `Ditemukan ${nf.format(jumlah)} BUM Desa${sifat ? ' ' + sifat : ''}.`
				+ (jumlah > baris.length ? ` Ditampilkan ${nf.format(baris.length)} teratas.` : '')
			: `Tidak ada BUM Desa${sifat ? ' ' + sifat : ''} di data yang tercatat.`,
		kolom: [
			{ kunci: 'nama', label: 'BUM Desa' },
			{ kunci: 'desa', label: 'Desa' },
			{ kunci: 'kecamatan', label: 'Kecamatan' },
			{ kunci: 'status', label: 'Status' },
			{ kunci: 'badan_hukum', label: 'Badan Hukum' },
			{ kunci: 'aset', label: 'Aset' },
		],
		baris: baris.map((b) => ({
			nama: b.namabumdesa, desa: b.desa, kecamatan: b.kecamatan,
			status: b.status, badan_hukum: b.badanhukum || '—',
			aset: b.NilaiAset ? rupiah(b.NilaiAset) : '—',
		})),
		total: jumlah,
	};
};

const daftarAparatur = async (a) => {
	const where = {};
	if (a.kecamatan) where.desas = { kecamatan_id: a.kecamatan.id };
	if (a.desa) where.desa_id = a.desa.id;
	if (a.jabatan) where.jabatan = { contains: a.jabatan.nama };

	const [jumlah, baris] = await Promise.all([
		prisma.aparatur_desa.count({ where }),
		prisma.aparatur_desa.findMany({
			where,
			select: {
				nama_lengkap: true, jabatan: true, status: true,
				desas: { select: { nama: true, kecamatans: { select: { nama: true } } } },
			},
			orderBy: { nama_lengkap: 'asc' },
			take: BATAS_BARIS,
		}),
	]);

	const sifat = [
		a.jabatan ? `berjabatan ${a.jabatan.nama}` : null,
		a.kecamatan ? `di Kecamatan ${a.kecamatan.nama}` : null,
		a.desa ? `di Desa ${a.desa.nama}` : null,
	].filter(Boolean).join(' ');

	return {
		maksud: 'daftar-aparatur',
		kalimat: `Ada ${nf.format(jumlah)} aparatur ${sifat || 'se-Kabupaten Bogor'}.`
			+ (jumlah > baris.length ? ` Ditampilkan ${nf.format(baris.length)} teratas.` : ''),
		kolom: [
			{ kunci: 'nama', label: 'Nama' },
			{ kunci: 'jabatan', label: 'Jabatan' },
			{ kunci: 'desa', label: 'Desa' },
			{ kunci: 'kecamatan', label: 'Kecamatan' },
		],
		baris: baris.map((r) => ({
			nama: r.nama_lengkap,
			jabatan: r.jabatan,
			desa: r.desas?.nama || '—',
			kecamatan: r.desas?.kecamatans?.nama || '—',
		})),
		total: jumlah,
	};
};

const daftarProdukHukum = async (a) => {
	const where = {};
	if (a.desa) where.desa_id = a.desa.id;
	else if (a.kecamatan) where.desas = { kecamatan_id: a.kecamatan.id };

	if (a.agregasi && !a.desa && !a.kecamatan) {
		const perJenis = await prisma.produk_hukums.groupBy({
			by: ['singkatan_jenis'], _count: { id: true },
		});
		const total = perJenis.reduce((t, r) => t + r._count.id, 0);
		return {
			maksud: 'produk-hukum-ringkas',
			kalimat: `Tercatat ${nf.format(total)} produk hukum desa dalam ${perJenis.length} jenis.`,
			kolom: [{ kunci: 'jenis', label: 'Jenis' }, { kunci: 'jumlah', label: 'Jumlah' }],
			baris: perJenis.map((r) => ({ jenis: r.singkatan_jenis, jumlah: nf.format(r._count.id) })),
			total,
		};
	}

	const [jumlah, baris] = await Promise.all([
		prisma.produk_hukums.count({ where }),
		prisma.produk_hukums.findMany({
			where,
			select: {
				judul: true, nomor: true, tahun: true, singkatan_jenis: true, status_peraturan: true,
				desas: { select: { nama: true, kecamatans: { select: { nama: true } } } },
			},
			orderBy: [{ tahun: 'desc' }],
			take: BATAS_BARIS,
		}),
	]);

	const sifat = [
		a.desa ? `Desa ${a.desa.nama}` : null,
		!a.desa && a.kecamatan ? `Kecamatan ${a.kecamatan.nama}` : null,
	].filter(Boolean).join(' ');

	return {
		maksud: 'daftar-produk-hukum',
		kalimat: `Ada ${nf.format(jumlah)} produk hukum${sifat ? ' di ' + sifat : ''}.`
			+ (jumlah > baris.length ? ` Ditampilkan ${nf.format(baris.length)} terbaru.` : ''),
		kolom: [
			{ kunci: 'jenis', label: 'Jenis' },
			{ kunci: 'nomor', label: 'Nomor' },
			{ kunci: 'tahun', label: 'Tahun' },
			{ kunci: 'judul', label: 'Judul' },
			{ kunci: 'desa', label: 'Desa' },
		],
		baris: baris.map((r) => ({
			jenis: r.singkatan_jenis, nomor: r.nomor, tahun: r.tahun,
			judul: r.judul, desa: r.desas?.nama || '—',
		})),
		total: jumlah,
	};
};

/* ------------------------------------------ lapis 3: pencarian menyeluruh -- */

/**
 * Cari kata apa pun ke seluruh nama yang ada di sistem, lalu kelompokkan.
 * Inilah yang membuat "cari apa saja" benar-benar berarti apa saja: nama orang,
 * nama BUM Desa, judul peraturan, nama desa — semuanya satu jalur.
 */
const pencarianMenyeluruh = async (kataAsli) => {
	const kata = kataAsli.trim();
	if (kata.length < 3) {
		return {
			maksud: 'terlalu-pendek',
			kalimat: 'Kata pencariannya terlalu pendek. Sebutkan setidaknya tiga huruf.',
			kolom: [], baris: [], total: 0,
		};
	}

	const [desa, bumdes, aparatur, produkHukum] = await Promise.all([
		prisma.desas.findMany({
			where: { nama: { contains: kata } },
			select: { nama: true, kecamatans: { select: { nama: true } } },
			take: 25,
		}),
		prisma.bumdes.findMany({
			where: { namabumdesa: { contains: kata } },
			select: { namabumdesa: true, desa: true, kecamatan: true },
			take: 25,
		}),
		prisma.aparatur_desa.findMany({
			where: { nama_lengkap: { contains: kata } },
			select: {
				nama_lengkap: true, jabatan: true,
				desas: { select: { nama: true, kecamatans: { select: { nama: true } } } },
			},
			take: 25,
		}),
		prisma.produk_hukums.findMany({
			where: { OR: [{ judul: { contains: kata } }, { nomor: { contains: kata } }] },
			select: { judul: true, nomor: true, tahun: true, desas: { select: { nama: true } } },
			take: 25,
		}),
	]);

	const baris = [
		...desa.map((d) => ({
			jenis: 'Desa', nama: d.nama,
			keterangan: `Kecamatan ${d.kecamatans?.nama || '—'}`,
		})),
		...bumdes.map((b) => ({
			jenis: 'BUM Desa', nama: b.namabumdesa,
			keterangan: `${b.desa || '—'}, Kec. ${b.kecamatan || '—'}`,
		})),
		...aparatur.map((a) => ({
			jenis: 'Aparatur', nama: a.nama_lengkap,
			keterangan: `${a.jabatan} · ${a.desas?.nama || '—'}`,
		})),
		...produkHukum.map((p) => ({
			jenis: 'Produk Hukum', nama: p.judul,
			keterangan: `Nomor ${p.nomor} tahun ${p.tahun} · ${p.desas?.nama || '—'}`,
		})),
	];

	const ringkas = [
		desa.length ? `${desa.length} desa` : null,
		bumdes.length ? `${bumdes.length} BUM Desa` : null,
		aparatur.length ? `${aparatur.length} aparatur` : null,
		produkHukum.length ? `${produkHukum.length} produk hukum` : null,
	].filter(Boolean).join(', ');

	return {
		maksud: 'pencarian-menyeluruh',
		kalimat: baris.length
			? `Ditemukan ${ringkas} yang cocok dengan "${kata}".`
			: `Tidak ada data yang cocok dengan "${kata}".`,
		kolom: [
			{ kunci: 'jenis', label: 'Jenis' },
			{ kunci: 'nama', label: 'Nama' },
			{ kunci: 'keterangan', label: 'Keterangan' },
		],
		baris,
		total: baris.length,
	};
};

/* ------------------------------------------------------------------ utama -- */

const jawab = async (teksAsli) => {
	const a = await analisis(teksAsli);

	// LAPIS 1 — satu entitas disebut, tanpa topik lain dan tanpa penyaring.
	// "Cijayanti" atau "profil desa Cijayanti" cukup jadi pertanyaan utuh.
	const tanpaPenyaring = !a.nilai && !a.jabatan && !a.mintaAktif && !a.mintaBadanHukum;
	if (a.desa && tanpaPenyaring && (!a.topik || a.topik === 'desa')) return raporDesa(a.desa);
	if (a.kecamatan && !a.desa && tanpaPenyaring && (!a.topik || a.topik === 'desa') && !a.agregasi) {
		return raporKecamatan(a.kecamatan);
	}

	// LAPIS 2 — topik yang dikenali, disaring entitas dan nilai yang disebut.
	if (a.topik === 'bumdes') return daftarBumdes(a);
	if (a.topik === 'aparatur') return daftarAparatur(a);
	if (a.topik === 'produk-hukum') return daftarProdukHukum(a);
	if (a.topik === 'desa' || a.nilai) return daftarDesa(a);

	// LAPIS 3 — tidak ada yang dikenali; cari katanya ke mana-mana.
	return pencarianMenyeluruh(a.teks);
};

module.exports = { jawab, analisis, bersihkan, pencarianMenyeluruh };
