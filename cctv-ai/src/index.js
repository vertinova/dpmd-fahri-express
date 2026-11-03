/**
 * Layanan deteksi Smart CCTV DPMD — pengganti "Facial-recognition-cctv".
 *
 * Kontrak yang dipanggil backend (src/services/smartCctv.service.js):
 *   POST /cameras/:id/start | /cameras/:id/stop   — nyalakan/matikan analisis kamera
 *   POST /extract-embedding { image_base64 }       — embedding foto pendaftaran wajah
 *   POST /test-rtsp { camera_id? }                 — uji kamera lewat go2rtc
 *   GET  /cameras/:id/snapshot                     — potret terakhir dari go2rtc
 *   GET  /health                                   — keadaan layanan
 * /cameras/:id/stream sengaja 404: halaman Live lalu memakai video go2rtc
 * (MSE) yang jauh lebih mulus daripada MJPEG beranotasi.
 *
 * Hanya mendengarkan 127.0.0.1; dari luar lewat nginx /ai/ yang dibatasi GET.
 */
const http = require('http');
const cfg = require('./config');
const deteksi = require('./deteksi');
const pemantau = require('./pemantau');
// token media dibuat backend (src/utils/cctvSecret.js, kunci dari JWT_SECRET di .env yang sama)
const { tokenMediaSah } = require('../../src/utils/cctvSecret');

const balas = (res, status, isi) => {
	res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
	res.end(JSON.stringify(isi));
};

const bacaJson = (req, batas = 12 * 1024 * 1024) =>
	new Promise((resolve, reject) => {
		let ukuran = 0;
		const potongan = [];
		req.on('data', (c) => {
			ukuran += c.length;
			if (ukuran > batas) {
				reject(new Error('Muatan terlalu besar'));
				req.destroy();
				return;
			}
			potongan.push(c);
		});
		req.on('end', () => {
			try {
				resolve(potongan.length ? JSON.parse(Buffer.concat(potongan).toString('utf8')) : {});
			} catch {
				reject(new Error('JSON tidak sah'));
			}
		});
		req.on('error', reject);
	});

const server = http.createServer(async (req, res) => {
	const url = new URL(req.url, 'http://lokal');
	const p = url.pathname.replace(/\/+$/, '') || '/';
	try {
		if (req.method === 'GET' && (p === '/health' || p === '/')) {
			return balas(res, 200, { success: true, model_siap: deteksi.siap(), ...pemantau.ringkasan() });
		}

		let m = p.match(/^\/cameras\/(\d+)\/(start|stop)$/);
		if (req.method === 'POST' && m) {
			if (m[2] === 'start') pemantau.mulai(m[1]);
			else pemantau.berhenti(m[1]);
			pemantau.segarkan().catch(() => {});
			return balas(res, 200, { success: true, camera_id: Number(m[1]), running: m[2] === 'start' });
		}

		if (req.method === 'POST' && p === '/extract-embedding') {
			const body = await bacaJson(req);
			const gambar = String(body.image_base64 || '').replace(/^data:[^,]+,/, '');
			if (!gambar) return balas(res, 422, { success: false, message: 'image_base64 wajib diisi' });
			const embedding = await deteksi.embeddingFoto(Buffer.from(gambar, 'base64'));
			if (!embedding) return balas(res, 422, { success: false, message: 'Wajah tidak terdeteksi di foto. Pakai foto wajah menghadap depan dan cukup terang.' });
			pemantau.segarkan().catch(() => {});
			return balas(res, 200, { success: true, embedding });
		}

		if (req.method === 'POST' && p === '/test-rtsp') {
			const body = await bacaJson(req);
			const id = Number(body.camera_id) || null;
			if (!id) return balas(res, 200, { success: false, message: 'Uji koneksi butuh kamera yang sudah terdaftar di go2rtc.' });
			const r = await fetch(`${cfg.GO2RTC_URL}/api/frame.jpeg?src=dpmd_${id}`, { signal: AbortSignal.timeout(20000) }).catch((e) => ({ ok: false, status: e.message }));
			return balas(res, 200, r.ok
				? { success: true, message: 'Kamera menjawab dan gambar diterima.' }
				: { success: false, message: `Kamera tidak menjawab (${r.status}). Periksa URL RTSP dan jaringan.` });
		}

		// Tampilan deteksi (MJPEG bingkai bertanda) & potret: terbuka lewat nginx /ai/, jadi
		// wajib membawa token media kamera yang sama dengan go2rtc (dari /kamera/stream-url).
		m = p.match(/^\/cameras\/(\d+)\/(stream|snapshot)$/);
		if (req.method === 'GET' && m) {
			if (!tokenMediaSah(`dpmd_${m[1]}`, url.searchParams.get('t'))) return balas(res, 403, { success: false, message: 'Token media tidak sah' });
			if (m[2] === 'stream') {
				if (!pemantau.tonton(m[1], res)) return balas(res, 404, { success: false, message: 'Kamera tidak dipantau' });
				return undefined;
			}
			const bertanda = pemantau.bingkaiBertanda(m[1]);
			if (bertanda) {
				res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Cache-Control': 'no-store' });
				return res.end(bertanda);
			}
			const r = await fetch(`${cfg.GO2RTC_URL}/api/frame.jpeg?src=dpmd_${m[1]}`, { signal: AbortSignal.timeout(20000) });
			if (!r.ok) return balas(res, 404, { success: false, message: 'Potret tidak tersedia' });
			res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Cache-Control': 'no-store' });
			return res.end(Buffer.from(await r.arrayBuffer()));
		}

		if (p.startsWith('/api/v1/playback')) {
			return balas(res, 501, { success: false, message: 'Pemutaran ulang rekaman belum didukung layanan deteksi ini.' });
		}
		return balas(res, 404, { success: false, message: 'Tidak ditemukan' });
	} catch (err) {
		console.warn(`[cctv-ai] ${req.method} ${p} gagal:`, err.message);
		return balas(res, 500, { success: false, message: err.message });
	}
});

(async () => {
	if (!cfg.CCTV_SERVICE_API_KEY || !cfg.CCTV_INTERNAL_TOKEN) {
		console.error('[cctv-ai] CCTV_SERVICE_API_KEY / CCTV_INTERNAL_TOKEN belum ada di .env backend — layanan berhenti.');
		process.exit(1);
	}
	const mulai = Date.now();
	await deteksi.muat();
	console.log(`[cctv-ai] model termuat (${Date.now() - mulai} ms)`);
	server.listen(cfg.PORT, cfg.HOST, () => console.log(`[cctv-ai] mendengarkan ${cfg.HOST}:${cfg.PORT} · backend ${cfg.BACKEND_URL} · go2rtc ${cfg.GO2RTC_URL}`));
	pemantau.jalan();
})().catch((err) => {
	console.error('[cctv-ai] gagal mulai:', err);
	process.exit(1);
});
