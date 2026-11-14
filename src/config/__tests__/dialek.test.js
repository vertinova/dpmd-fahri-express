const D = require('../dialek');

describe('dialek', () => {
	test('selang menolak masukan berbahaya', () => {
		for (const bad of ['1; DROP', -1, 1.5, '24', 100001, NaN]) expect(() => D.selang(bad, 'DAY')).toThrow();
		expect(() => D.selang(1, 'WEEK')).toThrow();
		expect(D.selang(24, 'HOUR')).toBe("INTERVAL '24' HOUR");
	});
	test('urutanNilai memakai ELSE 0 dan meng-escape kutip', () => {
		expect(D.urutanNilai('role', ['a', "b'c"])).toBe("CASE role WHEN 'a' THEN 1 WHEN 'b''c' THEN 2 ELSE 0 END");
	});
	test('gabungTeks', () => {
		const o = { distinct: true, urut: 'x' };
		expect(D.gabungTeks('x', o, 'mysql')).toBe("GROUP_CONCAT(DISTINCT x ORDER BY x SEPARATOR ',')");
		expect(D.gabungTeks('x', o, 'postgres')).toBe("STRING_AGG(DISTINCT CAST(x AS TEXT), ',' ORDER BY CAST(x AS TEXT))");
	});
	test('selisihWaktu', () => {
		expect(D.selisihWaktu('HOUR', 'a', 'b', 'mysql')).toBe('TIMESTAMPDIFF(HOUR, a, b)');
		expect(D.selisihWaktu('MINUTE', 'a', 'b', 'postgres')).toBe('TRUNC(EXTRACT(EPOCH FROM (b - a)) / 60)');
	});
	test('saatBentrok, sisipAbaikan, akhirAbaikan', () => {
		expect(D.saatBentrok(['k'], ['c', 'e'], 'mysql')).toBe('ON DUPLICATE KEY UPDATE c = VALUES(c), e = VALUES(e)');
		expect(D.saatBentrok(['k'], ['c', 'e'], 'postgres')).toBe('ON CONFLICT (k) DO UPDATE SET c = EXCLUDED.c, e = EXCLUDED.e');
		expect(D.sisipAbaikan('t', 'mysql')).toBe('INSERT IGNORE INTO t');
		expect(D.sisipAbaikan('t', 'postgres') + D.akhirAbaikan('postgres')).toBe('INSERT INTO t ON CONFLICT DO NOTHING');
		expect(D.akhirAbaikan('mysql')).toBe('');
	});
	test('id', () => {
		expect(D.id('order', 'mysql')).toBe('`order`');
		expect(D.id('NilaiAset', 'postgres')).toBe('"NilaiAset"');
		expect(() => D.id('a`b', 'mysql')).toThrow();
	});
	test('tahunDari, epochDetik, tanggalWib', () => {
		expect(D.tahunDari('c', 'mysql')).toBe('YEAR(c)');
		expect(D.tahunDari('c', 'postgres')).toBe('CAST(EXTRACT(YEAR FROM c) AS BIGINT)');
		expect(D.epochDetik('c', 'mysql')).toBe('UNIX_TIMESTAMP(c)');
		expect(D.epochDetik('c', 'postgres')).toBe('CAST(FLOOR(EXTRACT(EPOCH FROM c)) AS BIGINT)');
		expect(D.tanggalWib('c', 'mysql')).toBe("DATE(DATE_ADD('1970-01-01', INTERVAL UNIX_TIMESTAMP(c) + 25200 SECOND))");
		expect(D.tanggalWib('c', 'postgres')).toBe("DATE(c + INTERVAL '7' HOUR)");
	});
	test('formatWaktu menolak pola lain', () => {
		expect(D.formatWaktu('c', '%Y-%m-%d', 'mysql')).toBe("DATE_FORMAT(c, '%Y-%m-%d')");
		expect(D.formatWaktu('c', '%Y-%m', 'postgres')).toBe("TO_CHAR(c, 'YYYY-MM')");
		expect(D.formatWaktu('c', '%H:00', 'postgres')).toBe("TO_CHAR(c, 'HH24:00')");
		expect(() => D.formatWaktu('c', '%d', 'mysql')).toThrow();
	});
	test('adaDiDaftar mengembalikan Prisma.Sql dengan nilai sebagai parameter', () => {
		const m = D.adaDiDaftar('X', 'k.d', 'mysql');
		expect(m.sql).toBe('FIND_IN_SET(?, k.d) > 0');
		expect(m.values).toEqual(['X']);
		const p = D.adaDiDaftar('X', 'k.d', 'postgres');
		expect(p.sql).toBe("LOWER(?) = ANY(STRING_TO_ARRAY(LOWER(k.d), ','))");
		expect(p.values).toEqual(['X']);
	});
	test('cocokRegex, jumlah, skemaIni', () => {
		expect(D.cocokRegex('j', "^a'b", 'mysql')).toBe("j REGEXP '^a''b'");
		expect(D.cocokRegex('j', '^a', 'postgres')).toBe("j ~* '^a'");
		expect(D.jumlah('x', 'mysql')).toBe('SUM(x)');
		expect(D.jumlah('x', 'postgres')).toBe('CAST(SUM(x) AS DECIMAL)');
		expect(D.skemaIni('mysql')).toBe('DATABASE()');
		expect(D.skemaIni('postgres')).toBe('CURRENT_SCHEMA()');
	});
	test('urutNull sama di dua dialek', () => {
		expect(D.urutNull('k', 'ASC')).toBe('(k IS NULL) DESC, k ASC');
		expect(D.urutNull('k', 'DESC')).toBe('(k IS NULL) ASC, k DESC');
		expect(() => D.urutNull('k', 'X')).toThrow();
	});
	test('DIALEK mengikuti DATABASE_URL', () => {
		const lama = process.env.DATABASE_URL;
		for (const [url, hasil] of [['postgresql://x', 'postgres'], ['mysql://x', 'mysql'], [undefined, 'mysql']]) {
			if (url === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = url;
			jest.isolateModules(() => expect(require('../dialek').DIALEK).toBe(hasil));
		}
		process.env.DATABASE_URL = lama;
	});
});
