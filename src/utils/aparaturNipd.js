/**
 * NIPD (Nomor Induk Perangkat Desa) dan verifikasi per item aparatur desa.
 *
 * NIPD 20 digit, diterbitkan sistem saat Bidang Pemdes menyatakan data valid:
 *
 *   YYYYMMDD  KK  CC  DDDD  J  JJJ
 *   │         │   │   │     │  └─ kode jabatan (3)
 *   │         │   │   │     └──── jenis kelamin: 1 laki-laki, 2 perempuan
 *   │         │   │   └────────── kode desa (4)       ← desas.kode   32.01.40.[2007]
 *   │         │   └────────────── kode kecamatan (2)  ← kecamatans.kode 32.01.[40]
 *   │         └────────────────── kode kabupaten (2)  ← Kabupaten Bogor = 01
 *   └──────────────────────────── tanggal lahir (8)
 *
 * Hanya jabatan perangkat yang punya kode. Kepala desa, staf perangkat, dan
 * BPD tetap didata, tetapi TIDAK mendapat NIPD.
 */

const KODE_KABUPATEN = '01';

// Kode jabatan tetap. Pola dicocokkan pada teks jabatan yang sudah dibakukan
// (huruf besar, spasi tunggal); dua gaya penulisan di data — "KAUR KEUANGAN"
// dan "Kepala Urusan Keuangan" — ditampung pola yang sama.
const KODE_JABATAN_TETAP = [
	{ kode: '001', label: 'Sekretaris Desa', pola: /^(SEKRETARIS DESA|SEKDES)$/ },
	{ kode: '002', label: 'Kasi Pemerintahan', pola: /^(KASI|KEPALA SEKSI) PEMERINTAHAN$/ },
	{ kode: '003', label: 'Kasi Pelayanan', pola: /^(KASI|KEPALA SEKSI) PELAYANAN$/ },
	{ kode: '004', label: 'Kasi Kesejahteraan', pola: /^(KASI|KEPALA SEKSI) (KESEJAHTERAAN( RAKYAT)?|KESRA)$/ },
	{ kode: '005', label: 'Kaur Umum', pola: /^(KAUR|KEPALA URUSAN) (UMUM|TATA USAHA|TU)\b/ },
	{ kode: '006', label: 'Kaur Keuangan', pola: /^(KAUR|KEPALA URUSAN) KEUANGAN$/ },
	{ kode: '007', label: 'Kaur Perencanaan', pola: /^(KAUR|KEPALA URUSAN) PERENCANAAN$/ },
];

const ROMAWI = { I: 1, V: 5, X: 10, L: 50 };
const dariRomawi = (teks) => {
	let total = 0;
	for (let i = 0; i < teks.length; i++) {
		const nilai = ROMAWI[teks[i]];
		if (!nilai) return null;
		total += ROMAWI[teks[i + 1]] > nilai ? -nilai : nilai;
	}
	return total || null;
};

const bakuJabatan = (jabatan = '') => String(jabatan).toUpperCase().replace(/\s+/g, ' ').trim();

/**
 * Kode jabatan 3 digit, atau null bila jabatan ini tidak mendapat NIPD.
 * Kadus ke-N = 007 + N (Kadus I = 008). Kadus tanpa nomor → null dengan
 * alasan, karena kodenya tidak bisa ditentukan.
 */
const kodeJabatan = (jabatan) => {
	const teks = bakuJabatan(jabatan);
	if (!teks || /\bBPD\b|BADAN PERMUSYAWARATAN|\bSTAF\b|\bSTAFF\b/.test(teks)) return { kode: null, berhak: false };
	if (/^(KEPALA DESA|KADES)$/.test(teks)) return { kode: null, berhak: false };

	const tetap = KODE_JABATAN_TETAP.find((item) => item.pola.test(teks));
	if (tetap) return { kode: tetap.kode, berhak: true };

	const kadus = teks.match(/^(KADUS|KEPALA DUSUN)(?: ([IVXL]+|\d+))?$/);
	if (kadus) {
		const nomor = kadus[2] ? (/^\d+$/.test(kadus[2]) ? parseInt(kadus[2], 10) : dariRomawi(kadus[2])) : null;
		if (!nomor) return { kode: null, berhak: true, alasan: 'Nomor dusun pada jabatan Kadus belum diisi (mis. "Kadus I")' };
		return { kode: String(7 + nomor).padStart(3, '0'), berhak: true };
	}

	return { kode: null, berhak: false };
};

/** Pecah kode wilayah "32.01.40.2007" → { kec: '40', desa: '2007' }. */
const kodeWilayah = (kodeDesa) => {
	const bagian = String(kodeDesa || '').split('.');
	if (bagian.length !== 4) return null;
	const [, , kec, desa] = bagian;
	if (!/^\d{2}$/.test(kec) || !/^\d{4}$/.test(desa)) return null;
	return { kab: KODE_KABUPATEN, kec, desa };
};

/**
 * Bangun NIPD. Mengembalikan { nipd } bila bisa, { nipd: null } bila
 * jabatannya memang tidak ber-NIPD, atau { nipd: null, alasan } bila
 * seharusnya ber-NIPD tapi datanya belum memungkinkan.
 */
