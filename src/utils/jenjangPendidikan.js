// Kolom pendidikan pengurus diisi dari beberapa sumber dengan ejaan berbeda
// untuk jenjang yang sama ("SD/MI" vs "SD", "SMA/SMK/MA" vs "SMA/SMK" vs "SMA",
// "S1/D4" vs "S1"), jadi rekap per jenjang harus menyatukan ejaan yang setara
// dulu. Label di sini sengaja sama dengan dpmd-frontend/src/utils/jenjangPendidikan.js
// supaya dashboard pengurus dan dashboard aparatur membaca jenjang yang sama.
//
// Urutan pengujian penting: pola yang lebih spesifik harus lebih dulu, kalau
// tidak "STRATA II" keburu tertangkap pola "STRATA I" dan "SARJANA MUDA"
// tertangkap pola "SARJANA".
const JENJANG = [
	{ label: 'Tidak Diketahui', order: 100, match: /^(tidak\s*diketahui|tidak\s*ada|belum\s*diisi|unknown|n\/?a|-+)$/i },
	{ label: 'Tidak Sekolah', order: 0, match: /tidak\s*(pernah\s*)?sekolah|tidak\s*tamat\s*sd|belum\s*sekolah/i },
	{ label: 'S3', order: 8, match: /^s-?3\b|strata\s*iii\b|doktor/i },
	{ label: 'S2', order: 7, match: /^s-?2\b|strata\s*ii\b|magister|pasca\s*sarjana/i },
	{ label: 'Diploma III', order: 5, match: /^d-?3\b|diploma\s*iii\b|sarjana\s*muda|s\.\s*muda/i },
	{ label: 'S1 / Diploma IV', order: 6, match: /^s-?1\b|^d-?4\b|strata\s*i\b|diploma\s*iv\b|sarjana/i },
	{ label: 'Diploma I-II', order: 4, match: /^d-?[12]\b|diploma\s*i{1,2}\b/i },
	{ label: 'SMA / SMK / Sederajat', order: 3, match: /^(sma|smk|slta|stm|smea|man|ma|paket\s*c)\b/i },
	{ label: 'SMP / Sederajat', order: 2, match: /^(smp|sltp|mts|paket\s*b)\b/i },
	{ label: 'SD / Sederajat', order: 1, match: /^(sd|mi|paket\s*a)\b|sekolah\s*dasar/i },
];

const TIDAK_DIKETAHUI = { label: 'Tidak Diketahui', order: 100 };

// Mengembalikan { label, order } untuk satu isian pendidikan. Nilai kosong dan
// ejaan "tidak diketahui" jatuh ke satu keranjang yang sama.
const jenjangKey = (raw) => {
	const value = String(raw ?? '').trim();
	if (!value) return TIDAK_DIKETAHUI;
	for (const item of JENJANG) {
		if (item.match.test(value)) return { label: item.label, order: item.order };
	}
	return { label: value, order: 99 };
};

const jenjangLabel = (raw) => jenjangKey(raw).label;

// Rekap jumlah per jenjang, sudah terurut dari jenjang terendah ke tertinggi
// dengan "Tidak Diketahui" di akhir. Hasilnya objek biasa supaya urutan kunci
// ikut terbawa saat di-JSON-kan ke frontend.
const rekapJenjang = (rows, ambil = (row) => row.pendidikan) => {
	const buckets = new Map();
	for (const row of rows) {
		const { label, order } = jenjangKey(ambil(row));
		const bucket = buckets.get(label) || { label, order, total: 0 };
		bucket.total += 1;
		buckets.set(label, bucket);
	}
	const terurut = [...buckets.values()].sort(
		(a, b) => a.order - b.order || a.label.localeCompare(b.label, 'id')
	);
	return Object.fromEntries(terurut.map((item) => [item.label, item.total]));
};

module.exports = { JENJANG, jenjangKey, jenjangLabel, rekapJenjang };
