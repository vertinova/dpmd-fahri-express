const { Prisma } = require('@prisma/client');
const {
	tandaTanyaKeDolar, angkakanBoolean, urutNullSepertiMysql, tanpaPekaHuruf, terapkanBersarang,
	literalPg, sisipkanLiteralUnsafe, sisipkanLiteralSql, tambahPemutusSeri,
} = require('../prismaPg');

const dmmf = Prisma.dmmf.datamodel;
const ins = { mode: 'insensitive' };

describe('tandaTanyaKeDolar', () => {
	test('placeholder berurutan', () => {
		expect(tandaTanyaKeDolar('SELECT * FROM t WHERE a = ? AND b > ?')).toEqual({ sql: 'SELECT * FROM t WHERE a = $1 AND b > $2', jumlah: 2 });
	});
	test('tanpa placeholder', () => {
		expect(tandaTanyaKeDolar('SELECT 1')).toEqual({ sql: 'SELECT 1', jumlah: 0 });
	});
	test('? di dalam string tunggal dilewati', () => {
		expect(tandaTanyaKeDolar("SELECT 'a?b' , ?").sql).toBe("SELECT 'a?b' , $1");
	});
	test("kutip ganda '' di dalam string", () => {
		expect(tandaTanyaKeDolar("SELECT 'it''s ?' WHERE x = ?")).toEqual({ sql: "SELECT 'it''s ?' WHERE x = $1", jumlah: 1 });
	});
	test('? di dalam identifier "..." dilewati', () => {
		expect(tandaTanyaKeDolar('SELECT "a?b" FROM t WHERE x = ?').sql).toBe('SELECT "a?b" FROM t WHERE x = $1');
	});
	test('komentar -- dilewati sampai akhir baris', () => {
		expect(tandaTanyaKeDolar('SELECT 1 -- apa?\nWHERE x = ?').sql).toBe('SELECT 1 -- apa?\nWHERE x = $1');
	});
	test('komentar /* */ dilewati', () => {
		expect(tandaTanyaKeDolar('SELECT /* ? */ ?').sql).toBe('SELECT /* ? */ $1');
	});
	test('operator jsonb ?| dan ?& dilewati', () => {
		expect(tandaTanyaKeDolar('a ?| b AND c ?& d AND e = ?').sql).toBe('a ?| b AND c ?& d AND e = $1');
	});
	test('string tak tertutup tidak melempar', () => {
		expect(tandaTanyaKeDolar("SELECT 'abc ?").jumlah).toBe(0);
	});
});

describe('angkakanBoolean', () => {
	test('boolean tingkat-atas jadi 1/0', () => {
		expect(angkakanBoolean([{ a: true, b: false, c: 'x', d: null, e: 5n }])).toEqual([{ a: 1, b: 0, c: 'x', d: null, e: 5n }]);
	});
	test('nilai bersarang tidak disentuh', () => {
		expect(angkakanBoolean([{ j: { ok: true } }])).toEqual([{ j: { ok: true } }]);
	});
	test('bukan array dikembalikan apa adanya', () => {
		expect(angkakanBoolean(3)).toBe(3);
	});
});

