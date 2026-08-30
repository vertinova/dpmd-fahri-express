/**
 * Profil lengkap satu objek untuk Gema.
 *
 * ATURAN YANG MENDASARINYA: kalau pertanyaan mengerucut ke SATU hal, jawabannya
 * bukan tabel satu baris. "Kepala desa Cibeuteung Muara" tidak sedang meminta
 * daftar berisi satu orang — ia meminta orangnya. Karena itu setiap penangan
 * daftar memeriksa hasilnya, dan begitu tinggal satu, ia menaikkannya jadi
 * profil lengkap.
 *
 * Berkas ini memegang bentuk profilnya per jenis objek. Yang ditampilkan
 * SELURUH kolom yang berarti, termasuk yang masih kosong — kolom kosong yang
 * disembunyikan membuat pembaca tidak bisa membedakan "tidak ada kolomnya" dari
 * "belum diisi", padahal yang belum diisi itulah yang perlu ditagih.
 */

const prisma = require('./../config/prisma');

const nf = new Intl.NumberFormat('id-ID');

const teks = (v) => {
	if (v === null || v === undefined) return '—';
	const t = String(v).trim();
	return t === '' || t === '-' ? '—' : t;
};

const tanggal = (v) => {
	if (!v) return '—';
	const d = new Date(v);
	return Number.isNaN(d.getTime())
		? '—'
		: d.toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });
};

const rupiah = (v) =>
	(v === null || v === undefined ? '—' : `Rp ${nf.format(Math.round(Number(v)))}`);

/** Usia dari tanggal lahir, dalam tahun penuh. */
const usia = (lahir) => {
	if (!lahir) return null;
	const l = new Date(lahir);
	if (Number.isNaN(l.getTime())) return null;
	const kini = new Date();
	let tahun = kini.getFullYear() - l.getFullYear();
	const bulan = kini.getMonth() - l.getMonth();
	if (bulan < 0 || (bulan === 0 && kini.getDate() < l.getDate())) tahun -= 1;
	return tahun >= 0 && tahun < 130 ? tahun : null;
};

/* --------------------------------------------------------------- aparatur -- */

const BERKAS_APARATUR = [
	['file_pas_foto', 'Pas foto'],
	['file_ktp', 'KTP'],
	['file_kk', 'Kartu Keluarga'],
	['file_akta_kelahiran', 'Akta kelahiran'],
	['file_ijazah_terakhir', 'Ijazah terakhir'],
	['file_bpjs_kesehatan', 'Kartu BPJS Kesehatan'],
	['file_bpjs_ketenagakerjaan', 'Kartu BPJS Ketenagakerjaan'],
];

const detailAparatur = async (id) => {
	const a = await prisma.aparatur_desa.findUnique({
		where: { id },
		include: {
			desas: { select: { nama: true, kode: true, kecamatans: { select: { nama: true } } } },
			produk_hukums: { select: { judul: true, nomor: true, tahun: true } },
		},
	});
	if (!a) return null;

	const umur = usia(a.tanggal_lahir);
	const berkasAda = BERKAS_APARATUR.filter(([k]) => a[k]).length;

	return {
		maksud: 'detail-aparatur',
		judul: a.nama_lengkap,
		kalimat:
			`${a.nama_lengkap} menjabat ${a.jabatan} di Desa ${a.desas?.nama || '—'}, `
			+ `Kecamatan ${a.desas?.kecamatans?.nama || '—'}`
			+ (umur ? `, umur ${umur} tahun` : '')
			+ (a.pendidikan_terakhir ? `, pendidikan terakhir ${a.pendidikan_terakhir}` : '')
			+ (a.tanggal_pengangkatan ? `, diangkat ${tanggal(a.tanggal_pengangkatan)}` : '')
			+ '.',
		rincian: [
			{ label: 'Nama lengkap', nilai: teks(a.nama_lengkap) },
			{ label: 'Jabatan', nilai: teks(a.jabatan) },
			{ label: 'Status', nilai: teks(a.status) },
			{ label: 'Desa', nilai: teks(a.desas?.nama) },
			{ label: 'Kecamatan', nilai: teks(a.desas?.kecamatans?.nama) },
			{ label: 'Kode desa', nilai: teks(a.desas?.kode) },
			{ label: 'NIPD', nilai: teks(a.nipd) },
			{ label: 'NIAP', nilai: teks(a.niap) },
			{ label: 'Pangkat/Golongan', nilai: teks(a.pangkat_golongan) },
			{ label: 'Jenis kelamin', nilai: a.jenis_kelamin === 'Laki_laki' ? 'Laki-laki' : teks(a.jenis_kelamin) },
			{ label: 'Tempat lahir', nilai: teks(a.tempat_lahir) },
			{ label: 'Tanggal lahir', nilai: tanggal(a.tanggal_lahir) },
			{ label: 'Usia', nilai: umur ? `${umur} tahun` : '—' },
			{ label: 'Agama', nilai: teks(a.agama) },
			{ label: 'Pendidikan terakhir', nilai: teks(a.pendidikan_terakhir) },
			{ label: 'Tgl. pengangkatan', nilai: tanggal(a.tanggal_pengangkatan) },
			{ label: 'No. SK pengangkatan', nilai: teks(a.nomor_sk_pengangkatan) },
			{ label: 'Tgl. pemberhentian', nilai: tanggal(a.tanggal_pemberhentian) },
			{ label: 'No. SK pemberhentian', nilai: teks(a.nomor_sk_pemberhentian) },
			{ label: 'BPJS Kesehatan', nilai: teks(a.bpjs_kesehatan_nomor) },
			{ label: 'BPJS Ketenagakerjaan', nilai: teks(a.bpjs_ketenagakerjaan_nomor) },
			{ label: 'Dasar hukum', nilai: a.produk_hukums
				? `${a.produk_hukums.judul} (${a.produk_hukums.nomor}/${a.produk_hukums.tahun})`
				: '—' },
			{ label: 'Berkas terunggah', nilai: `${berkasAda} dari ${BERKAS_APARATUR.length}` },
			{ label: 'Sumber data', nilai: a.sumber_data === 'dapur_desa' ? 'Impor Dapur Desa' : 'Diisi desa' },
			{ label: 'Keterangan', nilai: teks(a.keterangan) },
		],
		kolom: [], baris: [], total: 1,
	};
};

