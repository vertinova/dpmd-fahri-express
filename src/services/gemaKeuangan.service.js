/**
 * Keuangan desa untuk Gema: ADD, DD, BHPRD, Bankeu, dan BP.
 *
 * Sumbernya BUKAN tabel lokal melainkan API SIPANDA Kabupaten Bogor, lewat
 * sipanda.service yang sudah menyimpan hasilnya lima menit di memori. Itu sebabnya
 * penanganan keuangan dipisah dari gemaMesin.service: yang lain menanyai basis
 * data sendiri dan pasti cepat, yang ini menyeberang jaringan dan bisa gagal.
 *
 * KALAU SIPANDA TIDAK BISA DIHUBUNGI, Gema mengatakannya apa adanya. Menebak
 * angka penyaluran dana desa adalah hal terakhir yang boleh dilakukan alat ini.
 */

const { fetchSipandaRows, SIPANDA_TAHUN } = require('./sipanda.service');

const nf = new Intl.NumberFormat('id-ID');

const rupiahRingkas = (n) => {
	const v = Number(n) || 0;
	if (Math.abs(v) >= 1e12) return `Rp ${(v / 1e12).toFixed(2).replace('.', ',')} triliun`;
	if (Math.abs(v) >= 1e9) return `Rp ${(v / 1e9).toFixed(2).replace('.', ',')} miliar`;
	if (Math.abs(v) >= 1e6) return `Rp ${(v / 1e6).toFixed(0)} juta`;
	return `Rp ${nf.format(Math.round(v))}`;
};

/**
 * Nama sumber dana di SIPANDA ditulis panjang dan tidak seragam
 * ("DD REGULER", "BANKEU AKSELERASI PEDESAAN"). Di sini dipetakan ke sebutan
 * yang dipakai orang saat bertanya.
 */
const SUMBER = [
	{ id: 'ADD', kata: ['add', 'alokasi dana desa'], label: 'ADD', cocok: (s) => s === 'ADD' },
	{ id: 'DD', kata: ['dd', 'dana desa'], label: 'Dana Desa', cocok: (s) => s.startsWith('DD') },
	{ id: 'BHPRD', kata: ['bhprd', 'bagi hasil'], label: 'BHPRD', cocok: (s) => s === 'BHPRD' },
	{ id: 'BANKEU', kata: ['bankeu', 'akselerasi'], label: 'Bankeu Akselerasi', cocok: (s) => s.startsWith('BANKEU') },
	{ id: 'BP', kata: ['bp', 'bantuan provinsi'], label: 'Bantuan Provinsi', cocok: (s) => s === 'BP' },
];

const sudahCair = (r) => String(r.sudah_cair).toUpperCase() === 'Y';

/**
 * SIPANDA menulis nama desa dan kecamatan dengan huruf kapital semua
 * ("SINGAJAYA"). Di layar itu terlihat berteriak, dan sebagian pembaca suara
 * mengejanya huruf per huruf. Dijadikan Huruf Judul agar sama dengan penulisan
 * nama di seluruh aplikasi.
 */
const ROMAWI = /^(I{1,3}|IV|VI{0,3}|IX|XI{0,2})$/;

const hurufJudul = (t) => String(t || '')
	.split(/\s+/)
	.map((kata) => {
		// Angka Romawi tetap kapital: "TAHAP II" jangan jadi "Tahap Ii".
		if (ROMAWI.test(kata.toUpperCase())) return kata.toUpperCase();
		return kata.charAt(0).toUpperCase() + kata.slice(1).toLowerCase();
	})
	.join(' ');

/**
 * Jawab pertanyaan keuangan desa.
 *
 * @param {object} a hasil analisis: { teks, desa, kecamatan, sumberDana }
 */
