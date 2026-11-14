/**
 * Ekstensi Prisma khusus PostgreSQL: membuat perilaku Prisma di PG meniru MySQL
 * (placeholder `?`, boolean 1/0 di SQL mentah, urutan NULL, pencarian tak peka
 * huruf). Hanya dipasang oleh config/prisma.js bila DATABASE_URL berawalan postgres.
 * Fungsi-fungsinya murni (tanpa DB) supaya bisa dites langsung.
 */

const OP_BACA_BERSARANG = new Set(['findMany', 'findFirst', 'findFirstOrThrow', 'count', 'aggregate', 'updateMany', 'deleteMany']);
// Operasi unik/tulis: where-nya persis (unik) jadi hanya include/select bersarang yang disentuh.
const OP_BERSARANG_SAJA = new Set(['findUnique', 'findUniqueOrThrow', 'update', 'delete', 'upsert', 'create']);
const OP_PENCARIAN = ['contains', 'startsWith', 'endsWith'];
const OP_RELASI = ['some', 'every', 'none', 'is', 'isNot'];

const adalahObjek = (v) => {
	if (!v || typeof v !== 'object') return false;
	const p = Object.getPrototypeOf(v);
	return p === Object.prototype || p === null;
};

// Peta model → { namaField → field } dari DMMF, di-cache per objek dmmf.
const cachePeta = new WeakMap();
function petaModel(dmmf, namaModel) {
	let peta = cachePeta.get(dmmf);
	if (!peta) {
		peta = new Map(dmmf.models.map((m) => [m.name, new Map(m.fields.map((f) => [f.name, f]))]));
		cachePeta.set(dmmf, peta);
	}
	return peta.get(namaModel);
}

// Kunci primer model (field @id atau @@id), di-cache per objek dmmf.
const cachePk = new WeakMap();
function kunciPrimer(dmmf, namaModel) {
	let peta = cachePk.get(dmmf);
	if (!peta) {
		peta = new Map(dmmf.models.map((m) => {
			const id = m.fields.filter((f) => f.isId).map((f) => f.name);
			return [m.name, id.length ? id : (m.primaryKey && m.primaryKey.fields) || null];
		}));
		cachePk.set(dmmf, peta);
	}
	return peta.get(namaModel) || null;
}

/**
 * Tambahkan kunci primer di akhir orderBy sebagai pemutus seri. InnoDB membaca
 * menurut kunci primer sehingga nilai kembar di MySQL praktis keluar urut id; sort di
 * PostgreSQL tidak stabil, jadi tanpa ini paginasi bisa mengulang/melompati baris.
 */
function tambahPemutusSeri(namaModel, orderBy, dmmf) {
	const pk = kunciPrimer(dmmf, namaModel);
	if (!pk) return orderBy;
	const daftar = orderBy == null ? [] : Array.isArray(orderBy) ? orderBy : [orderBy];
	const ada = new Set(daftar.flatMap((o) => (adalahObjek(o) ? Object.keys(o) : [])));
	// Searah kunci urut terakhir: uji e2e menunjukkan seri pada ORDER BY ... DESC di MySQL keluar id turun.
	const terakhir = adalahObjek(daftar[daftar.length - 1]) ? Object.values(daftar[daftar.length - 1]).pop() : undefined;
	const arah = terakhir === 'desc' || (adalahObjek(terakhir) && terakhir.sort === 'desc') ? 'desc' : 'asc';
	const tambahan = pk.filter((k) => !ada.has(k)).map((k) => ({ [k]: arah }));
	return tambahan.length ? [...daftar, ...tambahan] : orderBy;
}

/**
 * Nilai JS → literal SQL PostgreSQL (standard_conforming_strings aktif, aturan escape
 * sama dengan shim config/database.js). Literal berkutip bertipe `unknown` sehingga PG
 * menyesuaikannya dengan tipe kolom (date, enum, bigint) seperti MySQL; parameter
 * terikat Prisma bertipe `text` dan gagal di `kolom_date >= $1`.
 * Mengembalikan undefined untuk nilai yang tak bisa dijadikan literal (array, objek).
 */