/* ----------------------------------------------------------------- bumdes -- */

const detailBumdes = async (id) => {
	const b = await prisma.bumdes.findUnique({ where: { id } });
	if (!b) return null;

	const modal = [
		b.PenyertaanModal2019, b.PenyertaanModal2020, b.PenyertaanModal2021,
		b.PenyertaanModal2022, b.PenyertaanModal2023, b.PenyertaanModal2024,
	].reduce((t, v) => t + (Number(v) || 0), 0);

	return {
		maksud: 'detail-bumdes',
		judul: b.namabumdesa,
		kalimat:
			`${b.namabumdesa} di Desa ${teks(b.desa)}, Kecamatan ${teks(b.kecamatan)}, `
			+ `berstatus ${teks(b.status)}`
			+ (b.badanhukum ? `, badan hukumnya ${b.badanhukum}` : '')
			+ (Number(b.NilaiAset) > 0 ? `, asetnya ${rupiah(b.NilaiAset)}` : '')
			+ '.',
		rincian: [
			{ label: 'Nama BUM Desa', nilai: teks(b.namabumdesa) },
			{ label: 'Desa', nilai: teks(b.desa) },
			{ label: 'Kecamatan', nilai: teks(b.kecamatan) },
			{ label: 'Status', nilai: teks(b.status) },
			{ label: 'Tahun pendirian', nilai: teks(b.TahunPendirian) },
			{ label: 'Badan hukum', nilai: teks(b.badanhukum) },
			{ label: 'Nomor Perdes', nilai: teks(b.NomorPerdes) },
			{ label: 'NIB', nilai: teks(b.NIB) },
			{ label: 'NPWP', nilai: teks(b.NPWP) },
			{ label: 'LKPP', nilai: teks(b.LKPP) },
			{ label: 'Direktur', nilai: teks(b.NamaDirektur) },
			{ label: 'HP Direktur', nilai: teks(b.HPDirektur) },
			{ label: 'Alamat', nilai: teks(b.AlamatBumdesa) },
			{ label: 'Telepon', nilai: teks(b.TelfonBumdes) },
			{ label: 'Email', nilai: teks(b.Alamatemail) },
			{ label: 'Jenis usaha utama', nilai: teks(b.JenisUsahaUtama) },
			{ label: 'Tenaga kerja', nilai: teks(b.TotalTenagaKerja) },
			{ label: 'Nilai aset', nilai: rupiah(b.NilaiAset) },
			{ label: 'Omset 2024', nilai: rupiah(b.Omset2024) },
			{ label: 'Omset 2025', nilai: rupiah(b.Omset2025) },
			{ label: 'Laba 2025', nilai: rupiah(b.Laba2025) },
			{ label: 'Kontribusi PADes 2025', nilai: rupiah(b.KontribusiTerhadapPADes2025) },
			{ label: 'Penyertaan modal 2019–2024', nilai: rupiah(modal) },
			{ label: 'Pemeringkatan', nilai: teks(b.Pemeringkatan2026 || b.Pemeringkatan2024) },
		],
		kolom: [], baris: [], total: 1,
	};
};

/* ----------------------------------------------------------- produk hukum -- */

const detailProdukHukum = async (id) => {
	const p = await prisma.produk_hukums.findUnique({
		where: { id },
		include: { desas: { select: { nama: true, kecamatans: { select: { nama: true } } } } },
	});
	if (!p) return null;

	return {
		maksud: 'detail-produk-hukum',
		judul: p.judul,
		kalimat:
			`${p.jenis?.replace(/_/g, ' ')} nomor ${p.nomor} tahun ${p.tahun}, `
			+ `${p.judul}, dari Desa ${p.desas?.nama || '—'}. Statusnya ${teks(p.status_peraturan)}.`,
		rincian: [
			{ label: 'Judul', nilai: teks(p.judul) },
			{ label: 'Jenis', nilai: teks(p.jenis?.replace(/_/g, ' ')) },
			{ label: 'Singkatan', nilai: teks(p.singkatan_jenis) },
			{ label: 'Nomor', nilai: teks(p.nomor) },
			{ label: 'Tahun', nilai: teks(p.tahun) },
			{ label: 'Desa', nilai: teks(p.desas?.nama) },
			{ label: 'Kecamatan', nilai: teks(p.desas?.kecamatans?.nama) },
			{ label: 'Tempat penetapan', nilai: teks(p.tempat_penetapan) },
			{ label: 'Tanggal penetapan', nilai: tanggal(p.tanggal_penetapan) },
			{ label: 'Status peraturan', nilai: teks(p.status_peraturan) },
			{ label: 'Keterangan status', nilai: teks(p.keterangan_status) },
			{ label: 'Subjek', nilai: teks(p.subjek) },
			{ label: 'Bidang hukum', nilai: teks(p.bidang_hukum) },
			{ label: 'Sumber', nilai: teks(p.sumber) },
			{ label: 'Berkas', nilai: p.file ? 'Ada' : 'Belum diunggah' },
		],
		kolom: [], baris: [], total: 1,
	};
};

module.exports = { detailAparatur, detailBumdes, detailProdukHukum };
