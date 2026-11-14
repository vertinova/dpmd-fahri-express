/**
 * Penulis SQL yang sah di MySQL 8 maupun PostgreSQL 17. Fungsi murni: dialek
 * dipilih dari DATABASE_URL, atau lewat argumen terakhir `d` (dipakai tes).
 * Produksi masih MySQL; bentuk MySQL harus tetap setara dengan SQL lama.
 */
const DIALEK = String(process.env.DATABASE_URL || '').startsWith('postgres') ? 'postgres' : 'mysql';

const DETIK = { MINUTE: 60, HOUR: 3600, DAY: 86400 };
const kutip = (s) => String(s).replace(/'/g, "''");

/** INTERVAL standar SQL. `n` disisipkan langsung ke SQL, jadi wajib integer. */
function selang(n, satuan) {
	if (!Number.isInteger(n) || n < 0 || n > 100000) throw new Error(`Selang tidak valid: ${n}`);
	if (!DETIK[satuan]) throw new Error(`Satuan selang tidak valid: ${satuan}`);
	return `INTERVAL '${n}' ${satuan}`;
}

/** Pengganti FIELD(): nilai di luar daftar mendapat 0 lewat ELSE (FIELD() pun 0, jadi paling depan). */
function urutanNilai(kolom, nilai) {
	return `CASE ${kolom} ${nilai.map((v, i) => `WHEN '${kutip(v)}' THEN ${i + 1}`).join(' ')} ELSE 0 END`;
}

/** GROUP_CONCAT / STRING_AGG. Tanpa `urut`, urutan di MySQL tidak dijamin; DISTINCT di PG butuh urut = ekspr. */
function gabungTeks(ekspr, { distinct = false, urut = null, pemisah = ',' } = {}, d = DIALEK) {
	const dist = distinct ? 'DISTINCT ' : '';
	const o = urut ? ` ORDER BY ${urut}` : '';
	// PG: ORDER BY pada agregat DISTINCT harus persis sama dengan argumennya (yang di-CAST).
	const oPg = urut ? ` ORDER BY ${distinct && urut === ekspr ? `CAST(${urut} AS TEXT)` : urut}` : '';
	return d === 'postgres'
		? `STRING_AGG(${dist}CAST(${ekspr} AS TEXT), '${pemisah}'${oPg})`
		: `GROUP_CONCAT(${dist}${ekspr}${o} SEPARATOR '${pemisah}')`;
}

/** Selisih b - a dalam satuan penuh, dibulatkan ke arah nol seperti TIMESTAMPDIFF. */
function selisihWaktu(satuan, a, b, d = DIALEK) {
	if (!DETIK[satuan]) throw new Error(`Satuan tidak valid: ${satuan}`);
	return d === 'postgres'
		? `TRUNC(EXTRACT(EPOCH FROM (${b} - ${a})) / ${DETIK[satuan]})`
		: `TIMESTAMPDIFF(${satuan}, ${a}, ${b})`;
}

/** Upsert. `kunci` = kolom unik/PK yang bentrok (hanya dipakai PostgreSQL). */
function saatBentrok(kunci, kolomPerbarui, d = DIALEK) {
	return d === 'postgres'
		? `ON CONFLICT (${kunci.join(', ')}) DO UPDATE SET ${kolomPerbarui.map((c) => `${c} = EXCLUDED.${c}`).join(', ')}`
		: `ON DUPLICATE KEY UPDATE ${kolomPerbarui.map((c) => `${c} = VALUES(${c})`).join(', ')}`;
}

const sisipAbaikan = (tabel, d = DIALEK) => (d === 'postgres' ? `INSERT INTO ${tabel}` : `INSERT IGNORE INTO ${tabel}`);
const akhirAbaikan = (d = DIALEK) => (d === 'postgres' ? ' ON CONFLICT DO NOTHING' : '');

/** Identifier yang wajib dikutip (kata kunci, kolom huruf campur). Nama datang dari kode, bukan pengguna. */
function id(nama, d = DIALEK) {
	if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(nama)) throw new Error(`Identifier tidak valid: ${nama}`);
	return d === 'postgres' ? `"${nama}"` : '`' + nama + '`';
}