describe('urutNullSepertiMysql', () => {
	// users.no_hp opsional, users.name wajib
	test('opsional asc -> nulls first', () => {
		expect(urutNullSepertiMysql('users', { no_hp: 'asc' }, dmmf)).toEqual({ no_hp: { sort: 'asc', nulls: 'first' } });
	});
	test('opsional desc -> nulls last', () => {
		expect(urutNullSepertiMysql('users', { no_hp: 'desc' }, dmmf)).toEqual({ no_hp: { sort: 'desc', nulls: 'last' } });
	});
	test('bentuk {sort} dilengkapi nulls', () => {
		expect(urutNullSepertiMysql('users', { no_hp: { sort: 'desc' } }, dmmf)).toEqual({ no_hp: { sort: 'desc', nulls: 'last' } });
	});
	test('nulls eksplisit dihormati', () => {
		expect(urutNullSepertiMysql('users', { no_hp: { sort: 'asc', nulls: 'last' } }, dmmf)).toEqual({ no_hp: { sort: 'asc', nulls: 'last' } });
	});
	test('field wajib tidak diubah', () => {
		expect(urutNullSepertiMysql('users', { name: 'asc' }, dmmf)).toEqual({ name: 'asc' });
	});
	test('array orderBy', () => {
		expect(urutNullSepertiMysql('users', [{ name: 'asc' }, { no_hp: 'desc' }], dmmf)).toEqual([{ name: 'asc' }, { no_hp: { sort: 'desc', nulls: 'last' } }]);
	});
	test('relasi bersarang memakai model relasi', () => {
		expect(urutNullSepertiMysql('activity_logs', { users: { no_hp: 'asc' } }, dmmf)).toEqual({ users: { no_hp: { sort: 'asc', nulls: 'first' } } });
	});
	test('_count dibiarkan', () => {
		expect(urutNullSepertiMysql('users', { activity_logs: { _count: 'desc' } }, dmmf)).toEqual({ activity_logs: { _count: 'desc' } });
	});
	test('input asli tidak dimutasi', () => {
		const o = { no_hp: 'asc' };
		urutNullSepertiMysql('users', o, dmmf);
		expect(o).toEqual({ no_hp: 'asc' });
	});
});

describe('tanpaPekaHuruf', () => {
	test('contains/startsWith/endsWith disuntik mode', () => {
		expect(tanpaPekaHuruf('users', { name: { contains: 'a' }, email: { startsWith: 'b' }, no_hp: { endsWith: 'c' } }, dmmf))
			.toEqual({ name: { contains: 'a', ...ins }, email: { startsWith: 'b', ...ins }, no_hp: { endsWith: 'c', ...ins } });
	});
	test('equals, implisit, in, not, gt TIDAK disuntik', () => {
		const w = { name: 'A', email: { equals: '%@x.id' }, role: { in: ['A'] }, no_hp: { not: 'x' }, avatar: { gt: 'a' } };
		expect(tanpaPekaHuruf('users', w, dmmf)).toEqual(w);
	});
	test('mode yang sudah ada tidak ditimpa', () => {
		expect(tanpaPekaHuruf('users', { name: { contains: 'a', mode: 'default' } }, dmmf)).toEqual({ name: { contains: 'a', mode: 'default' } });
	});
	test('field non-String tidak disentuh', () => {
		expect(tanpaPekaHuruf('users', { id: { contains: 1 } }, dmmf)).toEqual({ id: { contains: 1 } });
	});
	test('AND/OR array dan NOT objek', () => {
		expect(tanpaPekaHuruf('users', { AND: [{ name: { contains: 'a' } }], OR: [{ email: { contains: 'b' } }], NOT: { role: { contains: 'c' } } }, dmmf))
			.toEqual({ AND: [{ name: { contains: 'a', ...ins } }], OR: [{ email: { contains: 'b', ...ins } }], NOT: { role: { contains: 'c', ...ins } } });
	});
	test('NOT array', () => {
		expect(tanpaPekaHuruf('users', { NOT: [{ name: { contains: 'a' } }] }, dmmf)).toEqual({ NOT: [{ name: { contains: 'a', ...ins } }] });
	});
	test('relasi some', () => {
		expect(tanpaPekaHuruf('users', { activity_logs: { some: { module: { contains: 'x' } } } }, dmmf))
			.toEqual({ activity_logs: { some: { module: { contains: 'x', ...ins } } } });
	});
	test('relasi to-one is dan objek where langsung', () => {
		expect(tanpaPekaHuruf('activity_logs', { users: { is: { name: { contains: 'x' } } } }, dmmf)).toEqual({ users: { is: { name: { contains: 'x', ...ins } } } });
		expect(tanpaPekaHuruf('activity_logs', { users: { name: { contains: 'x' } } }, dmmf)).toEqual({ users: { name: { contains: 'x', ...ins } } });
	});
	test('is: null tidak melempar', () => {
		expect(tanpaPekaHuruf('activity_logs', { users: { is: null } }, dmmf)).toEqual({ users: { is: null } });
	});
	test('Date/BigInt tidak dirusak', () => {
		const d = new Date();
		expect(tanpaPekaHuruf('users', { created_at: { gt: d }, id: 5n }, dmmf)).toEqual({ created_at: { gt: d }, id: 5n });
	});
});