const buatNipd = ({ tanggal_lahir, jenis_kelamin, jabatan }, kodeDesa) => {
	const jab = kodeJabatan(jabatan);
	if (!jab.berhak) return { nipd: null };
	if (!jab.kode) return { nipd: null, alasan: jab.alasan };

	const wilayah = kodeWilayah(kodeDesa);
	if (!wilayah) return { nipd: null, alasan: `Kode wilayah desa tidak dikenali (${kodeDesa || 'kosong'})` };

	const lahir = tanggal_lahir ? new Date(tanggal_lahir) : null;
	if (!lahir || Number.isNaN(lahir.getTime())) return { nipd: null, alasan: 'Tanggal lahir belum diisi' };
	// Komponen UTC: kolomnya DATE polos, zona lokal bisa memundurkan sehari.
	const tgl = `${lahir.getUTCFullYear()}${String(lahir.getUTCMonth() + 1).padStart(2, '0')}${String(lahir.getUTCDate()).padStart(2, '0')}`;

	const jk = jenis_kelamin === 'Laki_laki' ? '1' : jenis_kelamin === 'Perempuan' ? '2' : null;
	if (!jk) return { nipd: null, alasan: 'Jenis kelamin belum diisi' };

	return { nipd: `${tgl}${wilayah.kab}${wilayah.kec}${wilayah.desa}${jk}${jab.kode}` };
};

/* ─────────────────────────── Verifikasi per item ─────────────────────────── */

/**
 * Item yang diperiksa Bidang Pemdes. `wajib` = harus ada dan sesuai sebelum
 * data bisa dinyatakan valid. Item tidak wajib hanya ikut diperiksa bila ada
 * isinya (berkas terunggah / nomor terisi).
 */
const ITEM_VERIFIKASI = [
	{ key: 'biodata', label: 'Biodata diri', jenis: 'data', wajib: true, keterangan: 'Nama, tempat & tanggal lahir, jenis kelamin, agama, pendidikan' },
	{ key: 'jabatan_sk', label: 'Jabatan & SK pengangkatan', jenis: 'data', wajib: true, keterangan: 'Jabatan, nomor & tanggal SK, dasar hukum' },
	{ key: 'bpjs', label: 'Nomor BPJS', jenis: 'data', wajib: false, kolom: ['bpjs_kesehatan_nomor', 'bpjs_ketenagakerjaan_nomor'] },
	{ key: 'file_sk_terakhir', label: 'SK terakhir', jenis: 'berkas', wajib: true },
	{ key: 'file_ktp', label: 'KTP', jenis: 'berkas', wajib: true },
	{ key: 'file_pas_foto', label: 'Pas foto', jenis: 'berkas', wajib: false },
	{ key: 'file_kk', label: 'Kartu Keluarga', jenis: 'berkas', wajib: false },
	{ key: 'file_akta_kelahiran', label: 'Akta kelahiran', jenis: 'berkas', wajib: false },
	{ key: 'file_ijazah_terakhir', label: 'Ijazah terakhir', jenis: 'berkas', wajib: false },
	{ key: 'file_bpjs_kesehatan', label: 'Kartu BPJS Kesehatan', jenis: 'berkas', wajib: false },
	{ key: 'file_bpjs_ketenagakerjaan', label: 'Kartu BPJS Ketenagakerjaan', jenis: 'berkas', wajib: false },
];
const KUNCI_ITEM = new Set(ITEM_VERIFIKASI.map((item) => item.key));

const terisi = (nilai) => nilai !== null && nilai !== undefined && String(nilai).trim() !== '';

/** Item yang berlaku untuk satu aparatur, beserta apakah isinya ada. */
const itemBerlaku = (aparatur) =>
	ITEM_VERIFIKASI.map((item) => {
		let ada = true;
		if (item.jenis === 'berkas') ada = terisi(aparatur[item.key]);
		else if (item.kolom) ada = item.kolom.some((kolom) => terisi(aparatur[kolom]));
		return { ...item, ada };
	}).filter((item) => item.wajib || item.ada);

/**
 * Status ringkas dari keputusan per item:
 *   'ditolak'       — ada item yang tidak sesuai, atau berkas wajib tidak ada
 *                     padahal semua yang ada sudah diperiksa;
 *   'terverifikasi' — semua item berlaku sesuai dan semua yang wajib ada;
 *   null            — pemeriksaan belum selesai.
 */
const ringkasVerifikasi = (aparatur, keputusan = {}) => {
	const berlaku = itemBerlaku(aparatur);
	const status = (key) => keputusan?.[key]?.status || null;

	if (berlaku.some((item) => status(item.key) === 'tidak_sesuai')) return 'ditolak';
	const belumDiperiksa = berlaku.filter((item) => item.ada && !status(item.key));
	if (belumDiperiksa.length) return null;
	if (berlaku.some((item) => item.wajib && !item.ada)) return 'ditolak';
	return 'terverifikasi';
};

/** Catatan yang dibaca desa: gabungan item tidak sesuai + berkas wajib yang belum ada. */
const catatanUntukDesa = (aparatur, keputusan = {}, catatanUmum = null) => {
	const baris = [];
	for (const item of itemBerlaku(aparatur)) {
		const k = keputusan?.[item.key];
		if (k?.status === 'tidak_sesuai') baris.push(`${item.label}: ${k.catatan || 'tidak sesuai'}`);
		else if (item.wajib && !item.ada) baris.push(`${item.label}: belum diunggah`);
	}
	if (catatanUmum) baris.push(catatanUmum);
	return baris.length ? baris.join('\n') : null;
};

module.exports = {
	KODE_KABUPATEN,
	ITEM_VERIFIKASI,
	KUNCI_ITEM,
	kodeJabatan,
	kodeWilayah,
	buatNipd,
	itemBerlaku,
	ringkasVerifikasi,
	catatanUntukDesa,
};