function literalPg(v, Decimal) {
	if (v === undefined || v === null) return 'NULL';
	const negatif = (s) => (s.startsWith('-') ? `(${s})` : s); // cegah `x-?` jadi komentar `--1`
	switch (typeof v) {
		case 'boolean': return v ? 'TRUE' : 'FALSE';
		case 'bigint': return negatif(v.toString());
		case 'number':
			if (!Number.isFinite(v)) return undefined;
			// Pecahan tetap float8 seperti saat diikat; literal 0.5 bertipe numeric (Decimal di hasil).
			return Number.isInteger(v) ? negatif(String(Object.is(v, -0) ? 0 : v)) : `CAST(${v} AS DOUBLE PRECISION)`;
		case 'string':
			if (v.includes('\0')) throw new Error('Teks mengandung byte NUL yang tidak bisa disimpan di PostgreSQL');
			return `'${v.replace(/'/g, "''")}'`;
		default: break;
	}
	if (v instanceof Date) {
		if (Number.isNaN(v.getTime())) return undefined;
		return `TIMESTAMP '${v.toISOString().replace('T', ' ').replace('Z', '')}'`; // UTC, sesi PG juga UTC
	}
	if (Buffer.isBuffer(v)) return `'\\x${v.toString('hex')}'::bytea`;
	if (Decimal && Decimal.isDecimal(v)) return negatif(v.toString());
	return undefined;
}

/** Ganti `?` jadi `$1..$n` (atau hasil `ganti(k)`), melewati string, identifier bertanda kutip, komentar, dan `?|`/`?&`. */
function tandaTanyaKeDolar(sql, ganti = (k) => `$${k}`) {
	let hasil = '';
	let jumlah = 0;
	let i = 0;
	const n = sql.length;
	while (i < n) {
		const c = sql[i];
		if (c === "'" || c === '"') {
			// Kutip ganda di dalam ('' atau "") adalah escape, bukan penutup.
			let j = i + 1;
			while (j < n) {
				if (sql[j] === c) {
					if (sql[j + 1] === c) { j += 2; continue; }
					break;
				}
				j++;
			}
			hasil += sql.slice(i, j + 1);
			i = j + 1;
		} else if (c === '-' && sql[i + 1] === '-') {
			let j = sql.indexOf('\n', i);
			if (j === -1) j = n;
			hasil += sql.slice(i, j);
			i = j;
		} else if (c === '/' && sql[i + 1] === '*') {
			let j = sql.indexOf('*/', i + 2);
			j = j === -1 ? n : j + 2;
			hasil += sql.slice(i, j);
			i = j;
		} else if (c === '?' && sql[i + 1] !== '|' && sql[i + 1] !== '&') {
			hasil += ganti(++jumlah);
			i++;
		} else {
			hasil += c;
			i++;
		}
	}
	return { sql: hasil, jumlah };
}

/** `[sql, ...param]` gaya MySQL → SQL utuh berliteral; null bila ada param yang tak bisa jadi literal. */
function sisipkanLiteralUnsafe(sql, params, Decimal) {
	const lit = params.map((v) => literalPg(v, Decimal));
	if (lit.includes(undefined)) return null;
	const { sql: hasil, jumlah } = tandaTanyaKeDolar(sql, (k) => (k <= lit.length ? lit[k - 1] : `$${k}`));
	return jumlah === lit.length ? hasil : null;
}

/** Objek Prisma.Sql (`{strings, values}`, sudah datar) → SQL utuh berliteral; null bila tak bisa. */
function sisipkanLiteralSql({ strings, values }, Decimal) {
	const lit = values.map((v) => literalPg(v, Decimal));
	if (lit.includes(undefined)) return null;
	return strings.reduce((acc, s, i) => acc + s + (i < lit.length ? lit[i] : ''), '');
}

