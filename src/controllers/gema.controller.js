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
 *   { maksud, kalimat, judul?, rincian?[], kolom[], baris[], total, konfirmasi? }
 *
 * `kalimat` yang diucapkan Gema. `rincian` untuk jawaban tentang SATU hal
 * (rapor desa, rapor kecamatan, profil akun pegawai); `kolom` + `baris` untuk
 * jawaban berupa daftar. `ditenagai` menyebut siapa yang menjawab: 'model',
 * 'mesin', atau 'mesin-cadangan' saat model gagal dipanggil. Halaman depan
 * menggambar apa pun yang datang tanpa perlu tahu pertanyaannya tentang apa.
 *
 * `konfirmasi` muncul HANYA untuk tindakan yang mengubah data — sejauh ini
 * cuma satu: menyetel ulang sandi akun pegawai. Perintah suaranya berhenti di
 * penyiapan; perubahannya baru terjadi setelah pengguna menekan tombol dan
 * front-end memanggil POST /api/gema/konfirmasi. Dua langkah ini disengaja:
 * pengenalan suara salah dengar itu biasa, dan sandi yang telanjur disetel
 * ulang ke orang yang salah tidak bisa dibatalkan.
 */

// Lapis model bahasa memutuskan sendiri apakah ia aktif: tanpa ANTHROPIC_API_KEY
// ia langsung meneruskan ke mesin deterministik, dan tidak ada satu byte pun yang
// meninggalkan server.
const { jawab, tersedia } = require('../services/gemaLLM.service');
const { jalankanSetelUlangSandi } = require('../services/gemaAkunPegawai.service');
const { bolehSetelSandiSuara } = require('../config/akunStaf');
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
	'berapa ADD di kecamatan Jonggol',
	'penyaluran dana desa',
	'kepala desa Cibeuteung Muara',
	'profil akun pegawai Ahmad',
];

/** Contoh yang hanya ditawarkan kepada yang memang boleh melakukannya. */
const CONTOH_SETEL_SANDI = ['reset password akun pegawai Ahmad'];

/** Identitas penanya, dibawa ke mesin untuk pemeriksaan izin dan pencatatan. */
const pelakuDari = (req) => ({
	id: req.user?.id,
	name: req.user?.name,
	role: req.user?.role,
});

/** POST /api/gema/tanya  { teks } */
const tanya = async (req, res) => {
	const teks = String(req.body?.teks || '').trim();
	if (!teks) {
		return res.status(400).json({ success: false, message: 'Tidak ada yang ditanyakan' });
	}

	try {
		const hasil = await jawab(teks, pelakuDari(req));

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

/**
 * POST /api/gema/konfirmasi  { token, aksi }
 *
 * Langkah kedua dari tindakan yang mengubah data. Izinnya diperiksa lagi di
 * sini — bukan mengandalkan pemeriksaan saat perintahnya diucapkan — supaya
 * jalur ini tetap aman walau dipanggil langsung tanpa lewat Gema.
 */
const konfirmasi = async (req, res) => {
	const token = String(req.body?.token || '').trim();
	const aksi = String(req.body?.aksi || 'setel-ulang-sandi').trim();

	if (!token) {
		return res.status(400).json({ success: false, message: 'Tidak ada konfirmasi yang dikirim' });
	}

	if (aksi !== 'setel-ulang-sandi') {
		return res.status(400).json({ success: false, message: `Tindakan "${aksi}" tidak dikenali` });
	}

	if (!bolehSetelSandiSuara(req.user?.role)) {
		return res.status(403).json({
			success: false,
			message: 'Lewat Gema, setel ulang sandi hanya untuk Kepala Dinas, Sekretaris Dinas, atau Super Admin',
		});
	}

	try {
		const hasil = await jalankanSetelUlangSandi({ token, pelaku: pelakuDari(req), req });
		return res.json({ success: true, data: hasil });
	} catch (error) {
		logger.error('Gema gagal menjalankan konfirmasi:', error);
		return res.status(500).json({
			success: false,
			message: 'Gema gagal menjalankan tindakannya',
			error: error.message,
		});
	}
};

/** GET /api/gema/kemampuan */
const kemampuan = (req, res) => {
	const boleh = bolehSetelSandiSuara(req.user?.role);
	const contoh = boleh ? [...CONTOH, ...CONTOH_SETEL_SANDI] : CONTOH;

	return res.json({
		success: true,
		data: contoh.map((c) => ({ id: c, contoh: c })),
		// Halaman depan memakai ini untuk memberi tahu pengguna seberapa bebas
		// ia boleh bertanya — kalimat bebas hanya dimengerti bila model aktif.
		model_aktif: tersedia(),
		// Dipakai halaman depan untuk tahu apakah perintah sandi ada gunanya ditawarkan.
		boleh_setel_sandi: boleh,
	});
};

module.exports = { tanya, konfirmasi, kemampuan, CONTOH };
