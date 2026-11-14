/**
 * Akses baca SQL terkurasi untuk Gema.
 *
 * Penjaga UTAMA adalah hak user DB gema_ro (hanya SELECT pada tabel yang
 * diizinkan). validasiKueri hanyalah lapis kedua, bukan pengganti hak DB.
 */

const { KATALOG } = require('../config/gemaKatalog');

const MAKS_PANJANG = 4000;
const MAKS_BARIS = 200;
const TERLARANG = /INTO\s+(OUTFILE|DUMPFILE)|FOR\s+(UPDATE|SHARE|NO\s+KEY\s+UPDATE|KEY\s+SHARE)|LOCK\s+IN\s+SHARE\s+MODE|SLEEP\s*\(|BENCHMARK\s*\(|LOAD_FILE\s*\(|GET_LOCK\s*\(|PG_\w*(SLEEP|READ|LS_DIR|STAT_FILE|TERMINATE|CANCEL|ADVISORY)\w*\s*\(|LO_(IMPORT|EXPORT)\s*\(|DBLINK\w*\s*\(|SET_CONFIG\s*\(/i;

let pool = null;

const tersedia = () => Boolean(process.env.GEMA_DB_URL);
// Dialek mengikuti GEMA_DB_URL sendiri (user baca-saja terpisah dari DATABASE_URL).
const pakaiPg = () => /^postgres/i.test(process.env.GEMA_DB_URL || '');

const ambilPool = () => {
	if (pool) return pool;
	pool = pakaiPg()
		? new (require('pg').Pool)({
			connectionString: String(process.env.GEMA_DB_URL).split('?')[0],
			max: 3,
			// Batas 5 detik dan baca-saja di tingkat sesi (padanan MAX_EXECUTION_TIME MySQL).
			options: '-c statement_timeout=5000 -c default_transaction_read_only=on',
			// COUNT/BIGINT jadi angka seperti mysql2 (pg bawaan: teks)
			types: { getTypeParser: (oid, f) => (oid === 20 && f !== 'binary' ? (v) => { const n = Number(v); return Number.isSafeInteger(n) ? n : v; } : require('pg').types.getTypeParser(oid, f)) },
		})
		: require('mysql2/promise').createPool({ uri: process.env.GEMA_DB_URL, connectionLimit: 3 });
	return pool;
};

/** Satu kueri ke pool Gema; hasil diseragamkan jadi { rows, fields }. */
const kueri = async (sql) => {
	if (pakaiPg()) {
		const r = await ambilPool().query(sql);
		return { rows: r.rows, fields: r.fields };
	}
	const koneksi = await ambilPool().getConnection();
	try {
		await koneksi.query('SET SESSION MAX_EXECUTION_TIME=5000');
		const [rows, fields] = await koneksi.query(sql);
		return { rows, fields };
	} finally {
		koneksi.release();
	}
};

/** Murni: kembalikan { ok:true, sql } atau { ok:false, alasan }. */
const validasiKueri = (sql) => {
	// shortcut: komentar dibuang dengan regex, string literal berisi "--" ikut terpotong; cukup untuk lapis kedua.
	let s = String(sql || '')
		.replace(/\/\*[\s\S]*?\*\//g, ' ')
		.replace(/--[^\n]*/g, ' ')
		.replace(/#[^\n]*/g, ' ')
		.trim()
		.replace(/;\s*$/, '')
		.trim();
	if (!s) return { ok: false, alasan: 'kueri kosong' };
	if (s.length > MAKS_PANJANG) return { ok: false, alasan: 'kueri terlalu panjang' };
	if (s.includes(';')) return { ok: false, alasan: 'hanya satu pernyataan yang boleh' };
	if (!/^(SELECT|WITH)\b/i.test(s)) return { ok: false, alasan: 'hanya SELECT atau WITH yang boleh' };
	if (TERLARANG.test(s)) return { ok: false, alasan: 'kueri mengandung konstruksi terlarang' };
	return { ok: true, sql: s };
};

/** Nilai yang tidak aman JSON (BigInt, Buffer, Date) dijadikan string/angka. */
const amankan = (v) => {
	if (typeof v === 'bigint') return Number.isSafeInteger(Number(v)) ? Number(v) : v.toString();
	if (Buffer.isBuffer(v)) return v.toString('utf8');
	if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.toISOString();
	return v;
};

const jalankanKueri = async (sql) => {
	if (!tersedia()) return { galat: 'akses data belum dikonfigurasi' };
	const cek = validasiKueri(sql);
	if (!cek.ok) return { galat: cek.alasan };

	const { rows, fields } = await kueri(`SELECT * FROM (${cek.sql}) _g LIMIT ${MAKS_BARIS}`);
	const baris = rows.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, amankan(v)])));
	return { kolom: (fields || []).map((f) => f.name), baris, total: baris.length };
};

/* ---------------------------------------------------------------- cari_tabel -- */

let cacheKolom = null;
let cacheSampai = 0;

const muatKolom = async () => {
	if (cacheKolom && Date.now() < cacheSampai) return cacheKolom;
	const { rows } = await kueri(
		`SELECT table_name AS t, column_name AS c FROM information_schema.columns WHERE table_schema = ${pakaiPg() ? 'current_schema()' : 'DATABASE()'}`,
	);
	const peta = {};
	for (const { t, c } of rows) (peta[t] ||= []).push(c);
	cacheKolom = peta;
	cacheSampai = Date.now() + 10 * 60 * 1000;
	return peta;
};

const cariTabel = async (kata) => {
	if (!tersedia()) return { galat: 'akses data belum dikonfigurasi' };
	const kunci = String(kata || '').toLowerCase().split(/[\s,]+/).filter(Boolean);
	if (!kunci.length) return { galat: 'kata kunci kosong' };

	const peta = await muatKolom();
	const hasil = [];
	for (const [tabel, kolom] of Object.entries(peta)) {
		const info = KATALOG[tabel];
		// Hanya tabel yang dikurasi di katalog yang ditawarkan ke model.
		if (!info) continue;
		let skor = 0;
		for (const k of kunci) {
			if (tabel.includes(k)) skor += 3;
			if (info.sinonim.some((s) => s.includes(k) || k.includes(s))) skor += 3;
			if (info.deskripsi.toLowerCase().includes(k)) skor += 2;
			if (kolom.some((c) => c.toLowerCase().includes(k))) skor += 1;
		}
		if (skor) hasil.push({ skor, tabel, deskripsi: info.deskripsi, kolom });
	}
	hasil.sort((a, b) => b.skor - a.skor);
	// Dibatasi ketat: CPU memproses prompt ±80 token/dtk, dan tabel bumdes saja punya 166 kolom.
	return hasil.slice(0, 5).map(({ tabel, deskripsi, kolom }) => ({
		tabel,
		deskripsi,
		kolom: kolom.slice(0, 40),
		...(kolom.length > 40 ? { kolom_lain: kolom.length - 40 } : {}),
	}));
};

/** Nama dialek untuk prompt model ('PostgreSQL 17' / 'MySQL 8'). */
const namaDialek = () => (pakaiPg() ? 'PostgreSQL 17' : 'MySQL 8');

module.exports = { validasiKueri, jalankanKueri, cariTabel, tersedia, namaDialek };
