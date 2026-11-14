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

// Lapis model bahasa memutuskan sendiri apakah ia aktif: tanpa GEMA_LLM_URL
// ia langsung meneruskan ke mesin deterministik.
const crypto = require('crypto');
const { jawab, tersedia } = require('../services/gemaLLM.service');
const { keUcapan } = require('../services/gemaUcapan.service');
const { jalankanSetelUlangSandi } = require('../services/gemaAkunPegawai.service');
const { bolehSetelSandiSuara } = require('../config/akunStaf');
const percakapan = require('../services/gemaPercakapan.service');
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

/** Jawab sambil mengumpulkan jejak alat/SQL, lalu tulis satu baris audit. */
const jawabDanCatat = async (teks, req, sesi, opsi = {}) => {
	const pelaku = pelakuDari(req);
	const jejak = { alat: [], sql: [] };
	const mulai = Date.now();
	let hasil;
	try {
		hasil = await jawab(teks, pelaku, sesi, { ...opsi, jejak });
		return hasil;
	} finally {
		logger.info(JSON.stringify({
			gema: 'tanya',
			pelaku: pelaku.id,
			ditenagai: hasil?.ditenagai || 'galat',
			alat: jejak.alat,
			sql: jejak.sql.map((s) => s.slice(0, 500)),
			ms: Date.now() - mulai,
		}));
	}
};

/** Bila belum bisa menjawab, sertakan contoh perintah sebagai saran. */
const denganContoh = (hasil) => (
	!hasil.total && hasil.maksud === 'belum-bisa' ? { ...hasil, saran: CONTOH } : hasil
);

/**
 * POST /api/gema/tanya  { teks, sesi? }
 *
 * `sesi` adalah id percakapan yang dibuat peramban sekali per kunjungan. Dengan
 * itu Gema mengingat giliran sebelumnya, sehingga "kalau yang maju berapa?"
 * bisa dijawab tanpa mengulang seluruh pertanyaan. Tanpa `sesi`, jalurnya tetap
 * bekerja — hanya saja tiap pertanyaan berdiri sendiri seperti sebelumnya.
 */
const tanya = async (req, res) => {
	const teks = String(req.body?.teks || '').trim();
	// Dibatasi panjangnya: id sesi datang dari peramban, dan apa pun yang datang
	// dari luar tidak boleh dipakai sebagai kunci tanpa batas.
	const sesi = String(req.body?.sesi || '').trim().slice(0, 64) || null;

	if (!teks) {
		return res.status(400).json({ success: false, message: 'Tidak ada yang ditanyakan' });
	}

	try {
		const hasil = await jawabDanCatat(teks, req, sesi);

		// Tidak menemukan apa pun bukan kegagalan — itu jawaban yang sah, dan
		// jauh lebih berguna daripada mengarang. Contoh perintah disertakan
		// supaya penanya tahu apa yang bisa diminta.
		if (!hasil.total && hasil.maksud === 'belum-bisa') {
			return res.json({ success: true, data: { ...hasil, saran: CONTOH } });
		}

		return res.json({ success: true, data: hasil });
	} catch (error) {
		logger.error('Gema gagal menjawab:', error);
		return res.status(500).json({
			success: false,
			message: 'Gema sedang bermasalah, coba lagi.',
		});
	}
};

/**
 * POST /api/gema/tanya-alir  { teks, sesi? }
 *
 * Sama dengan /tanya, tetapi jawabannya dialirkan lewat SSE: event token
 * (potongan kalimat), reset (buang token yang sudah tampil, model memanggil
 * alat), selesai (hasil lengkap seperti data /tanya), dan galat.
 */
