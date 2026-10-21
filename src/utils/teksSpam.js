/**
 * Penangkal teks iklan di kolom identitas aparatur.
 *
 * Arsip Dapur Desa lama berisi nama aparatur yang ditimpa iklan "CS resmi"
 * pinjol & travel (Adakami, EasyCash, Trip.com) lengkap dengan nomor telepon —
 * modus menanam nomor palsu di situs .go.id supaya muncul di mesin pencari.
 * Enam baris lolos ke data desa saat impor 2026-07-27, satu di antaranya
 * sebagai KEPALA DESA. Nama orang tidak pernah memuat nomor telepon, alamat
 * web, atau kalimat ajakan, jadi ketiganya cukup sebagai penanda.
 *
 * Hanya untuk kolom berisi nama/teks bebas pendek. JANGAN dipakai ke nomor SK
 * atau NIP: deret angka panjang memang wajar di sana.
 */

const KATA_IKLAN = /\b(call\s*center|customer\s*service|whats\s*app|hubungi|layanan\s+pusat|pinjaman|pinjol|refund|reschedule|cs\s+resmi)\b/i;
// Minimal tiga huruf sebelum titik supaya gelar ("S.Kom", "S.Ip", "H.") tidak ikut.
const ALAMAT_WEB = /(https?:\/\/|www\.|\b[a-z0-9-]{3,}\.(com|net|org|xyz|link|go\.id|co\.id)\b)/i;
// Sembilan digit atau lebih, boleh dipisah spasi/titik/strip/•: 0817-474-2225, 0851•6666•4573.
const NOMOR_TELEPON = /(?:\+?\d[\s.\-•·]*){9,}/;
const PANJANG_MAKS = 120;

/** Mengembalikan alasan penolakan, atau null bila teksnya wajar. */
const alasanSpam = (nilai) => {
	const teks = String(nilai ?? '').trim();
	if (!teks) return null;
	if (NOMOR_TELEPON.test(teks)) return 'memuat nomor telepon';
	if (ALAMAT_WEB.test(teks)) return 'memuat alamat web';
	if (KATA_IKLAN.test(teks)) return 'berisi kalimat iklan';
	if (teks.length > PANJANG_MAKS) return `lebih dari ${PANJANG_MAKS} karakter`;
	return null;
};

const LABEL_KOLOM = { nama_lengkap: 'Nama lengkap', tempat_lahir: 'Tempat lahir', jabatan: 'Jabatan', nama: 'Nama' };

/**
 * Periksa beberapa kolom sekaligus. Mengembalikan pesan untuk pengguna, atau
 * null bila semuanya wajar. Kolom yang tidak dikirim dilewati.
 */
const periksaKolomSpam = (data, kolom = ['nama_lengkap', 'tempat_lahir', 'jabatan']) => {
	for (const k of kolom) {
		if (!(k in (data || {}))) continue;
		const alasan = alasanSpam(data[k]);
		if (alasan) return `${LABEL_KOLOM[k] || k} ditolak karena ${alasan}. Isi dengan data sebenarnya.`;
	}
	return null;
};

module.exports = { alasanSpam, periksaKolomSpam };
