/**
 * Gema — asisten suara Core Dashboard.
 *
 * Controller ini tipis: menerima kalimat, menyerahkannya ke mesin pencari, dan
 * membalas. Seluruh kepandaiannya ada di services/gemaMesin.service.js supaya
 * bisa dipakai ulang — nanti oleh model bahasa sebagai alat, atau oleh jalur
 * lain seperti chatbot teks — tanpa menyalin apa pun dari sini.
 *
 * Bentuk jawabannya selalu sama:
 *
 *   { maksud, kalimat, judul?, rincian?[], kolom[], baris[], total }
 *
 * `kalimat` yang diucapkan Gema. `rincian` untuk jawaban tentang SATU hal
 * (rapor desa, rapor kecamatan); `kolom` + `baris` untuk jawaban berupa daftar.
 * `ditenagai` menyebut siapa yang menjawab: 'model', 'mesin', atau
 * 'mesin-cadangan' saat model gagal dipanggil. Halaman depan menggambar apa pun
 * yang datang tanpa perlu tahu pertanyaannya tentang apa.
 */

// Lapis model bahasa memutuskan sendiri apakah ia aktif: tanpa ANTHROPIC_API_KEY
// ia langsung meneruskan ke mesin deterministik, dan tidak ada satu byte pun yang
// meninggalkan server.
const { jawab, tersedia } = require('../services/gemaLLM.service');
const logger = require('../utils/logger');

/** Contoh yang ditawarkan di halaman depan. */
const CONTOH = [
	'desa berstatus mandiri',
	'profil desa Cijayanti',
	'bumdes aktif di kecamatan Jonggol',
	'kepala desa di Cibungbulang',
	'kecamatan Pamijahan',
	'produk hukum desa Cibatok',
	'desa bertipologi persawahan',
	'bantuan keuangan di kecamatan Jonggol',
	'posyandu di kecamatan Cibungbulang',
	'berapa RW di desa Cijayanti',
];

/** POST /api/gema/tanya  { teks } */
const tanya = async (req, res) => {
	const teks = String(req.body?.teks || '').trim();
	if (!teks) {
		return res.status(400).json({ success: false, message: 'Tidak ada yang ditanyakan' });
	}

	try {
		const hasil = await jawab(teks);

		// Tidak menemukan apa pun bukan kegagalan — itu jawaban yang sah, dan
		// jauh lebih berguna daripada mengarang. Contoh perintah disertakan
		// supaya penanya tahu apa yang bisa diminta.
		if (!hasil.total && hasil.maksud === 'pencarian-menyeluruh') {
			return res.json({ success: true, data: { ...hasil, saran: CONTOH } });
		}

		return res.json({ success: true, data: hasil });
	} catch (error) {
		logger.error('Gema gagal menjawab:', error);
		return res.status(500).json({
			success: false,
			message: 'Gema gagal mengambil datanya',
			error: error.message,
		});
	}
};

/** GET /api/gema/kemampuan */
const kemampuan = (req, res) =>
	res.json({
		success: true,
		data: CONTOH.map((contoh) => ({ id: contoh, contoh })),
		// Halaman depan memakai ini untuk memberi tahu pengguna seberapa bebas
		// ia boleh bertanya — kalimat bebas hanya dimengerti bila model aktif.
		model_aktif: tersedia(),
	});

module.exports = { tanya, kemampuan, CONTOH };