/** Boolean tingkat-atas tiap baris SQL mentah → 1/0 seperti TINYINT(1) di MySQL. */
function angkakanBoolean(baris) {
	if (!Array.isArray(baris)) return baris;
	return baris.map((b) => {
		if (!adalahObjek(b)) return b;
		const o = {};
		for (const [k, v] of Object.entries(b)) o[k] = typeof v === 'boolean' ? Number(v) : v;
		return o;
	});
}

/** NULL paling awal saat asc, paling akhir saat desc (urutan MySQL) untuk field skalar opsional. */
function urutNullSepertiMysql(namaModel, orderBy, dmmf) {
	if (Array.isArray(orderBy)) return orderBy.map((o) => urutNullSepertiMysql(namaModel, o, dmmf));
	if (!adalahObjek(orderBy)) return orderBy;
	const fields = petaModel(dmmf, namaModel);
	const hasil = {};
	for (const [k, v] of Object.entries(orderBy)) {
		const f = fields && fields.get(k);
		if (f && f.kind === 'object') {
			hasil[k] = urutNullSepertiMysql(f.type, v, dmmf);
		} else if (f && f.kind === 'scalar' && !f.isRequired) {
			if (v === 'asc') hasil[k] = { sort: 'asc', nulls: 'first' };
			else if (v === 'desc') hasil[k] = { sort: 'desc', nulls: 'last' };
			else if (adalahObjek(v) && v.sort && !v.nulls) hasil[k] = { ...v, nulls: v.sort === 'asc' ? 'first' : 'last' };
			else hasil[k] = v;
		} else {
			hasil[k] = v; // wajib, _count, agregat
		}
	}
	return hasil;
}

/** mode:'insensitive' hanya pada contains/startsWith/endsWith; equals/in/not/gt dibiarkan (celah wildcard). */
function tanpaPekaHuruf(namaModel, where, dmmf) {
	if (Array.isArray(where)) return where.map((w) => tanpaPekaHuruf(namaModel, w, dmmf));
	if (!adalahObjek(where)) return where;
	const fields = petaModel(dmmf, namaModel);
	const hasil = {};
	for (const [k, v] of Object.entries(where)) {
		const f = fields && fields.get(k);
		if (k === 'AND' || k === 'OR' || k === 'NOT') {
			hasil[k] = tanpaPekaHuruf(namaModel, v, dmmf);
		} else if (f && f.kind === 'scalar' && f.type === 'String') {
			hasil[k] = adalahObjek(v) && !('mode' in v) && OP_PENCARIAN.some((o) => o in v) ? { ...v, mode: 'insensitive' } : v;
		} else if (f && f.kind === 'object' && adalahObjek(v)) {
			if (OP_RELASI.some((o) => o in v)) {
				hasil[k] = {};
				for (const [ok, ov] of Object.entries(v)) hasil[k][ok] = OP_RELASI.includes(ok) ? tanpaPekaHuruf(f.type, ov, dmmf) : ov;
			} else {
				hasil[k] = tanpaPekaHuruf(f.type, v, dmmf);
			}
		} else {
			hasil[k] = v;
		}
	}
	return hasil;
}

/**
 * Terapkan urutNull + tanpaPekaHuruf pada args dan seluruh include/select relasi di bawahnya.
 * pemutusSeri: tambahkan kunci primer ke orderBy (findMany/findFirst dan relasi daftar).
 */