/** YEAR() yang keluar sebagai kolom. BIGINT di PG agar tipe hasil Prisma tetap BigInt seperti MySQL. Di WHERE pakai EXTRACT. */
const tahunDari = (e, d = DIALEK) => (d === 'postgres' ? `CAST(EXTRACT(YEAR FROM ${e}) AS BIGINT)` : `YEAR(${e})`);

const POLA_WAKTU = { '%Y-%m-%d': 'YYYY-MM-DD', '%Y-%m': 'YYYY-MM', '%H:00': 'HH24:00' };
/** DATE_FORMAT / TO_CHAR; hanya pola yang dipakai kode. */
function formatWaktu(e, pola, d = DIALEK) {
	if (!POLA_WAKTU[pola]) throw new Error(`Pola waktu tidak valid: ${pola}`);
	return d === 'postgres' ? `TO_CHAR(${e}, '${POLA_WAKTU[pola]}')` : `DATE_FORMAT(${e}, '${pola}')`;
}

/** UNIX_TIMESTAMP(kolom). Kolom PG = timestamp tanpa zona berisi UTC. */
const epochDetik = (e, d = DIALEK) => (d === 'postgres' ? `CAST(FLOOR(EXTRACT(EPOCH FROM ${e})) AS BIGINT)` : `UNIX_TIMESTAMP(${e})`);

/** Tanggal WIB dari kolom UTC. Versi MySQL bebas zona sesi (lewat epoch). */
const tanggalWib = (e, d = DIALEK) => (d === 'postgres'
	? `DATE(${e} + INTERVAL '7' HOUR)`
	: `DATE(DATE_ADD('1970-01-01', INTERVAL UNIX_TIMESTAMP(${e}) + 25200 SECOND))`);

/** FIND_IN_SET(nilai, kolom) > 0 untuk tagged template Prisma; mengembalikan Prisma.Sql (nilai = parameter). */
function adaDiDaftar(nilai, kolom, d = DIALEK) {
	const { Prisma } = require('@prisma/client');
	return d === 'postgres'
		? Prisma.sql`LOWER(${nilai}) = ANY(STRING_TO_ARRAY(LOWER(${Prisma.raw(kolom)}), ','))`
		: Prisma.sql`FIND_IN_SET(${nilai}, ${Prisma.raw(kolom)}) > 0`;
}

/** REGEXP tak peka huruf (MySQL _ci). `pola` literal dari kode; kutip tunggal di-escape. */
const cocokRegex = (kolom, pola, d = DIALEK) => `${kolom} ${d === 'postgres' ? '~*' : 'REGEXP'} '${kutip(pola)}'`;

/** SUM yang langsung ke JSON lewat shim: di PG dikembalikan sebagai string seperti mysql2. */
const jumlah = (e, d = DIALEK) => (d === 'postgres' ? `CAST(SUM(${e}) AS DECIMAL)` : `SUM(${e})`);

/** ORDER BY kolom nullable: NULL di akhir untuk ASC, di awal untuk DESC (urutan MySQL), sah di dua DB. */
function urutNull(kolom, arah = 'ASC') {
	if (!['ASC', 'DESC'].includes(arah)) throw new Error(`Arah urut tidak valid: ${arah}`);
	return `(${kolom} IS NULL) ${arah === 'ASC' ? 'DESC' : 'ASC'}, ${kolom} ${arah}`;
}

/** Skema aktif untuk information_schema. */
const skemaIni = (d = DIALEK) => (d === 'postgres' ? 'CURRENT_SCHEMA()' : 'DATABASE()');

/**
 * Kolom enum yang dibandingkan dengan nilai bebas dari pengguna (filter query-string).
 * MySQL: nilai di luar enum cukup tidak cocok; PG: galat "invalid input value for enum".
 * Dibandingkan sebagai citext supaya tetap tak peka huruf seperti ENUM MySQL.
 */
const enumTeks = (kolom, d = DIALEK) => (d === 'postgres' ? `CAST(${kolom} AS citext)` : kolom);

module.exports = {
	DIALEK, selang, urutanNilai, gabungTeks, selisihWaktu, saatBentrok, sisipAbaikan, akhirAbaikan,
	id, tahunDari, formatWaktu, epochDetik, tanggalWib, adaDiDaftar, cocokRegex, jumlah, urutNull, skemaIni,
	enumTeks,
};
