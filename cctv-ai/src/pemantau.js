/**
 * Pemantau kamera: ambil bingkai dari go2rtc bergiliran, analisis, kirim
 * peristiwa ke backend DPMD (kontrak /api/smart-cctv/internal/*).
 *
 * Bergiliran (satu kamera satu waktu), bukan paralel: CPU server dipakai
 * bersama aplikasi lain, dan dengan ±150–400 ms per bingkai, 9 kamera tetap
 * teranalisis tiap beberapa detik.
 */
const crypto = require('crypto');
const sharp = require('sharp');
const cfg = require('./config');
const deteksi = require('./deteksi');

const kamera = new Map(); // id → { id, nama, aktif, wajahAktif, jatuhAktif, … keadaan }
const dihentikan = new Set(); // id yang diminta berhenti lewat /cameras/:id/stop
let wajahTerdaftar = []; // [{ faceId, nama, embedding }]
const statistik = { putaran: 0, bingkai: 0, gagalBingkai: 0, peristiwa: 0, terakhir: null, galat: null };

const jeda = (ms) => new Promise((r) => setTimeout(r, ms));

const keBackend = async (jalur, opsi = {}) => {
	const r = await fetch(`${cfg.BACKEND_URL}${jalur}`, { ...opsi, signal: AbortSignal.timeout(15000) });
	if (!r.ok) throw new Error(`${jalur} → HTTP ${r.status}`);
	return r.json();
};

const segarkanKamera = async () => {
	const d = await keBackend('/smart-cctv/face-recognition/cameras', {
		headers: { Authorization: `Bearer ${cfg.CCTV_SERVICE_API_KEY}` },
	});
	const ada = new Set();
	for (const k of d.cameras || []) {
		ada.add(k.id);
		const lama = kamera.get(k.id) || { rebahSejak: null, terakhirRebah: 0, jedaKenal: new Map(), jedaAsing: 0, jedaJatuh: 0, bingkaiTerakhir: null };
		kamera.set(k.id, {
			...lama,
			id: k.id,
			nama: k.name,
			aktif: k.status === 'active',
			wajahAktif: k.recognition_enabled !== false,
			jatuhAktif: k.fall_detection_enabled !== false,
		});
	}
	for (const id of kamera.keys()) if (!ada.has(id)) kamera.delete(id);
};

const segarkanWajah = async () => {
	const d = await keBackend('/smart-cctv/face-recognition/face-embeddings', {
		headers: { Authorization: `Bearer ${cfg.CCTV_SERVICE_API_KEY}` },
	});
	const daftar = [];
	for (const w of d.employees || []) {
		for (const e of w.embeddings || []) {
			// Hanya embedding buatan mesin ini (1024 dimensi); embedding dari
			// mesin lain tidak sebanding dan akan selalu meleset.
			if (Array.isArray(e.embedding) && e.embedding.length === 1024) daftar.push({ faceId: w.id, nama: w.name, embedding: e.embedding });
		}
	}
	wajahTerdaftar = daftar;
};

const ambilBingkai = async (id) => {
	const r = await fetch(`${cfg.GO2RTC_URL}/api/frame.jpeg?src=dpmd_${id}`, { signal: AbortSignal.timeout(15000) });
	if (!r.ok) throw new Error(`go2rtc HTTP ${r.status}`);
	return Buffer.from(await r.arrayBuffer());
};