function terapkanBersarang(namaModel, args, dmmf, { lewatiWhere = false, pemutusSeri = false } = {}) {
	if (!adalahObjek(args)) return args;
	const fields = petaModel(dmmf, namaModel);
	const hasil = { ...args };
	if (!lewatiWhere && hasil.where) hasil.where = tanpaPekaHuruf(namaModel, hasil.where, dmmf);
	if (!lewatiWhere && hasil.having) hasil.having = tanpaPekaHuruf(namaModel, hasil.having, dmmf);
	if (hasil.orderBy) hasil.orderBy = urutNullSepertiMysql(namaModel, hasil.orderBy, dmmf);
	if (pemutusSeri) {
		const ob = tambahPemutusSeri(namaModel, hasil.orderBy, dmmf);
		if (ob !== undefined) hasil.orderBy = ob;
	}
	for (const kunci of ['include', 'select']) {
		if (!adalahObjek(hasil[kunci])) continue;
		const baru = { ...hasil[kunci] };
		for (const [k, v] of Object.entries(baru)) {
			const f = fields && fields.get(k);
			if (k === '_count' && adalahObjek(v) && adalahObjek(v.select)) {
				const sel = { ...v.select };
				for (const [rk, rv] of Object.entries(sel)) {
					const rf = fields && fields.get(rk);
					if (rf && adalahObjek(rv) && rv.where) sel[rk] = { ...rv, where: tanpaPekaHuruf(rf.type, rv.where, dmmf) };
				}
				baru[k] = { ...v, select: sel };
			} else if (f && f.kind === 'object' && (adalahObjek(v) || (v === true && f.isList))) {
				// `rel: true` pada relasi daftar setara `rel: {}`; diperluas supaya bisa diberi pemutus seri.
				baru[k] = terapkanBersarang(f.type, v === true ? {} : v, dmmf, { pemutusSeri: !!f.isList });
			}
		}
		hasil[kunci] = baru;
	}
	return hasil;
}

function buatEkstensiPg(Prisma) {
	const dmmf = Prisma.dmmf.datamodel;
	const { Decimal } = Prisma;
	// SQL mentah: parameter disisipkan sebagai literal (lihat literalPg). Bila ada nilai yang
	// tak bisa jadi literal, kembali ke parameter terikat ($n) seperti sebelumnya.
	const mentahUnsafe = async ({ args, query }) => {
		if (!(Array.isArray(args) && args.length > 1 && typeof args[0] === 'string')) return query(args);
		const utuh = sisipkanLiteralUnsafe(args[0], args.slice(1), Decimal);
		return query(utuh !== null ? [utuh] : [tandaTanyaKeDolar(args[0]).sql, ...args.slice(1)]);
	};
	const mentahSql = async ({ args, query }) => {
		const utuh = args && Array.isArray(args.strings) && Array.isArray(args.values) && args.values.length
			? sisipkanLiteralSql(args, Decimal) : null;
		return query(utuh !== null ? Prisma.raw(utuh) : args);
	};
	const OP_PEMUTUS_SERI = new Set(['findMany', 'findFirst', 'findFirstOrThrow']);
	return Prisma.defineExtension({
		query: {
			$queryRawUnsafe: async (p) => angkakanBoolean(await mentahUnsafe(p)),
			$executeRawUnsafe: mentahUnsafe,
			$queryRaw: async (p) => angkakanBoolean(await mentahSql(p)),
			$executeRaw: mentahSql,
			$allModels: {
				$allOperations({ model, operation, args, query }) {
					if (OP_BACA_BERSARANG.has(operation)) return query(terapkanBersarang(model, args, dmmf, { pemutusSeri: OP_PEMUTUS_SERI.has(operation) }));
					if (operation === 'groupBy') return query({ ...args, ...(args.where && { where: tanpaPekaHuruf(model, args.where, dmmf) }), ...(args.having && { having: tanpaPekaHuruf(model, args.having, dmmf) }) });
					if (OP_BERSARANG_SAJA.has(operation)) return query(terapkanBersarang(model, args, dmmf, { lewatiWhere: true }));
					return query(args);
				},
			},
		},
	});
}

module.exports = {
	tandaTanyaKeDolar, angkakanBoolean, urutNullSepertiMysql, tanpaPekaHuruf, terapkanBersarang, buatEkstensiPg,
	literalPg, sisipkanLiteralUnsafe, sisipkanLiteralSql, tambahPemutusSeri,
};
