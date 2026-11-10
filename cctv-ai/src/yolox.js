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

/**
 * Orang di satu bingkai JPEG.
 * @returns {{ lebar, tinggi, objek: Array<{ box: [x, y, w, h], score }> }} koordinat bingkai asli
 */
const orang = async (jpg) => {
	const { width: lebar, height: tinggi } = await sharp(jpg).metadata();
	const r = Math.min(UKURAN / lebar, UKURAN / tinggi);
	const w = Math.round(lebar * r);
	const h = Math.round(tinggi * r);
	const rgb = await sharp(jpg).resize(w, h).removeAlpha().raw().toBuffer();
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

	// Dekode grid (demo_postprocess YOLOX); kelas 0 = person.
	const calon = [];
	let idx = 0;
	for (const s of LANGKAH) {
		const g = UKURAN / s;
		for (let gy = 0; gy < g; gy++) {
			for (let gx = 0; gx < g; gx++, idx++) {
				const b = idx * k;
				const score = d[b + 4] * d[b + 5];
				if (score < cfg.MIN_SKOR_ORANG_YOLOX) continue;
				const cx = (d[b] + gx) * s;
				const cy = (d[b + 1] + gy) * s;
				const bw = Math.exp(d[b + 2]) * s;
				const bh = Math.exp(d[b + 3]) * s;
				const x0 = Math.max(0, (cx - bw / 2) / r);
				const y0 = Math.max(0, (cy - bh / 2) / r);
				const x1 = Math.min(lebar, (cx + bw / 2) / r);
				const y1 = Math.min(tinggi, (cy + bh / 2) / r);
				if (x1 - x0 >= 4 && y1 - y0 >= 4) calon.push({ score, box: [x0, y0, x1 - x0, y1 - y0] });
			}
		}
	}
	// NMS
	const objek = [];
	for (const c of calon.sort((a, b) => b.score - a.score)) {
		if (objek.length >= 20) break;
		if (objek.every((p) => iou(p.box, c.box) < 0.45)) objek.push(c);
	}
	return { lebar, tinggi, objek };
};

module.exports = {
	siapkan,
	orang,
	aktif: () => !!sesi,
	keadaan: () => ({ aktif: !!sesi, galat }),
};