/** Potret dengan kotak & label digambar di atasnya (untuk halaman Peringatan). */
const tandai = async (jpg, lebar, tinggi, kotak, label, warna) => {
	const [x, y, w, h] = kotak;
	const aman = String(label).replace(/[<>&"]/g, '');
	const tebal = Math.max(2, Math.round(lebar / 320));
	const huruf = Math.max(12, Math.round(lebar / 45));
	const svg = `<svg width="${lebar}" height="${tinggi}" xmlns="http://www.w3.org/2000/svg">
		<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="none" stroke="${warna}" stroke-width="${tebal}"/>
		<rect x="${x}" y="${Math.max(0, y - huruf - 6)}" width="${Math.min(lebar - x, aman.length * huruf * 0.62 + 10)}" height="${huruf + 6}" fill="${warna}"/>
		<text x="${x + 5}" y="${Math.max(huruf, y - 5)}" font-family="sans-serif" font-size="${huruf}" font-weight="bold" fill="#fff">${aman}</text>
	</svg>`;
	return sharp(jpg).composite([{ input: Buffer.from(svg), top: 0, left: 0 }]).jpeg({ quality: 82 }).toBuffer();
};

const kirim = async (jalur, isian, potret) => {
	const fd = new FormData();
	for (const [k, v] of Object.entries(isian)) {
		if (v === null || v === undefined) continue;
		if (Array.isArray(v)) v.forEach((x) => fd.append(`${k}[]`, String(x)));
		else fd.append(k, String(v));
	}
	if (potret) fd.append('snapshot', new Blob([potret], { type: 'image/jpeg' }), 'snapshot.jpg');
	const r = await fetch(`${cfg.BACKEND_URL}/smart-cctv/internal/${jalur}`, {
		method: 'POST',
		headers: { 'X-Internal-Token': cfg.CCTV_INTERNAL_TOKEN },
		body: fd,
		signal: AbortSignal.timeout(15000),
	});
	if (!r.ok) throw new Error(`kirim ${jalur} → HTTP ${r.status} ${await r.text().catch(() => '')}`.slice(0, 200));
	statistik.peristiwa += 1;
};

const cocokkan = (embedding) => {
	let terbaik = null;
	for (const w of wajahTerdaftar) {
		const nilai = deteksi.kemiripan(embedding, w.embedding);
		if (!terbaik || nilai > terbaik.nilai) terbaik = { ...w, nilai };
	}
	return terbaik;
};

const prosesKamera = async (k) => {
	const jpg = await ambilBingkai(k.id);
	statistik.bingkai += 1;
	const { lebar, tinggi, orang } = await deteksi.analisis(jpg);
	const kini = Date.now();
	k.bingkaiTerakhir = { pada: new Date(kini).toISOString(), orang: orang.length };

	// ── Wajah dikenal / tak dikenal ───────────────────────────────────────
	if (k.wajahAktif) {
		for (const o of orang) {
			const w = o.wajah;
			if (!w || w.skor < cfg.MIN_SKOR_WAJAH || w.kotak[2] < cfg.MIN_WAJAH_PX) continue;
			const cocok = cocokkan(w.embedding);
			const kenal = cocok && cocok.nilai >= cfg.AMBANG_KENAL;
			if (kenal) {
				if (kini - (k.jedaKenal.get(cocok.faceId) || 0) < cfg.JEDA_KENAL_MS) continue;
				k.jedaKenal.set(cocok.faceId, kini);
			} else {
				if (kini - k.jedaAsing < cfg.JEDA_ASING_MS) continue;
				k.jedaAsing = kini;
			}
			const potret = await tandai(jpg, lebar, tinggi, w.kotak, kenal ? cocok.nama : 'Tidak dikenal', kenal ? '#16a34a' : '#dc2626');
			await kirim('recognition-events', {
				event_uuid: crypto.randomUUID(),
				camera_id: k.id,
				type: kenal ? 'known' : 'unknown',
				employee_id: kenal ? cocok.faceId : null,
				similarity: cocok ? cocok.nilai.toFixed(4) : null,
				confidence: w.skor.toFixed(4),
				bbox: w.kotak,
				occurred_at: new Date(kini).toISOString(),
			}, potret);
		}
	}

	// ── Jatuh: ada orang rebah cukup lama ─────────────────────────────────
	if (k.jatuhAktif) {
		const rebah = orang.filter((o) => o.rebah).sort((a, b) => b.skor - a.skor)[0];
		if (rebah) {
			k.terakhirRebah = kini;
			if (!k.rebahSejak) k.rebahSejak = kini;
			const lama = (kini - k.rebahSejak) / 1000;
			if (lama >= cfg.BATAS_JATUH_DETIK && kini - k.jedaJatuh >= cfg.JEDA_JATUH_MS) {
				k.jedaJatuh = kini;
				const potret = await tandai(jpg, lebar, tinggi, rebah.kotak, `Jatuh / rebah ${Math.round(lama)} dtk`, '#dc2626');
				await kirim('emergency-events', {
					event_uuid: crypto.randomUUID(),
					camera_id: k.id,
					type: 'fall',
					severity: 'critical',
					confidence: rebah.skor.toFixed(4),
					bbox: rebah.kotak,
					fallen_duration: Math.round(lama),
					body_angle: rebah.sudut !== null ? Math.round(rebah.sudut) : null,
					occurred_at: new Date(kini).toISOString(),
				}, potret);
			}
		} else if (k.rebahSejak && kini - k.terakhirRebah > cfg.LUPA_REBAH_MS) {
			k.rebahSejak = null;
		}
	}
};

const jalan = async () => {
	let terakhirSegar = 0;
	for (;;) {
		const mulai = Date.now();
		try {
			if (mulai - terakhirSegar > cfg.SEGAR_DAFTAR_MS) {
				await segarkanKamera();
				await segarkanWajah();
				terakhirSegar = mulai;
			}
			for (const k of kamera.values()) {
				if (!k.aktif || dihentikan.has(k.id) || (!k.wajahAktif && !k.jatuhAktif)) continue;
				try {
					await prosesKamera(k);
				} catch (err) {
					statistik.gagalBingkai += 1;
					k.galat = err.message;
				}
			}
			statistik.putaran += 1;
			statistik.terakhir = new Date().toISOString();
			statistik.galat = null;
		} catch (err) {
			statistik.galat = err.message;
			console.warn('[cctv-ai] putaran gagal:', err.message);
		}
		await jeda(Math.max(cfg.JEDA_PUTARAN_MS - (Date.now() - mulai), 200));
	}
};

module.exports = {
	jalan,
	mulai: (id) => { dihentikan.delete(Number(id)); },
	berhenti: (id) => { dihentikan.add(Number(id)); },
	segarkan: async () => { await segarkanKamera(); await segarkanWajah(); },
	ringkasan: () => ({
		...statistik,
		kamera: [...kamera.values()].map((k) => ({
			id: k.id, nama: k.nama, aktif: k.aktif && !dihentikan.has(k.id), wajah: k.wajahAktif, jatuh: k.jatuhAktif,
			bingkai_terakhir: k.bingkaiTerakhir, galat: k.galat || null,
		})),
		wajah_terdaftar: wajahTerdaftar.length,
	}),
};
