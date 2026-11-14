/**
 * Gema — memori pengalaman ("belajar mandiri").
 *
 * Fine-tuning tidak mungkin di CPU, jadi Gema belajar lewat ingatan: tiap
 * pertanyaan dicatat beserta panggilan alatnya. Pola panggilan yang terbukti
 * benar (dinilai bagus, atau berhasil di dua sesi berbeda dan tak pernah
 * dinilai buruk) disuntikkan sebagai contoh ke pertanyaan serupa berikutnya.
 *
 * Yang dipelajari hanya CARA memanggil alat, tidak pernah angkanya: nama
 * wilayah dan tahun diganti placeholder, dan angka selalu dari hasil alat.
 * Memori tidak boleh membuat Gema gagal; semua galat DB ditelan.
 *
 * SQL di sini sengaja portabel (MySQL 8 & PostgreSQL 17): tanpa ANY_VALUE,
 * tanpa aritmetika INTERVAL, tanpa NOW(); waktu dihitung di JS.
 */

const crypto = require('crypto');
const sequelize = require('../config/database');
const logger = require('../utils/logger');

const HARI_MS = 24 * 60 * 60 * 1000;
const UMUR_CACHE_MS = 5 * 60 * 1000;
const AMBANG_MIRIP = 0.6;
const MAKS_CONTOH = 2;
const MAKS_PANJANG_CONTOH = 400;
// Tindakan/akun sensitif tidak pernah jadi contoh.
const ALAT_SENSITIF = ['siapkan_setel_ulang_sandi', 'cari_akun_pegawai'];
const KATA_HENTI = new Set(['yang', 'di', 'ke', 'dari', 'dan', 'ada', 'apa', 'itu', 'ini', 'dong', 'ya', 'tolong', 'coba', 'saya', 'gema']);

const bersihkan = (teks) => String(teks || '')
	.toLowerCase()
	.replace(/[^\p{L}\p{N}\s]/gu, ' ')
	.replace(/\s+/g, ' ')
	.trim();

/** Kueri mentah; SELECT -> array baris, tulis -> { affectedRows, insertId }. */
const q = async (sql, replacements = []) => {
	const [hasil, meta] = await sequelize.query(sql, { replacements });
	if (Array.isArray(hasil)) return hasil;
	return {
		insertId: typeof hasil === 'number' ? hasil : undefined,
		affectedRows: typeof meta === 'number' ? meta : meta?.affectedRows ?? 0,
	};
};

/* ------------------------------------------------------------------- pola -- */

/**
 * Mengubah kalimat jadi pola tanpa nama wilayah dan tahun.
 * @returns {{ pola: string, peta: Object<string,string> }} peta: placeholder -> nama asli
 */
const polaDari = (teks, kamus) => {
	const token = bersihkan(teks).split(' ').filter(Boolean);

	// Indeks kandidat menurut kata pertama: { jenis, nama, kata[] }.
	const indeks = new Map();
	const tambah = (jenis, daftar) => {
		for (const e of daftar || []) {
			const kata = bersihkan(e.nama).split(' ').filter(Boolean);
			if (!kata.length) continue;
			if (!indeks.has(kata[0])) indeks.set(kata[0], []);
			indeks.get(kata[0]).push({ jenis, nama: e.nama, kata });
		}
	};
	tambah('kecamatan', kamus?.kecamatan);
	tambah('desa', kamus?.desa);
	// Terpanjang dulu; kecamatan didahulukan bila sama panjang (sort stabil).
	for (const l of indeks.values()) l.sort((a, b) => b.kata.length - a.kata.length);

	const peta = {};
	const nomor = {};
	const pasang = (jenis, nama) => {
		const ada = Object.entries(peta).find(([k, v]) => k.startsWith(`{${jenis}`) && v === nama);
		if (ada) return ada[0];
		nomor[jenis] = (nomor[jenis] || 0) + 1;
		const ph = nomor[jenis] === 1 ? `{${jenis}}` : `{${jenis}_${nomor[jenis]}}`;
		peta[ph] = nama;
		return ph;
	};

	const keluar = [];
	for (let i = 0; i < token.length;) {
		const t = token[i];
		if (/^20\d{2}$/.test(t)) {
			if (!peta['{tahun}']) peta['{tahun}'] = t;
			keluar.push('{tahun}');
			i += 1;
			continue;
		}
		const sebelum = token[i - 1];
		const konteks = ['kecamatan', 'kec'].includes(sebelum) ? 'kecamatan'
			: ['desa', 'kelurahan'].includes(sebelum) ? 'desa' : null;
		const cocok = (indeks.get(t) || []).filter((c) => c.kata.every((k, j) => token[i + j] === k));
		const pilih = (konteks && cocok.find((c) => c.jenis === konteks)) || cocok[0];
		if (pilih) {
			keluar.push(pasang(pilih.jenis, pilih.nama));
			i += pilih.kata.length;
		} else {
			keluar.push(t);
			i += 1;
		}
	}
	return { pola: keluar.join(' '), peta };
};

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Terapkan `ubah` ke semua string di nilai (rekursif ke array/objek). */
const petakanNilai = (nilai, ubah) => {
	if (typeof nilai === 'string') return ubah(nilai);
	if (Array.isArray(nilai)) return nilai.map((v) => petakanNilai(v, ubah));
	if (nilai && typeof nilai === 'object') {
		return Object.fromEntries(Object.entries(nilai).map(([k, v]) => [k, petakanNilai(v, ubah)]));
	}
	return nilai;
};