describe('terapkanBersarang', () => {
	test('where dan orderBy tingkat-atas', () => {
		const r = terapkanBersarang('users', { where: { name: { contains: 'a' } }, orderBy: { no_hp: 'asc' } }, dmmf);
		expect(r).toEqual({ where: { name: { contains: 'a', ...ins } }, orderBy: { no_hp: { sort: 'asc', nulls: 'first' } } });
	});
	test('include bersarang dengan where + orderBy', () => {
		const r = terapkanBersarang('users', { include: { activity_logs: { where: { module: { contains: 'x' } }, orderBy: { user_name: 'desc' } } } }, dmmf);
		expect(r.include.activity_logs).toEqual({ where: { module: { contains: 'x', ...ins } }, orderBy: [{ user_name: { sort: 'desc', nulls: 'last' } }, { id: 'desc' }] });
	});
	test('select bersarang dua tingkat', () => {
		const r = terapkanBersarang('users', { select: { activity_logs: { select: { users: { where: { name: { contains: 'q' } } } } } } }, dmmf);
		expect(r.select.activity_logs.select.users.where).toEqual({ name: { contains: 'q', ...ins } });
	});
	test('_count.select dengan where', () => {
		const r = terapkanBersarang('users', { select: { _count: { select: { activity_logs: { where: { module: { contains: 'x' } } } } } } }, dmmf);
		expect(r.select._count.select.activity_logs.where).toEqual({ module: { contains: 'x', ...ins } });
	});
	test('_count: true dan select skalar dibiarkan', () => {
		const a = { select: { _count: true, name: true } };
		expect(terapkanBersarang('users', a, dmmf)).toEqual(a);
	});
	test('lewatiWhere tidak menyentuh where tingkat-atas tapi tetap bersarang', () => {
		const r = terapkanBersarang('users', { where: { name: { contains: 'a' } }, include: { activity_logs: { where: { module: { contains: 'x' } } } } }, dmmf, { lewatiWhere: true });
		expect(r.where).toEqual({ name: { contains: 'a' } });
		expect(r.include.activity_logs.where).toEqual({ module: { contains: 'x', ...ins } });
	});
	test('equals tetap tidak disuntik di args penuh', () => {
		const a = { where: { email: { equals: '%@x.id' } } };
		expect(terapkanBersarang('users', a, dmmf)).toEqual(a);
	});
	test('args kosong/undefined aman', () => {
		expect(terapkanBersarang('users', undefined, dmmf)).toBeUndefined();
		expect(terapkanBersarang('users', {}, dmmf)).toEqual({});
	});
});

describe('literalPg', () => {
	const D = Prisma.Decimal;
	test('skalar', () => {
		expect(literalPg(null)).toBe('NULL');
		expect(literalPg(undefined)).toBe('NULL');
		expect(literalPg(true)).toBe('TRUE');
		expect(literalPg(false)).toBe('FALSE');
		expect(literalPg(42)).toBe('42');
		expect(literalPg(-3)).toBe('(-3)');
		expect(literalPg(-0)).toBe('0');
		expect(literalPg(0.5)).toBe('CAST(0.5 AS DOUBLE PRECISION)');
		expect(literalPg(12n)).toBe('12');
		expect(literalPg(-12n)).toBe('(-12)');
		expect(literalPg(new D('-1.25'), D)).toBe('(-1.25)');
	});
	test('teks: kutip tunggal digandakan, backslash apa adanya, NUL ditolak', () => {
		expect(literalPg("O'Brien \\ x")).toBe("'O''Brien \\ x'");
		expect(() => literalPg('a\0b')).toThrow(/NUL/);
	});
	test('tanggal UTC, buffer, dan yang tak bisa', () => {
		expect(literalPg(new Date('2026-11-14T03:04:05.006Z'))).toBe("TIMESTAMP '2026-11-14 03:04:05.006'");
		expect(literalPg(Buffer.from([1, 255]))).toBe("'\\x01ff'::bytea");
		expect(literalPg(new Date('x'))).toBeUndefined();
		expect(literalPg(NaN)).toBeUndefined();
		expect(literalPg([1])).toBeUndefined();
		expect(literalPg({ a: 1 })).toBeUndefined();
	});
});

