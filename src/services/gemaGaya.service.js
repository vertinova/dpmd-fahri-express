/**
 * Gaya bicara Gema.
 *
 * Jawaban Gema DIUCAPKAN, bukan dibaca. Kalimat yang rapi di layar sering
 * terdengar kaku di telinga: "Ada 66 desa berstatus Mandiri." itu benar, tapi
 * bunyinya seperti mesin absensi. Orang mengawali jawaban dengan sedikit
 * pengantar, menyebut contohnya, lalu menutup dengan tawaran.
 *
 * Berkas ini memusatkan semua itu supaya nadanya seragam di seluruh jawaban,
 * dan supaya mengubahnya cukup di satu tempat.
 *
 * VARIASI ITU PENTING. Kalimat pembuka yang sama persis setiap kali justru
 * terdengar lebih robotik daripada tanpa pembuka sama sekali — telinga cepat
 * menangkap pola. Karena itu tiap bagian diambil acak dari beberapa pilihan.
 */

const acak = (daftar) => daftar[Math.floor(Math.random() * daftar.length)];

/** Pembuka saat ada hasil. */
const PEMBUKA = [
	'Oke,',
	'Siap,',
	'Baik,',
	'Nah,',
	'Ketemu,',
];

/** Pembuka saat hasilnya kosong — nada tetap ringan, bukan menyalahkan. */
const PEMBUKA_KOSONG = [
	'Hmm,',
	'Wah,',
	'Sayangnya,',
];

/** Penutup sesekali, supaya terasa mengobrol dan bukan membacakan laporan. */
const PENUTUP = [
	'Ada lagi yang mau dicek?',
	'Mau saya carikan yang lain?',
	'Ada lagi?',
	'Mau dipersempit lagi?',
];

/**
 * Pesan saat Gema tidak mengerti atau belum bisa menjawab.
 *
 * Nadanya sengaja jujur dan tidak defensif: mengaku belum bisa, menyebut siapa
 * yang sedang mengerjakannya, lalu menawarkan jalan lain supaya penggunanya
 * tidak berhenti di jalan buntu.
 */
const BELUM_BISA = [
	'Wah, yang itu belum bisa saya jawab. Saya masih terus dikembangkan tim IT DPMD, '
		+ 'jadi tunggu ya, sebentar lagi juga bisa.',
	'Hmm, itu belum masuk kemampuan saya. Tim IT DPMD masih mengembangkan saya, '
		+ 'jadi sabar sedikit ya.',
	'Aduh, saya belum paham yang itu. Masih dalam pengembangan tim IT DPMD nih, '
		+ 'ditunggu ya perkembangannya.',
];

/**
 * Sebut CONTOH ISI datanya, bukan cuma jumlahnya.
 *
 * "Ada 66 desa" tidak memberi tahu apa pun tentang desanya. "Ada 66, di antaranya
 * Cijayanti, Bojong Koneng, dan Sukamaju" langsung terasa seperti jawaban orang
 * yang benar-benar melihat datanya.
 *
 * Dibatasi tiga: lebih dari itu jadi pembacaan daftar, dan daftar lengkapnya
 * sudah tampil sebagai tabel di layar.
 */
const sebutkanContoh = (baris, kunci = 'nama', batas = 3) => {
	if (!Array.isArray(baris) || !baris.length) return '';

	// Nama kembar dibuang: usulan Bankeu sering bernama sama persis di beberapa
	// desa, dan "Di antaranya A, dan A" terdengar seperti alat yang rusak.
	const nama = [...new Set(
		baris
			.map((b) => b[kunci] ?? b.desa ?? b.nama ?? null)
			.filter((n) => n && String(n).trim() && String(n) !== '—')
			.map((n) => String(n).trim())
	)].slice(0, batas);

	if (!nama.length) return '';
	if (nama.length === 1) return ` Contohnya ${nama[0]}.`;
	// Dua item tidak pakai koma sebelum "dan"; tiga baru pakai.
	if (nama.length === 2) return ` Di antaranya ${nama[0]} dan ${nama[1]}.`;

	const akhir = nama.pop();
	return ` Di antaranya ${nama.join(', ')}, dan ${akhir}.`;
};

/**
 * Turunkan huruf besar di awal kalimat inti ketika ia menyusul pembuka.
 *
 * "Ketemu, Ditemukan 13 BUM Desa" salah tulis dan salah bunyi. Tapi
 * penurunannya tidak boleh membabi buta: "ADD untuk Kecamatan Jonggol" dan
 * "BHPRD totalnya" harus tetap kapital. Jadi hanya kata pembuka kalimat yang
 * memang baku yang diturunkan.
 */
const KATA_AWAL = ['Ada', 'Ditemukan', 'Tercatat', 'Belum', 'Tidak', 'Lembaga', 'Desa', 'Kecamatan'];

const turunkanAwalan = (inti) => {
	const kata = String(inti).split(/\s/)[0];
	if (!KATA_AWAL.includes(kata)) return inti;
	return inti.charAt(0).toLowerCase() + inti.slice(1);
};

/**
 * Bungkus kalimat mentah jadi ucapan yang enak didengar.
 *
 * @param {string}  inti      kalimat faktual dari penangan
 * @param {object}  opsi
 * @param {Array}   opsi.baris     dipakai menyebut contoh isinya
 * @param {string}  opsi.kunciNama kolom mana yang jadi nama
 * @param {boolean} opsi.kosong    hasilnya nihil
 * @param {boolean} opsi.tawarkan  tambahkan penutup mengobrol
 */
const bicarakan = (inti, opsi = {}) => {
	const { baris = [], kunciNama = 'nama', kosong = false, tawarkan = true } = opsi;

	const pembuka = kosong ? acak(PEMBUKA_KOSONG) : acak(PEMBUKA);
	const isi = turunkanAwalan(inti);
	const contoh = kosong ? '' : sebutkanContoh(baris, kunciNama);

	// Penutup tidak selalu dipasang. Tawaran di setiap jawaban justru terasa
	// memaksa; sesekali saja membuatnya terasa wajar.
	const penutup = !kosong && tawarkan && Math.random() < 0.45 ? ` ${acak(PENUTUP)}` : '';

	return `${pembuka} ${isi}${contoh}${penutup}`.replace(/\s+/g, ' ').trim();
};

/** Kalimat baku saat Gema belum mampu menjawab. */
const belumBisa = () => acak(BELUM_BISA);

module.exports = { bicarakan, belumBisa, sebutkanContoh, acak };
