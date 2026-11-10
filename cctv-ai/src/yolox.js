/**
 * Pendeteksi orang YOLOX-s (Megvii, lisensi Apache-2.0) lewat onnxruntime-node
 * (CPU native).
 *
 * Diuji pada bingkai CCTV kantor 10 Nov 2026 (960×480): menemukan orang yang
 * dilewatkan CenterNet (mis. dua orang di ujung lorong, skor 86) dan ±1,5×
 * lebih cepat (110 vs 166 ms/bingkai). Salah deteksinya berskor 32–43 (helm di
 * motor, tiang pagar), jadi ambang bawaannya 0,45.
 *
 * Berkas model (34 MB) tidak disimpan di repo: diunduh sekali dari rilis resmi
 * YOLOX ke cctv-ai/models/ lalu diverifikasi SHA-256. Selama belum siap (atau
 * unduhan gagal), deteksi.js tetap memakai CenterNet.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const sharp = require('sharp');
const cfg = require('./config');

const URL_MODEL = 'https://github.com/Megvii-BaseDetection/YOLOX/releases/download/0.1.1rc0/yolox_s.onnx';
const SHA256_MODEL = 'c5c2d13e59ae883e6af3b45daea64af4833a4951c92d116ec270d9ddbe998063';
const BERKAS = path.join(__dirname, '..', 'models', 'yolox_s.onnx');
const UKURAN = 640; // sisi input model
const LANGKAH = [8, 16, 32];
const ULANG_UNDUH_MS = 30 * 60 * 1000;

let ort = null;
let sesi = null;
let sedangSiapkan = false;
let galat = null;

const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

const unduh = async () => {
	const r = await fetch(URL_MODEL, { signal: AbortSignal.timeout(10 * 60 * 1000) });
	if (!r.ok) throw new Error(`unduh model gagal: HTTP ${r.status}`);
	const buf = Buffer.from(await r.arrayBuffer());
	if (sha256(buf) !== SHA256_MODEL) throw new Error('checksum model YOLOX tidak cocok');
	fs.mkdirSync(path.dirname(BERKAS), { recursive: true });
	fs.writeFileSync(`${BERKAS}.part`, buf);
	fs.renameSync(`${BERKAS}.part`, BERKAS);
};

/** Muat (dan bila perlu unduh) model di latar. Gagal → coba lagi 30 menit kemudian. */
const siapkan = async () => {
	if (sesi || sedangSiapkan) return;
	sedangSiapkan = true;
	try {
		ort = ort || require('onnxruntime-node');
		if (!fs.existsSync(BERKAS) || sha256(fs.readFileSync(BERKAS)) !== SHA256_MODEL) await unduh();
		sesi = await ort.InferenceSession.create(BERKAS, { intraOpNumThreads: cfg.YOLOX_THREAD });
		galat = null;
		console.log('[cctv-ai] pendeteksi orang: YOLOX-s');
	} catch (err) {
		galat = err.message;
		console.warn(`[cctv-ai] YOLOX belum bisa dipakai (${err.message}); tetap CenterNet, dicoba lagi 30 menit lagi`);
		setTimeout(siapkan, ULANG_UNDUH_MS).unref();
	} finally {
		sedangSiapkan = false;
	}
};

const iou = ([ax, ay, aw, ah], [bx, by, bw, bh]) => {
	const irisan = Math.max(0, Math.min(ax + aw, bx + bw) - Math.max(ax, bx)) * Math.max(0, Math.min(ay + ah, by + bh) - Math.max(ay, by));
	return irisan / (aw * ah + bw * bh - irisan);
};

// Kelas COCO yang dipakai → label tampilan.
const KELAS = { 0: 'orang', 1: 'sepeda', 2: 'mobil', 3: 'motor', 5: 'bus', 7: 'truk' };
const ID_KELAS = Object.keys(KELAS).map(Number);

/**
 * Objek di satu area bingkai (a = { left, top, width, height }), koordinat
 * bingkai asli. Kotak yang menempel tepi potong (a.potong: 'kiri'/'kanan')
 * dibuang: kemungkinan objeknya terpotong dan utuh di petak lain/bingkai utuh.
 */