describe('sisipkanLiteralUnsafe', () => {
	test('urut, lewati ? di dalam string/komentar', () => {
		expect(sisipkanLiteralUnsafe("SELECT '?' AS a, ? AS b -- ?\n WHERE x >= ? AND y-?", ['2026-01-01', 7, -1]))
			.toBe("SELECT '?' AS a, '2026-01-01' AS b -- ?\n WHERE x >= 7 AND y-(-1)");
	});
	test('jumlah tidak cocok atau nilai tak bisa → null', () => {
		expect(sisipkanLiteralUnsafe('SELECT ?, ?', [1])).toBeNull();
		expect(sisipkanLiteralUnsafe('SELECT ?', [1, 2])).toBeNull();
		expect(sisipkanLiteralUnsafe('SELECT ?', [[1]])).toBeNull();
	});
	test('upaya injeksi tetap satu literal', () => {
		expect(sisipkanLiteralUnsafe('SELECT * FROM t WHERE a = ?', ["x' OR '1'='1"])).toBe("SELECT * FROM t WHERE a = 'x'' OR ''1''=''1'");
	});
});

describe('sisipkanLiteralSql', () => {
	test('Prisma.sql bersarang + join', () => {
		const q = Prisma.sql`SELECT ${5} AS a ${Prisma.sql`, ${'b'} AS b`} WHERE id IN (${Prisma.join([1, 2])})`;
		expect(sisipkanLiteralSql(q)).toBe("SELECT 5 AS a , 'b' AS b WHERE id IN (1,2)");
	});
	test('nilai array → null', () => {
		expect(sisipkanLiteralSql(Prisma.sql`SELECT ${[1, 2]}`)).toBeNull();
	});
});

describe('tambahPemutusSeri', () => {
	test('tanpa orderBy → id naik', () => {
		expect(tambahPemutusSeri('users', undefined, dmmf)).toEqual([{ id: 'asc' }]);
	});
	test('objek dan array ditambah id di akhir', () => {
		expect(tambahPemutusSeri('users', { name: 'desc' }, dmmf)).toEqual([{ name: 'desc' }, { id: 'desc' }]);
		expect(tambahPemutusSeri('users', [{ name: 'asc' }, { no_hp: { sort: 'desc', nulls: 'last' } }], dmmf)).toEqual([{ name: 'asc' }, { no_hp: { sort: 'desc', nulls: 'last' } }, { id: 'desc' }]);
		expect(tambahPemutusSeri('users', [{ name: 'asc' }], dmmf)).toEqual([{ name: 'asc' }, { id: 'asc' }]);
	});
	test('sudah ada id → tidak berubah', () => {
		const o = [{ name: 'asc' }, { id: 'desc' }];
		expect(tambahPemutusSeri('users', o, dmmf)).toBe(o);
	});
	test('terapkanBersarang: hanya bila diminta, relasi daftar true diperluas, relasi tunggal tidak', () => {
		expect(terapkanBersarang('users', { where: { id: 1 } }, dmmf)).toEqual({ where: { id: 1 } });
		expect(terapkanBersarang('users', {}, dmmf, { pemutusSeri: true })).toEqual({ orderBy: [{ id: 'asc' }] });
		const r = terapkanBersarang('users', { include: { activity_logs: true } }, dmmf);
		expect(r.include.activity_logs).toEqual({ orderBy: [{ id: 'asc' }] });
		const r2 = terapkanBersarang('activity_logs', { include: { users: true } }, dmmf);
		expect(r2.include.users).toBe(true);
	});
});
