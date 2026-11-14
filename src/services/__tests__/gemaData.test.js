/** validasiKueri Gema: hanya SELECT/WITH satu pernyataan; lapis kedua di atas hak user DB gema_ro. */

const { validasiKueri } = require('../gemaData.service');

describe('validasiKueri', () => {
  test.each([
    ['SELECT id FROM desas LIMIT 5', 'SELECT id FROM desas LIMIT 5'],
    ['WITH a AS (SELECT 1 x) SELECT x FROM a', 'WITH a AS (SELECT 1 x) SELECT x FROM a'],
    ['select id from desas;', 'select id from desas'],
    ['SELECT id -- komentar\nFROM desas /* x */', null],
  ])('lolos: %s', (sql, bersih) => {
    const r = validasiKueri(sql);
    expect(r.ok).toBe(true);
    if (bersih) expect(r.sql).toBe(bersih);
    else expect(r.sql).not.toMatch(/komentar|\/\*/);
  });

  test.each([
    'SELECT 1; SELECT 2',
    'UPDATE desas SET nama = 1',
    'DELETE FROM desas',
    'INSERT INTO desas VALUES (1)',
    'DROP TABLE desas',
    "SELECT * FROM desas INTO OUTFILE '/tmp/x'",
    'SELECT * FROM desas FOR UPDATE',
    'SELECT SLEEP(1)',
    'SELECT sleep (1)',
    '/* x */ DELETE FROM desas',
    'SELECT 1 -- x\n;DROP TABLE desas',
    '',
  ])('ditolak: %s', (sql) => {
    expect(validasiKueri(sql).ok).toBe(false);
  });
});