const jawabKeuangan = async (a) => {
	let baris;
	try {
		baris = await fetchSipandaRows({});
	} catch (e) {
		return {
			maksud: 'keuangan-gagal',
			kalimat: 'Aduh, data penyaluran dari SIPANDA lagi tidak bisa saya ambil sekarang. '
				+ 'Coba lagi sebentar lagi ya.',
			kolom: [], baris: [], total: 0,
		};
	}

	const sumber = a.sumberDana || null;

	// Penyaring wilayah. Nama di SIPANDA huruf besar semua, jadi dibandingkan
	// dalam huruf kecil di kedua sisi.
	const kecil = (v) => String(v || '').toLowerCase();
	let saring = baris;
	if (sumber) saring = saring.filter((r) => sumber.cocok(String(r.sumber_dana || '')));
	if (a.desa) saring = saring.filter((r) => kecil(r.desa) === kecil(a.desa.nama));
	else if (a.kecamatan) saring = saring.filter((r) => kecil(r.kecamatan) === kecil(a.kecamatan.nama));

	if (!saring.length) {
		return {
			maksud: 'keuangan-kosong',
			kalimat: `Belum ada catatan penyaluran ${sumber ? sumber.label : 'dana desa'} `
				+ `${a.desa ? `untuk Desa ${a.desa.nama}` : a.kecamatan ? `di Kecamatan ${a.kecamatan.nama}` : ''} `
				+ `tahun ${SIPANDA_TAHUN}.`,
			kolom: [], baris: [], total: 0,
		};
	}

	const totalAnggaran = saring.reduce((t, r) => t + (Number(r.anggaran) || 0), 0);
	const barisCair = saring.filter(sudahCair);
	const anggaranCair = barisCair.reduce((t, r) => t + (Number(r.anggaran) || 0), 0);
	const jumlahDesa = new Set(saring.map((r) => r.desa)).size;

	// Dikelompokkan per sumber dana bila pertanyaannya tidak menyebut satu pun,
	// atau per desa bila sudah mengerucut ke satu kecamatan.
	const kelompokPerSumber = !sumber;
	const peta = new Map();
	for (const r of saring) {
		const kunci = kelompokPerSumber
			? String(r.sumber_dana || '—')
			: (a.kecamatan && !a.desa ? String(r.desa || '—') : String(r.nm_tahap || r.periode || '—'));
		const p = peta.get(kunci) || { kunci, anggaran: 0, cair: 0, tahap: 0, tahapCair: 0 };
		p.anggaran += Number(r.anggaran) || 0;
		p.tahap += 1;
		if (sudahCair(r)) { p.cair += Number(r.anggaran) || 0; p.tahapCair += 1; }
		peta.set(kunci, p);
	}

	const isi = [...peta.values()]
		.sort((x, y) => y.anggaran - x.anggaran)
		.map((p) => ({
			nama: hurufJudul(p.kunci),
			anggaran: rupiahRingkas(p.anggaran),
			cair: rupiahRingkas(p.cair),
			tahap: `${nf.format(p.tahapCair)} dari ${nf.format(p.tahap)}`,
		}));

	const dimana = a.desa
		? `Desa ${a.desa.nama}`
		: a.kecamatan ? `Kecamatan ${a.kecamatan.nama}` : 'Kabupaten Bogor';

	const persenCair = totalAnggaran > 0 ? Math.round((anggaranCair / totalAnggaran) * 100) : 0;

	// Contoh isi datanya TIDAK disebut di sini — pembungkus gaya bicara yang
	// menambahkannya. Menyebut dua kali membuat kalimatnya bertele-tele.

	return {
		maksud: 'keuangan-desa',
		judul: `${sumber ? sumber.label : 'Penyaluran Dana Desa'} · ${dimana} · ${SIPANDA_TAHUN}`,
		kalimat:
			`${sumber ? sumber.label : 'Dana desa'} untuk ${dimana} tahun ${SIPANDA_TAHUN} `
			+ `totalnya ${rupiahRingkas(totalAnggaran)}, yang sudah cair ${rupiahRingkas(anggaranCair)} `
			+ `atau sekitar ${persenCair} persen`
			+ (jumlahDesa > 1 ? `, tersebar di ${nf.format(jumlahDesa)} desa` : '')
			+ '.',
		rincian: [
			{ label: 'Total anggaran', nilai: rupiahRingkas(totalAnggaran) },
			{ label: 'Sudah cair', nilai: `${rupiahRingkas(anggaranCair)} (${persenCair}%)` },
			{ label: 'Belum cair', nilai: rupiahRingkas(totalAnggaran - anggaranCair) },
			{ label: 'Tahap tercatat', nilai: `${nf.format(barisCair.length)} dari ${nf.format(saring.length)} sudah cair` },
			{ label: 'Desa tercakup', nilai: nf.format(jumlahDesa) },
		],
		kolom: [
			{ kunci: 'nama', label: kelompokPerSumber ? 'Sumber Dana' : (a.kecamatan && !a.desa ? 'Desa' : 'Tahap') },
			{ kunci: 'anggaran', label: 'Anggaran' },
			{ kunci: 'cair', label: 'Sudah Cair' },
			{ kunci: 'tahap', label: 'Tahap Cair' },
		],
		baris: isi,
		total: isi.length,
	};
};

/** Sumber dana yang disebut dalam kalimat, bila ada. */
const sumberDanaDisebut = (kataUtuh, teks) =>
	SUMBER.find((s) => s.kata.some((k) => kataUtuh(teks, k))) || null;

module.exports = { jawabKeuangan, sumberDanaDisebut, SUMBER };
