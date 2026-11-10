/**
 * Pemantau kamera: ambil bingkai dari go2rtc bergiliran, analisis, kirim
 * peristiwa ke backend DPMD (kontrak /api/smart-cctv/internal/*).
 *
 * Bingkai semua kamera diambil bersamaan (go2rtc menunggu keyframe, jadi
 * mengambil satu per satu membuat tiap kamera baru dicek belasan detik sekali),
 * lalu dianalisis bergiliran: CPU server dipakai bersama aplikasi lain.
 *
 * Tiap bingkai yang dianalisis digambari kotak (orang, wajah, rebah) dan
 * disiarkan sebagai MJPEG "tampilan deteksi" ke penonton /cameras/:id/stream.
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
		const lama = kamera.get(k.id) || { rebahSejak: null, terakhirRebah: 0, jedaKenal: new Map(), jedaAsing: 0, jedaJatuh: 0, jedaOrang: 0, orangDilapor: 0, terakhirAdaOrang: 0, bingkaiTerakhir: null, bertanda: null, penonton: new Set() };
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

/**
 * Potret dengan kotak & label digambar di atasnya.
 * tanda: [{ kotak: [x, y, w, h], label, warna }]
 */
const tandaiBanyak = async (jpg, lebar, tinggi, tanda) => {
	if (!tanda.length) return jpg;
	const tebal = Math.max(2, Math.round(lebar / 320));
	const huruf = Math.max(12, Math.round(lebar / 45));
	const isi = tanda
		.map(({ kotak: [x, y, w, h], label, warna }) => {
			const aman = String(label).replace(/[<>&"]/g, '');
			return `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="none" stroke="${warna}" stroke-width="${tebal}"/>
		<rect x="${x}" y="${Math.max(0, y - huruf - 6)}" width="${Math.min(lebar - x, aman.length * huruf * 0.62 + 10)}" height="${huruf + 6}" fill="${warna}"/>
		<text x="${x + 5}" y="${Math.max(huruf, y - 5)}" font-family="sans-serif" font-size="${huruf}" font-weight="bold" fill="#fff">${aman}</text>`;
		})
		.join('');
	const svg = `<svg width="${lebar}" height="${tinggi}" xmlns="http://www.w3.org/2000/svg">${isi}</svg>`;
	return sharp(jpg).composite([{ input: Buffer.from(svg), top: 0, left: 0 }]).jpeg({ quality: 80 }).toBuffer();
};
const tandai = (jpg, lebar, tinggi, kotak, label, warna) => tandaiBanyak(jpg, lebar, tinggi, [{ kotak, label, warna }]);

// ── tampilan deteksi (MJPEG) ─────────────────────────────────────────────
const BATAS_MJPEG = '--bingkai';
const kirimBingkai = (res, jpg) => {
	try {
		res.write(`${BATAS_MJPEG}\r\nContent-Type: image/jpeg\r\nContent-Length: ${jpg.length}\r\n\r\n`);
		res.write(jpg);
		res.write('\r\n');
	} catch {
		/* penonton sudah pergi */
	}
};
const siarkan = (k) => {
	for (const res of k.penonton) kirimBingkai(res, k.bertanda.jpg);
};

const jamWib = (ms) => new Date(ms + 7 * 3600 * 1000).getUTCHours();
const luarJamKerja = (ms) => {
	const h = jamWib(ms);
	const hari = new Date(ms + 7 * 3600 * 1000).getUTCDay();
	return hari === 0 || hari === 6 || h < cfg.JAM_KERJA_MULAI || h >= cfg.JAM_KERJA_SELESAI;
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

/** Tumpang-tindih dua kotak [x, y, w, h] (intersection over union). */
const iou = ([ax, ay, aw, ah], [bx, by, bw, bh]) => {
	const lebarIrisan = Math.max(0, Math.min(ax + aw, bx + bw) - Math.max(ax, bx));
	const tinggiIrisan = Math.max(0, Math.min(ay + ah, by + bh) - Math.max(ay, by));
	const irisan = lebarIrisan * tinggiIrisan;
	const gabungan = aw * ah + bw * bh - irisan;
	return gabungan > 0 ? irisan / gabungan : 0;
};

/**
 * Pelacakan sederhana untuk TAMPILAN saja (peristiwa & peringatan tetap memakai
 * hasil mentah): orang kecil/jauh skornya naik-turun di sekitar ambang, jadi
 * kotak orang yang terlewat di satu analisis dipertahankan sampai terlewat
 * lebih dari TAHAN_ORANG_ANALISIS kali berturut-turut.
 */
const lacakOrang = (lama, baru) => {
	const terpakai = new Set();
	const tertahan = [];
	for (const j of lama) {
		let terbaik = -1;
		let nilai = 0.2; // tumpang-tindih minimal untuk dianggap orang yang sama
		baru.forEach((b, i) => {
			if (terpakai.has(i) || b.jenis !== j.jenis) return;
			const n = iou(j.kotak, b.kotak);
			if (n > nilai) { nilai = n; terbaik = i; }
		});
		if (terbaik >= 0) terpakai.add(terbaik);
		else if (j.hilang < cfg.TAHAN_ORANG_ANALISIS) tertahan.push({ ...j, hilang: j.hilang + 1 });
	}
	return [...baru, ...tertahan];
};

const prosesKamera = async (k, jpg) => {
	statistik.bingkai += 1;
	// Petak kiri/kanan bergantian; orang kecil yang hanya terbaca di satu petak
	// ditahan lacakOrang selama analisis petak lainnya.
	k.petak = (k.petak || 0) + 1;
	const { lebar, tinggi, orang, kendaraan } = await deteksi.analisis(jpg, k.petak);
	const kini = Date.now();
	k.bingkaiTerakhir = { pada: new Date(kini).toISOString(), orang: orang.length };
	let adaPeristiwaWajah = false;

	// ── Tampilan deteksi: semua orang, wajah, & yang rebah digambari kotak ──
	const jejakBaru = orang.map((o) => {
		const t = [{ kotak: o.kotak, label: o.rebah ? 'Rebah' : `Orang ${Math.round(o.skor * 100)}%`, warna: o.rebah ? '#dc2626' : '#f59e0b' }];
		const w = o.wajah;
		if (w && w.skor >= cfg.MIN_SKOR_WAJAH && w.kotak[2] >= cfg.MIN_WAJAH_PX && wajahTerdaftar.length) {
			const cocok = cocokkan(w.embedding);
			const kenal = cocok && cocok.nilai >= cfg.AMBANG_KENAL;
			t.push({ kotak: w.kotak, label: kenal ? cocok.nama : 'Tidak dikenal', warna: kenal ? '#16a34a' : '#dc2626' });
		}
		return { kotak: o.kotak, jenis: 'orang', tanda: t, hilang: 0 };
	});
	// Kendaraan hanya untuk tampilan; peristiwa & peringatan tetap soal orang.
	for (const v of kendaraan) {
		const nama = v.jenis[0].toUpperCase() + v.jenis.slice(1);
		jejakBaru.push({ kotak: v.kotak, jenis: v.jenis, tanda: [{ kotak: v.kotak, label: `${nama} ${Math.round(v.skor * 100)}%`, warna: '#2563eb' }], hilang: 0 });
	}
	k.jejak = lacakOrang(k.jejak || [], jejakBaru);
	const tanda = k.jejak.flatMap((j) => j.tanda);
	k.bertanda = { jpg: await tandaiBanyak(jpg, lebar, tinggi, tanda), pada: kini };
	// Kotak yang sama sebagai data, untuk digambar di atas video live (GET /cameras/:id/deteksi).
	k.tandaTerakhir = { pada: kini, lebar, tinggi, tanda };
	siarkan(k);

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
			adaPeristiwaWajah = true;
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

	// ── Orang terdeteksi (termasuk yang membelakangi kamera / di tepi bingkai) ──
	// Dilaporkan paling sering sekali per JEDA_ORANG_MS per kamera, atau segera bila
	// jumlah orangnya bertambah. Di luar jam kerja / hari libur menjadi peringatan.
	if (orang.length) {
		k.terakhirAdaOrang = kini;
		const bertambah = orang.length > k.orangDilapor;
		if (!adaPeristiwaWajah && (bertambah || kini - k.jedaOrang >= cfg.JEDA_ORANG_MS) && kini - k.jedaOrang >= 8000) {
			k.jedaOrang = kini;
			k.orangDilapor = orang.length;
			const luar = luarJamKerja(kini);
			const utama = [...orang].sort((a, b) => b.kotak[2] * b.kotak[3] - a.kotak[2] * a.kotak[3])[0];
			await kirim('emergency-events', {
				event_uuid: crypto.randomUUID(),
				camera_id: k.id,
				type: 'person',
				severity: luar ? 'warning' : 'info',
				confidence: utama.skor.toFixed(4),
				bbox: utama.kotak,
				jumlah_orang: orang.length,
				luar_jam_kerja: luar,
				occurred_at: new Date(kini).toISOString(),
			}, k.bertanda.jpg);
		}
	} else if (k.orangDilapor && kini - k.terakhirAdaOrang > 30000) {
		k.orangDilapor = 0;
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
			const giliran = [...kamera.values()].filter((k) => k.aktif && !dihentikan.has(k.id) && (k.wajahAktif || k.jatuhAktif));
			const bingkai = new Map();
			for (let i = 0; i < giliran.length; i += 4) {
				await Promise.all(
					giliran.slice(i, i + 4).map((k) =>
						ambilBingkai(k.id).then(
							(jpg) => bingkai.set(k.id, jpg),
							(err) => bingkai.set(k.id, err),
						),
					),
				);
			}
			for (const k of giliran) {
				const jpg = bingkai.get(k.id);
				try {
					if (jpg instanceof Error) throw jpg;
					await prosesKamera(k, jpg);
					k.galat = null;
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

/** Penonton MJPEG tampilan deteksi kamera id. Mengembalikan false bila kamera tak dikenal. */
const tonton = (id, res) => {
	const k = kamera.get(Number(id));
	if (!k) return false;
	res.writeHead(200, {
		'Content-Type': `multipart/x-mixed-replace; boundary=${BATAS_MJPEG.slice(2)}`,
		'Cache-Control': 'no-store',
		Connection: 'keep-alive',
		'X-Accel-Buffering': 'no',
	});
	k.penonton.add(res);
	if (k.bertanda) kirimBingkai(res, k.bertanda.jpg);
	// bingkai terakhir diulang tiap 5 dtk supaya sambungan tidak dianggap mati
	const detak = setInterval(() => k.bertanda && kirimBingkai(res, k.bertanda.jpg), 5000);
	res.on('close', () => {
		clearInterval(detak);
		k.penonton.delete(res);
	});
	return true;
};
const bingkaiBertanda = (id) => kamera.get(Number(id))?.bertanda?.jpg || null;

/** Kotak analisis terakhir; umur_ms dihitung di sini supaya jam peramban yang meleset tidak berpengaruh. */
const deteksiTerakhir = (id) => {
	const t = kamera.get(Number(id))?.tandaTerakhir;
	return t ? { umur_ms: Date.now() - t.pada, lebar: t.lebar, tinggi: t.tinggi, tanda: t.tanda } : null;
};

module.exports = {
	tonton,
	bingkaiBertanda,
	deteksiTerakhir,
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
