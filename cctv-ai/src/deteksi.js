/**
 * Mesin deteksi Smart CCTV — @vladmandic/human di backend WASM (CPU saja).
 *
 * Rantai per bingkai CCTV:
 *   1. deteksi ORANG di seluruh bingkai — YOLOX-s (yolox.js, onnxruntime) bila
 *      modelnya siap, selain itu centernet; wajah di CCTV terlalu kecil untuk
 *      langsung dicari detektor wajah;
 *   2. tiap orang dipotong (diperlebar) lalu diperbesar, kemudian dicari
 *      wajahnya (blazeface + faceres → embedding 1024 dimensi) dan posenya
 *      (movenet) untuk menilai apakah orang itu rebah/jatuh.
 *
 * Model ikut di paket npm @vladmandic/human (folder models/), jadi tidak ada
 * unduhan terpisah saat pemasangan.
 */
const path = require('path');
const fs = require('fs');
const { pathToFileURL, fileURLToPath } = require('url');
const sharp = require('sharp');
const cfg = require('./config');
const yolox = require('./yolox');

const MODUL = path.join(__dirname, '..', 'node_modules');

// Build WASM Human memuat model lewat fetch, dan fetch Node tidak mengenal
// file:// — berkas model dibaca langsung dari disk.
const fetchAsli = globalThis.fetch;
globalThis.fetch = async (url, opsi) => {
	const u = String(url?.url || url);
	if (!u.startsWith('file://')) return fetchAsli(url, opsi);
	const p = fileURLToPath(u);
	return new Response(fs.readFileSync(p), {
		status: 200,
		headers: { 'Content-Type': p.endsWith('.json') ? 'application/json' : 'application/octet-stream' },
	});
};

// Peta "exports" paket Human tidak sah untuk subpath, jadi dimuat lewat path.
const { Human } = require(path.join(MODUL, '@vladmandic/human/dist/human.node-wasm.js'));

const dasar = {
	backend: 'wasm',
	wasmPath: `${path.join(MODUL, '@tensorflow/tfjs-backend-wasm/dist/').replace(/\\/g, '/')}`,
	modelBasePath: pathToFileURL(path.join(MODUL, '@vladmandic/human/models/')).href,
	debug: false,
	cacheSensitivity: 0,
	hand: { enabled: false },
	gesture: { enabled: false },
	segmentation: { enabled: false },
};

const pendeteksiOrang = new Human({
	...dasar,
	face: { enabled: false },
	body: { enabled: false },
	object: { enabled: true, modelPath: 'centernet.json', minConfidence: cfg.MIN_SKOR_ORANG, maxDetected: 20 },
});

const pemeriksa = new Human({
	...dasar,
	object: { enabled: false },
	face: {
		enabled: true,
		detector: { rotation: false, maxDetected: 3, minConfidence: 0.4 },
		mesh: { enabled: true },
		iris: { enabled: false },
		description: { enabled: true },
		emotion: { enabled: false },
		antispoof: { enabled: false },
		liveness: { enabled: false },
	},
	body: { enabled: true, modelPath: 'movenet-lightning.json', maxDetected: 1, minConfidence: 0.2 },
});

let siap = false;
const muat = async () => {
	await pendeteksiOrang.load();
	await pemeriksa.load();
	siap = true;
	yolox.siapkan(); // di latar; sampai siap, orang dicari dengan centernet
};

/** Orang di bingkai lewat centernet (cadangan bila YOLOX belum siap). */
const orangCenternet = async (jpg) => {
	const { t, lebar, tinggi } = await keTensor(pendeteksiOrang, jpg);
	let hasil;
	try {
		hasil = await pendeteksiOrang.detect(t);
	} finally {
		pendeteksiOrang.tf.dispose(t);
	}
	return { lebar, tinggi, objek: hasil.object.filter((x) => x.label === 'person') };
};

const keTensor = async (human, jpg) => {
	const { data, info } = await sharp(jpg).removeAlpha().raw().toBuffer({ resolveWithObject: true });
	return { t: human.tf.tensor3d(new Uint8Array(data), [info.height, info.width, 3], 'int32'), lebar: info.width, tinggi: info.height };
};

const titik = (badan, nama) => badan?.keypoints?.find((k) => k.part === nama && k.score >= 0.25);

/**
 * Sudut badan dari tegak (derajat): 0 = berdiri, 90 = rebah. Diukur dari
 * pinggul ke bahu; null bila titiknya tidak cukup yakin.
 */
