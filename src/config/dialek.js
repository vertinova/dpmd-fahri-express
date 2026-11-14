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
	return d === 'postgres'
		? `STRING_AGG(${dist}CAST(${ekspr} AS TEXT), '${pemisah}'${o})`
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

module.exports = { DIALEK, selang, urutanNilai, gabungTeks, selisihWaktu, saatBentrok, sisipAbaikan, akhirAbaikan };
