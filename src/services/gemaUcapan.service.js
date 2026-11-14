/**
 * Menyiapkan teks jawaban Gema untuk dibacakan mesin suara (TTS):
 * markdown dibuang, angka/rupiah/persen/tanggal dieja, singkatan dilafalkan.
 */

const SATUAN = ['', 'satu', 'dua', 'tiga', 'empat', 'lima', 'enam', 'tujuh', 'delapan', 'sembilan', 'sepuluh', 'sebelas'];
const SKALA = [[1e12, 'triliun'], [1e9, 'miliar'], [1e6, 'juta'], [1e3, 'ribu']];
const BULAN = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];

/** Bilangan bulat >= 0 menjadi kata. */
const eja = (n) => {
	if (n < 12) return n === 0 ? 'nol' : SATUAN[n];
	if (n < 20) return `${SATUAN[n - 10]} belas`;
	if (n < 100) return `${SATUAN[Math.floor(n / 10)]} puluh${n % 10 ? ` ${SATUAN[n % 10]}` : ''}`;
	if (n < 200) return `seratus${n > 100 ? ` ${eja(n - 100)}` : ''}`;
	if (n < 1000) return `${SATUAN[Math.floor(n / 100)]} ratus${n % 100 ? ` ${eja(n % 100)}` : ''}`;
	for (const [nilai, nama] of SKALA) {
		if (n >= nilai) {
			const depan = Math.floor(n / nilai);
			const sisa = n % nilai;
			// "seribu", bukan "satu ribu"
			const kata = nilai === 1e3 && depan === 1 ? 'seribu' : `${eja(depan)} ${nama}`;
			return sisa ? `${kata} ${eja(sisa)}` : kata;
		}
	}
	return String(n);
};

/** "1.250.000" -> 1250000 (titik ribuan Indonesia). */
const keAngka = (s) => Number(s.replace(/\./g, ''));

/** Bilangan Indonesia dengan koma desimal: "12,5" -> "dua belas koma lima". */
const ejaDesimal = (bulat, pecahan) => {
	const dasar = eja(keAngka(bulat));
	return pecahan ? `${dasar} koma ${[...pecahan].map((d) => (d === '0' ? 'nol' : SATUAN[Number(d)])).join(' ')}` : dasar;
};

const ANGKA = String.raw`\d{1,3}(?:\.\d{3})+|\d+`;

const SINGKATAN = [
	['DPMD', 'de pe em de'], ['BUMDes', 'bum des'], ['BUM Desa', 'bum des'], ['RT', 'er te'], ['RW', 'er we'],
	['DD', 'dana desa'], ['ADD', 'alokasi dana desa'], ['TA', 'tahun anggaran'], ['BHPRD', 'be ha pe er de'], ['NIP', 'en i pe'],
];

const keUcapan = (teks) => {
	let s = String(teks || '')
		.replace(/^\s*-\s+/gm, '')
		.replace(/[*_#`]/g, '');

	// Tanggal dulu, sebelum angkanya terbaca sebagai bilangan biasa.
	const tanggal = (h, b, t) => (Number(b) >= 1 && Number(b) <= 12 ? `${eja(Number(h))} ${BULAN[Number(b) - 1]} ${eja(Number(t))}` : null);
	s = s.replace(/\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/g, (m, h, b, t) => tanggal(h, b, t) || m);
	s = s.replace(/\b(\d{4})-(\d{2})-(\d{2})\b/g, (m, t, b, h) => tanggal(h, b, t) || m);

	s = s.replace(new RegExp(String.raw`Rp\s?(${ANGKA})(?:,(\d+))?`, 'g'), (m, b) => `${eja(keAngka(b))} rupiah`);
	s = s.replace(new RegExp(String.raw`(${ANGKA})(?:,(\d+))?\s?%`, 'g'), (m, b, p) => `${ejaDesimal(b, p)} persen`);
	s = s.replace(new RegExp(String.raw`(${ANGKA})(?:,(\d+))?`, 'g'), (m, b, p) => ejaDesimal(b, p));

	for (const [asal, ucap] of SINGKATAN) s = s.replace(new RegExp(String.raw`\b${asal}\b`, 'g'), ucap);
	return s.replace(/\s+/g, ' ').trim();
};

/** Pisah di . ! ? + spasi; tidak memecah angka desimal (tak ada spasi) maupun singkatan satu huruf. */
const pecahKalimat = (teks) => String(teks || '')
	.split(/(?<=[.!?])(?<!\b(?:Dr|Drs|Ir|Hj|Prof|No|Bpk|St|[A-Z])\.)\s+(?=\S)/)
	.map((k) => k.trim())
	.filter(Boolean);

module.exports = { keUcapan, pecahKalimat };
