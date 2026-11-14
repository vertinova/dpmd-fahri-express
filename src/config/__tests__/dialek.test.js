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
		expect(D.gabungTeks('x', o, 'postgres')).toBe("STRING_AGG(DISTINCT CAST(x AS TEXT), ',' ORDER BY x)");
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
	test('DIALEK mengikuti DATABASE_URL', () => {
		const lama = process.env.DATABASE_URL;
		for (const [url, hasil] of [['postgresql://x', 'postgres'], ['mysql://x', 'mysql'], [undefined, 'mysql']]) {
			if (url === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = url;
			jest.isolateModules(() => expect(require('../dialek').DIALEK).toBe(hasil));
		}
		process.env.DATABASE_URL = lama;
	});
});
