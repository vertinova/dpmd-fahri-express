/**
 * Kamus entitas untuk Gema.
 *
 * Supaya Gema bisa ditanyai apa saja, ia harus lebih dulu tahu KATA APA yang
 * merupakan nama sesuatu di sistem ini. "Cibungbulang" itu kecamatan,
 * "Cijayanti" itu desa, "mandiri" itu nilai kolom status desa. Tanpa kamus ini
 * mesinnya cuma bisa mencocokkan kata kunci yang ditulis programmer sebelumnya
 * — dan itu yang membuatnya terasa kaku.
 *
 * Isinya diambil dari basis data, bukan ditulis tangan, jadi kecamatan atau desa
 * baru langsung dikenali tanpa menyentuh kode.
 *
 * Ditahan di memori lima menit. Empat ratus tiga puluh lima nama desa dan empat
 * puluh kecamatan itu kecil; mengambilnya ulang tiap pertanyaan hanya menambah
 * satu perjalanan ke basis data untuk data yang praktis tidak pernah berubah.
 */

const prisma = require('../config/prisma');

const UMUR_KAMUS_MS = 5 * 60 * 1000;
let kamus = null;
let kadaluwarsa = 0;

/** Nilai kolom yang berperilaku seperti pilihan tetap, beserta tabel asalnya. */
const NILAI_KOLOM = [
	{ topik: 'desa', kolom: 'status_desa', label: 'Status desa' },
	{ topik: 'desa', kolom: 'klasifikasi_desa', label: 'Klasifikasi desa' },
	{ topik: 'desa', kolom: 'tipologi_desa', label: 'Tipologi desa' },
];

const bersihNama = (n) => String(n || '').trim();

const muatKamus = async () => {
	if (kamus && Date.now() < kadaluwarsa) return kamus;

	const [kecamatans, desas, statusDesa, klasifikasi, tipologi, jabatan] = await Promise.all([
		prisma.kecamatans.findMany({ select: { id: true, nama: true } }),
		prisma.desas.findMany({
			select: { id: true, nama: true, kode: true, kecamatan_id: true },
		}),
		prisma.profil_desas.findMany({ distinct: ['status_desa'], select: { status_desa: true } }),
		prisma.profil_desas.findMany({ distinct: ['klasifikasi_desa'], select: { klasifikasi_desa: true } }),
		prisma.profil_desas.findMany({ distinct: ['tipologi_desa'], select: { tipologi_desa: true } }),
		prisma.aparatur_desa.findMany({ distinct: ['jabatan'], select: { jabatan: true } }),
	]);

	const namaKecamatan = new Map(kecamatans.map((k) => [String(k.id), k.nama]));

	kamus = {
		kecamatan: kecamatans
			.map((k) => ({ id: k.id, nama: bersihNama(k.nama), kunci: bersihNama(k.nama).toLowerCase() }))
			.filter((k) => k.kunci.length > 2),

		desa: desas
			.map((d) => ({
				id: d.id,
				nama: bersihNama(d.nama),
				kode: d.kode,
				kecamatan: namaKecamatan.get(String(d.kecamatan_id)) || null,
				kecamatan_id: d.kecamatan_id,
				kunci: bersihNama(d.nama).toLowerCase(),
			}))
			.filter((d) => d.kunci.length > 2),

		// Nilai kolom digabung jadi satu daftar datar supaya pencocokannya sekali
		// jalan; tiap entri tetap membawa kolom asalnya.
		// Tiap nilai didaftarkan dengan BEBERAPA kunci pencocokan, bukan satu.
		// Nilai aslinya berbunyi "Desa Mandiri", tapi orang mengucapkan "desa
		// BERSTATUS mandiri" — substringnya tidak akan pernah cocok. Karena itu
		// awalan "desa " ikut didaftarkan dalam bentuk telanjangnya.
		nilai: [
			...statusDesa.map((r) => ({ kolom: 'status_desa', nilai: r.status_desa, label: 'Status desa' })),
			...klasifikasi.map((r) => ({ kolom: 'klasifikasi_desa', nilai: r.klasifikasi_desa, label: 'Klasifikasi' })),
			...tipologi.map((r) => ({ kolom: 'tipologi_desa', nilai: r.tipologi_desa, label: 'Tipologi' })),
		]
			.filter((r) => bersihNama(r.nilai))
			.flatMap((r) => {
				const nilai = bersihNama(r.nilai);
				const penuh = nilai.toLowerCase();
				const telanjang = penuh.replace(/^desa\s+/, '');
				const kunciUnik = telanjang !== penuh ? [penuh, telanjang] : [penuh];
				return kunciUnik.map((kunci) => ({ ...r, nilai, kunci }));
			}),

		jabatan: jabatan
			.map((r) => bersihNama(r.jabatan))
			.filter(Boolean)
			.map((j) => ({ nama: j, kunci: j.toLowerCase() })),
	};

	kadaluwarsa = Date.now() + UMUR_KAMUS_MS;
	return kamus;
};

/** Dipanggil bila ada perubahan data induk supaya kamusnya tidak basi. */
const kosongkanKamus = () => { kamus = null; kadaluwarsa = 0; };

module.exports = { muatKamus, kosongkanKamus, NILAI_KOLOM };