/** Nama wilayah/tahun di argumen (termasuk SQL) -> placeholder. */
const polakanPanggilan = (panggilan, peta) => {
	// Nama terpanjang dulu supaya "Cibeuteung Muara" tidak terpotong oleh "Cibeuteung".
	const urut = Object.entries(peta || {}).sort((a, b) => b[1].length - a[1].length);
	const ubah = (s) => urut.reduce((acc, [ph, nama]) => acc.replace(new RegExp(escapeRegex(nama), 'gi'), ph), s);
	return (panggilan || []).map((c) => ({ nama: c.nama, argumen: petakanNilai(c.argumen, ubah) }));
};

/** Kebalikan polakanPanggilan; placeholder tanpa pasangan dibiarkan. */
const isiPanggilan = (panggilan, peta) => {
	const ubah = (s) => Object.entries(peta || {}).reduce((acc, [ph, nama]) => acc.split(ph).join(nama), s);
	return (panggilan || []).map((c) => ({ nama: c.nama, argumen: petakanNilai(c.argumen, ubah) }));
};

/* ------------------------------------------------------------------ catat -- */

const catat = async ({ pelaku, sesi, teks, hasil, jejak, durasi_ms: durasi, kamus }) => {
	try {
		const { pola, peta } = polaDari(teks, kamus);
		let panggilan = null;
		let tanda = null;
		const mentah = jejak?.panggilan || [];
		if (
			hasil?.ditenagai === 'model' && mentah.length
			&& !mentah.some((c) => ALAT_SENSITIF.includes(c.nama))
		) {
			panggilan = polakanPanggilan(mentah, peta);
			tanda = crypto.createHash('sha1').update(pola + JSON.stringify(panggilan)).digest('hex');
		}
		const res = await q(
			`INSERT INTO gema_pertanyaan
			 (user_id, sesi, teks, pola, ditenagai, panggilan, tanda, kalimat, total, durasi_ms)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			[
				pelaku?.id ?? null, sesi || null, String(teks).slice(0, 1000), pola.slice(0, 1000),
				String(hasil?.ditenagai || 'mesin').slice(0, 20),
				panggilan ? JSON.stringify(panggilan) : null, tanda,
				hasil?.kalimat ? String(hasil.kalimat).slice(0, 2000) : null,
				Number(hasil?.total) || 0, Math.round(durasi) || 0,
			],
		);
		return Number(res.insertId) || null;
	} catch (e) {
		logger.warn(`Gema gagal mencatat pertanyaan: ${e.message}`);
		return null;
	}
};

const nilai = async (id, userId, n) => {
	const res = await q(
		'UPDATE gema_pertanyaan SET nilai = ?, dinilai_at = ? WHERE id = ? AND user_id = ?',
		[n, new Date(), id, userId],
	);
	return res.affectedRows === 1;
};

/* ------------------------------------------------------------------ contoh -- */

// MAX(id) jadi wakil tiap tanda; kolom JSON diambil lewat kueri kedua karena
// agregat atas JSON tidak portabel.
const SQL_LAYAK = `
	SELECT tanda, MAX(pola) AS pola, MAX(id) AS id_wakil, MAX(created_at) AS terakhir
	FROM gema_pertanyaan
	WHERE ditenagai = 'model' AND panggilan IS NOT NULL AND tanda IS NOT NULL
	GROUP BY tanda
	HAVING SUM(CASE WHEN nilai = -1 THEN 1 ELSE 0 END) = 0
	   AND (SUM(CASE WHEN nilai = 1 THEN 1 ELSE 0 END) >= 1
	        OR COUNT(DISTINCT CASE WHEN total > 0 THEN sesi END) >= 2)
	ORDER BY terakhir DESC LIMIT 2000`;

const tokenPola = (pola) => new Set(pola.split(' ').filter((k) => k && !KATA_HENTI.has(k)));
const bacaJson = (v) => {
	if (typeof v !== 'string') return v;
	try { return JSON.parse(v); } catch { return null; }
};

let cache = { baris: [], sampai: 0 };
let memuat = null;
let pembersihanTerakhir = 0;

const muatCache = async () => {
	// Pembersihan data > 365 hari, paling sering sekali per 24 jam.
	if (Date.now() - pembersihanTerakhir > HARI_MS) {
		pembersihanTerakhir = Date.now();
		await q('DELETE FROM gema_pertanyaan WHERE created_at < ?', [new Date(Date.now() - 365 * HARI_MS)]).catch(() => {});
	}
	const layak = await q(SQL_LAYAK);
	const baris = [];
	if (layak.length) {
		const isi = await q('SELECT id, panggilan FROM gema_pertanyaan WHERE id IN (?)', [layak.map((b) => b.id_wakil)]);
		const petaIsi = new Map(isi.map((r) => [String(r.id), bacaJson(r.panggilan)]));
		for (const b of layak) {
			const panggilan = petaIsi.get(String(b.id_wakil));
			if (Array.isArray(panggilan)) baris.push({ pola: b.pola, token: tokenPola(b.pola), panggilan });
		}
	}
	return baris;
};

const segarkan = async () => {
	if (Date.now() < cache.sampai) return cache.baris;
	if (!memuat) {
		memuat = muatCache()
			.then((baris) => { cache = { baris, sampai: Date.now() + UMUR_CACHE_MS }; return baris; })
			.catch((e) => {
				// Jangan hantam DB tiap pertanyaan saat sedang bermasalah.
				cache = { ...cache, sampai: Date.now() + 30 * 1000 };
				throw e;
			})
			.finally(() => { memuat = null; });
	}
	return memuat;
};

/** Paksa muat ulang cache pada pemanggilan berikutnya (untuk uji). */
const segarkanPaksa = () => { cache = { ...cache, sampai: 0 }; pembersihanTerakhir = 0; };

const jaccard = (a, b) => {
	if (!a.size || !b.size) return 0;
	let sama = 0;
	for (const k of a) if (b.has(k)) sama += 1;
	return sama / (a.size + b.size - sama);
};

const contohUntuk = async (teks, kamus) => {
	try {
		const baris = await segarkan();
		if (!baris.length) return '';
		const { pola, peta } = polaDari(teks, kamus);
		const token = tokenPola(pola);
		const terpilih = [];
		const dipakai = new Set();
		const urut = baris
			.map((b) => ({ b, skor: jaccard(token, b.token) }))
			.filter((x) => x.skor >= AMBANG_MIRIP)
			.sort((x, y) => y.skor - x.skor);
		for (const { b } of urut) {
			const kunci = JSON.stringify(b.panggilan);
			if (dipakai.has(kunci)) continue;
			dipakai.add(kunci);
			terpilih.push(b);
			if (terpilih.length >= MAKS_CONTOH) break;
		}
		if (!terpilih.length) return '';
		const baik = terpilih.map((b) => {
			const kalimat = Object.entries(peta).reduce((a, [ph, nama]) => a.split(ph).join(nama), b.pola);
			const alat = isiPanggilan(b.panggilan, peta)
				.map((c) => `${c.nama} ${JSON.stringify(c.argumen)}`).join('; ');
			return `- "${kalimat}" → ${alat}`.slice(0, MAKS_PANJANG_CONTOH);
		});
		return [
			'Panduan dari pertanyaan serupa yang sudah terbukti tepat (tiru pemilihan alat dan penyaringnya; angka tetap WAJIB dari hasil alat):',
			...baik,
		].join('\n');
	} catch (e) {
		logger.warn(`Gema gagal memuat contoh: ${e.message}`);
		return '';
	}
};

/* --------------------------------------------------------------- statistik -- */

const ringkasBaris = (r) => {
	const p = bacaJson(r.panggilan);
	return {
		id: Number(r.id), teks: r.teks, kalimat: r.kalimat,
		alat: Array.isArray(p) ? p.map((c) => c.nama) : [],
		created_at: r.created_at,
	};
};

const statistik = async () => {
	const sekarang = Date.now();
	const [perMesin, penilaian, negatif, gagal, layak] = await Promise.all([
		q(`SELECT ditenagai,
		          SUM(CASE WHEN created_at >= ? THEN 1 ELSE 0 END) AS hari7, COUNT(*) AS hari30
		   FROM gema_pertanyaan WHERE created_at >= ? GROUP BY ditenagai`,
		[new Date(sekarang - 7 * HARI_MS), new Date(sekarang - 30 * HARI_MS)]),
		q(`SELECT SUM(CASE WHEN nilai = 1 THEN 1 ELSE 0 END) AS bagus,
		          SUM(CASE WHEN nilai = -1 THEN 1 ELSE 0 END) AS buruk FROM gema_pertanyaan`),
		q('SELECT id, teks, kalimat, panggilan, created_at FROM gema_pertanyaan WHERE nilai = -1 ORDER BY id DESC LIMIT 20'),
		q(`SELECT id, teks, kalimat, panggilan, created_at FROM gema_pertanyaan
		   WHERE ditenagai IN ('mesin-cadangan') OR total = 0 ORDER BY id DESC LIMIT 20`),
		segarkan().catch(() => cache.baris),
	]);
	return {
		per_penjawab: perMesin.map((r) => ({
			ditenagai: r.ditenagai, hari_7: Number(r.hari7), hari_30: Number(r.hari30),
		})),
		nilai: { bagus: Number(penilaian[0]?.bagus) || 0, buruk: Number(penilaian[0]?.buruk) || 0 },
		pola_layak: layak.length,
		dinilai_buruk: negatif.map(ringkasBaris),
		gagal: gagal.map(ringkasBaris),
	};
};

module.exports = {
	polaDari, polakanPanggilan, isiPanggilan, catat, nilai, contohUntuk, statistik, segarkanPaksa,
};