const sudutBadan = (badan) => {
	const bahu = [titik(badan, 'leftShoulder'), titik(badan, 'rightShoulder')].filter(Boolean);
	const pinggul = [titik(badan, 'leftHip'), titik(badan, 'rightHip')].filter(Boolean);
	if (!bahu.length || !pinggul.length) return null;
	const rata = (xs) => xs.reduce((a, k) => [a[0] + k.position[0] / xs.length, a[1] + k.position[1] / xs.length], [0, 0]);
	const [bx, by] = rata(bahu);
	const [px, py] = rata(pinggul);
	return (Math.atan2(Math.abs(bx - px), Math.abs(by - py)) * 180) / Math.PI;
};

const TINGGI_POTONGAN = 640;

/**
 * Analisis satu bingkai JPEG. Kotak dalam koordinat bingkai asli [x, y, w, h].
 * @returns {{ lebar, tinggi, orang: Array<{ kotak, skor, wajah, sudut, rebah }> }}
 */
const analisis = async (jpg) => {
	if (!siap) throw new Error('Model belum termuat');
	const { lebar, tinggi, objek } = yolox.aktif() ? await yolox.orang(jpg) : await orangCenternet(jpg);

	const orang = [];
	for (const o of objek) {
		const [x, y, w, h] = o.box;
		const pad = 0.15;
		const kiri = Math.max(0, Math.round(x - w * pad));
		const atas = Math.max(0, Math.round(y - h * pad));
		const lebarPotong = Math.min(lebar - kiri, Math.round(w * (1 + 2 * pad)));
		const tinggiPotong = Math.min(tinggi - atas, Math.round(h * (1 + 2 * pad)));
		if (lebarPotong < 16 || tinggiPotong < 16) continue;

		const skala = TINGGI_POTONGAN / tinggiPotong;
		const potongan = await sharp(jpg)
			.extract({ left: kiri, top: atas, width: lebarPotong, height: tinggiPotong })
			.resize({ height: TINGGI_POTONGAN })
			.jpeg()
			.toBuffer();
		const p = await keTensor(pemeriksa, potongan);
		let r;
		try {
			r = await pemeriksa.detect(p.t);
		} finally {
			pemeriksa.tf.dispose(p.t);
		}

		const f = [...r.face].sort((a, b) => b.score - a.score)[0];
		const wajah = f?.embedding?.length
			? {
					skor: f.score,
					embedding: Array.from(f.embedding),
					// Kembali ke koordinat bingkai asli.
					kotak: [kiri + f.box[0] / skala, atas + f.box[1] / skala, f.box[2] / skala, f.box[3] / skala].map(Math.round),
				}
			: null;
		const badan = r.body[0];
		const sudut = badan && badan.score >= 0.3 ? sudutBadan(badan) : null;
		// Rebah: badan mendatar menurut pose, atau — bila pose tidak terbaca —
		// kotak orangnya jauh lebih lebar daripada tingginya. Tebakan dari bentuk
		// kotak hanya dipakai bila orangnya utuh di dalam bingkai, cukup besar, dan
		// yakin: kepala/badan yang terpotong di tepi bingkai juga berkotak lebar
		// (penyebab alarm "jatuh" palsu).
		const tepi = Math.max(4, Math.min(lebar, tinggi) * 0.02);
		const terpotong = x <= tepi || y <= tepi || x + w >= lebar - tepi || y + h >= tinggi - tepi;
		const rebah = sudut !== null ? sudut >= 60 : !terpotong && o.score >= 0.5 && h >= tinggi * 0.08 && w > h * 1.6;
		orang.push({ kotak: [x, y, w, h].map(Math.round), skor: o.score, wajah, sudut, rebah });
	}
	return { lebar, tinggi, orang };
};

/**
 * Embedding dari foto pendaftaran (wajah dekat): wajah terbesar di foto.
 * @returns {number[] | null}
 */
const embeddingFoto = async (jpg) => {
	if (!siap) throw new Error('Model belum termuat');
	const kecil = await sharp(jpg).rotate().resize({ width: 1024, height: 1024, fit: 'inside', withoutEnlargement: true }).jpeg().toBuffer();
	const { t } = await keTensor(pemeriksa, kecil);
	let r;
	try {
		r = await pemeriksa.detect(t);
	} finally {
		pemeriksa.tf.dispose(t);
	}
	const f = [...r.face].filter((x) => x.embedding?.length).sort((a, b) => b.box[2] * b.box[3] - a.box[2] * a.box[3])[0];
	return f ? Array.from(f.embedding) : null;
};

/** Kemiripan dua embedding, 0..1 (ukuran bawaan Human untuk faceres). */
const kemiripan = (a, b) => pemeriksa.match.similarity(a, b);

module.exports = {
	muat,
	analisis,
	embeddingFoto,
	kemiripan,
	siap: () => siap,
	pendeteksi: () => (yolox.aktif() ? 'yolox_s' : 'centernet'),
	keadaanYolox: yolox.keadaan,
};