const deteksiArea = async (jpg, a) => {
	const r = Math.min(UKURAN / a.width, UKURAN / a.height);
	const w = Math.round(a.width * r);
	const h = Math.round(a.height * r);
	const rgb = await sharp(jpg).extract({ left: a.left, top: a.top, width: a.width, height: a.height }).resize(w, h).removeAlpha().raw().toBuffer();
	// Letterbox 640×640 berlatar 114, kanal BGR, tanpa normalisasi (praproses YOLOX ≥ 0.1.1).
	const luas = UKURAN * UKURAN;
	const data = new Float32Array(3 * luas).fill(114);
	for (let y = 0; y < h; y++) {
		for (let x = 0; x < w; x++) {
			const i = (y * w + x) * 3;
			const j = y * UKURAN + x;
			data[j] = rgb[i + 2];
			data[luas + j] = rgb[i + 1];
			data[2 * luas + j] = rgb[i];
		}
	}
	const keluar = await sesi.run({ [sesi.inputNames[0]]: new ort.Tensor('float32', data, [1, 3, UKURAN, UKURAN]) });
	const o = keluar[sesi.outputNames[0]];
	const k = o.dims[2];
	const d = o.data;

	// Dekode grid (demo_postprocess YOLOX); skor = objectness × kelas terbaik.
	const calon = [];
	let idx = 0;
	for (const s of LANGKAH) {
		const g = UKURAN / s;
		for (let gy = 0; gy < g; gy++) {
			for (let gx = 0; gx < g; gx++, idx++) {
				const b = idx * k;
				let kelas = -1;
				let score = 0;
				for (const c of ID_KELAS) {
					const n = d[b + 4] * d[b + 5 + c];
					if (n > score) { score = n; kelas = c; }
				}
				if (score < cfg.MIN_SKOR_ORANG_YOLOX) continue;
				const cx = (d[b] + gx) * s;
				const cy = (d[b + 1] + gy) * s;
				const bw = Math.exp(d[b + 2]) * s;
				const bh = Math.exp(d[b + 3]) * s;
				const x0 = Math.max(0, (cx - bw / 2) / r);
				const y0 = Math.max(0, (cy - bh / 2) / r);
				const x1 = Math.min(a.width, (cx + bw / 2) / r);
				const y1 = Math.min(a.height, (cy + bh / 2) / r);
				if (x1 - x0 < 4 || y1 - y0 < 4) continue;
				if ((a.potong === 'kanan' && x1 >= a.width - 2) || (a.potong === 'kiri' && x0 <= 2)) continue;
				calon.push({ label: KELAS[kelas], score, box: [a.left + x0, a.top + y0, x1 - x0, y1 - y0] });
			}
		}
	}
	return calon;
};

/** NMS per kelas; paling banyak 30 objek. */
const nms = (calon) => {
	const objek = [];
	for (const c of calon.sort((a, b) => b.score - a.score)) {
		if (objek.length >= 30) break;
		if (objek.every((p) => p.label !== c.label || iou(p.box, c.box) < 0.45)) objek.push(c);
	}
	return objek;
};

/**
 * Orang & kendaraan di satu bingkai JPEG: bingkai utuh, ditambah satu petak
 * (petak 0 = kiri, 1 = kanan) yang diperbesar ±1,2× supaya orang kecil/jauh
 * terbaca (bingkai utuh 960 px menyusut ke 640). Kedua petak dipakai
 * bergantian antar-analisis karena onnxruntime-node menjalankan inferensi
 * berurutan: tiap petak menambah satu inferensi penuh.
 * @returns {{ lebar, tinggi, objek: Array<{ label, box: [x, y, w, h], score }> }}
 */
const deteksi = async (jpg, petak = 0) => {
	const { width: lebar, height: tinggi } = await sharp(jpg).metadata();
	const calon = await deteksiArea(jpg, { left: 0, top: 0, width: lebar, height: tinggi });
	// Petak ±0,55 lebar (tumpang tindih ±10%); bingkai yang tidak lebar tidak dipetak.
	const lebarPetak = Math.min(lebar, Math.max(tinggi, Math.ceil(lebar * 0.55)));
	if (lebarPetak < lebar * 0.9) {
		const kanan = petak % 2 === 1;
		calon.push(...(await deteksiArea(jpg, { left: kanan ? lebar - lebarPetak : 0, top: 0, width: lebarPetak, height: tinggi, potong: kanan ? 'kiri' : 'kanan' })));
	}
	return { lebar, tinggi, objek: nms(calon) };
};

module.exports = {
	siapkan,
	deteksi,
	aktif: () => !!sesi,
	keadaan: () => ({ aktif: !!sesi, galat }),
};