const tanyaAlir = async (req, res) => {
	const teks = String(req.body?.teks || '').trim();
	const sesi = String(req.body?.sesi || '').trim().slice(0, 64) || null;
	if (!teks) {
		return res.status(400).json({ success: false, message: 'Tidak ada yang ditanyakan' });
	}

	res.status(200).set({
		'Content-Type': 'text/event-stream',
		'Cache-Control': 'no-cache, no-transform',
		Connection: 'keep-alive',
		'X-Accel-Buffering': 'no',
	});
	res.flushHeaders();

	const kontrol = new AbortController();
	// compression() global menahan keluaran sampai di-flush, jadi tiap tulis di-flush.
	const kirim = (isi) => {
		if (kontrol.signal.aborted || res.writableEnded) return;
		res.write(isi);
		res.flush?.();
	};
	const event = (nama, isi) => kirim(`event: ${nama}\ndata: ${JSON.stringify(isi)}\n\n`);

	const hb = setInterval(() => kirim(': hb\n\n'), 15000);
	hb.unref?.();
	// Pakai res, bukan req: 'close' pada req ikut terpicu begitu body selesai dibaca.
	res.on('close', () => {
		clearInterval(hb);
		if (!res.writableEnded) kontrol.abort();
	});

	try {
		const hasil = await jawabDanCatat(teks, req, sesi, {
			signal: kontrol.signal,
			onToken: (t) => event('token', { t }),
			onReset: () => event('reset', {}),
		});
		event('selesai', denganContoh(hasil));
	} catch (error) {
		if (!kontrol.signal.aborted) {
			logger.error('Gema gagal menjawab (alir):', error);
			event('galat', { message: 'Gema sedang bermasalah, coba lagi.' });
		}
	} finally {
		clearInterval(hb);
		if (!res.writableEnded) res.end();
	}
	return undefined;
};

/** Cache audio TTS di memori: kunci sha1 teks ucapan, LRU 200 entri. */
const cacheSuara = new Map();
const MAKS_CACHE_SUARA = 200;

/**
 * POST /api/gema/suara  { teks }
 *
 * Proxy ke server TTS. Teks diubah dulu ke bentuk ucapan (angka dieja, dst.).
 */
const suara = async (req, res) => {
	const teks = String(req.body?.teks || '').trim();
	if (!teks) return res.status(400).json({ success: false, message: 'Tidak ada teks' });
	if (teks.length > 1000) return res.status(400).json({ success: false, message: 'Teks terlalu panjang (maks 1000 karakter)' });
	if (!process.env.GEMA_TTS_URL) {
		return res.status(503).json({ success: false, message: 'Suara server belum dikonfigurasi' });
	}

	const ucapan = keUcapan(teks);
	const kunci = crypto.createHash('sha1').update(ucapan).digest('hex');

	let isi = cacheSuara.get(kunci);
	if (isi) {
		// Sentuh: pindahkan ke ujung supaya yang terbuang adalah yang paling lama tak dipakai.
		cacheSuara.delete(kunci);
		cacheSuara.set(kunci, isi);
	} else {
		try {
			const headers = { 'Content-Type': 'application/json' };
			if (process.env.GEMA_TTS_KEY) headers.Authorization = `Bearer ${process.env.GEMA_TTS_KEY}`;
			const hulu = await fetch(`${process.env.GEMA_TTS_URL.replace(/\/$/, '')}/tts`, {
				method: 'POST',
				headers,
				body: JSON.stringify({ teks: ucapan }),
				signal: AbortSignal.timeout(30000),
			});
			if (!hulu.ok) throw new Error(`Server suara membalas ${hulu.status}`);
			isi = {
				tipe: hulu.headers.get('content-type') || 'audio/wav',
				audio: Buffer.from(await hulu.arrayBuffer()),
			};
		} catch (error) {
			logger.error('Gema: server suara gagal:', error.message);
			return res.status(502).json({ success: false, message: 'Server suara tidak bisa dihubungi' });
		}
		cacheSuara.set(kunci, isi);
		if (cacheSuara.size > MAKS_CACHE_SUARA) cacheSuara.delete(cacheSuara.keys().next().value);
	}

	res.set('Content-Type', isi.tipe);
	return res.send(isi.audio);
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

/**
 * POST /api/gema/lupakan  { sesi }
 *
 * Mulai percakapan baru. Perlu ada tombolnya karena ingatan itu pedang bermata
 * dua: setelah lama membahas Kecamatan Jonggol, pertanyaan pertama tentang
 * topik yang sama sekali lain bisa ikut tertarik ke konteks lama. Melupakan
 * dengan sengaja lebih jelas daripada menunggu tiga puluh menit.
 */
const lupakan = (req, res) => {
	const sesi = String(req.body?.sesi || '').trim().slice(0, 64);
	if (!sesi) {
		return res.status(400).json({ success: false, message: 'Sesi tidak disebutkan' });
	}

	percakapan.lupakan(req.user?.id, sesi);
	return res.json({ success: true, data: { giliran: 0 } });
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
		suara_server: Boolean(process.env.GEMA_TTS_URL),
		// Dipakai halaman depan untuk tahu apakah perintah sandi ada gunanya ditawarkan.
		boleh_setel_sandi: boleh,
	});
};

module.exports = { tanya, tanyaAlir, suara, konfirmasi, kemampuan, lupakan, CONTOH };
