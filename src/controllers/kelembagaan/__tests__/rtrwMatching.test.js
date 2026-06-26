// Matching logic is pure; stub the prisma-laden base controller so the module loads under Jest.
jest.mock('../base.controller', () => ({ prisma: {} }));

const { _internals } = require('../rtrwComparison.controller');
const { normalizeName, isSimilarName, compareItems } = _internals;

const db = (nama, nik, extra = {}) => ({ source: 'db', nama, normalized: normalizeName(nama), nik, ...extra });
const add = (nama, extra = {}) => ({ source: 'add', nama, normalized: normalizeName(nama), totalNilai: 0, details: [], ...extra });
const bpjs = (nama, nik, extra = {}) => ({ source: 'bpjs', nama, normalized: normalizeName(nama), nik, totalUpah: 0, details: [], ...extra });

const statusOf = (items, frag) => items.find((i) => i.nama.includes(frag));

describe('normalizeName', () => {
  it('strips trailing degree titles and commas', () => {
    expect(normalizeName('KARTOLI, SE')).toBe('KARTOLI');
    expect(normalizeName('BUDI SANTOSO, ST')).toBe('BUDI SANTOSO');
    expect(normalizeName('H. AHMAD, S.Pd')).toBe('AHMAD');
  });
});

describe('isSimilarName', () => {
  it('treats one-token spelling variants as the same person', () => {
    expect(isSimilarName('NOVA ROHIB NURDIN', 'NOVA ROHIB NOERDIN')).toBe(true);
    expect(isSimilarName('NOVA ROHIB NURDIN', 'NOVA ROHIB NURDIEN')).toBe(true);
    expect(isSimilarName('IRHOTBA MARJUANGS', 'IRHOTBA MARJUANG S')).toBe(true);
  });
  it('does not merge clearly different people', () => {
    expect(isSimilarName('SITI AMINAH', 'SITI AISYAH')).toBe(false);
    expect(isSimilarName('AHMAD FAUZI', 'DEDI MULYANA')).toBe(false);
  });
});

describe('compareItems three-source merge', () => {
  const opts = { enableFuzzy: true };

  it('reunites a name split only by a degree title (KARTOLI)', () => {
    const items = compareItems([db('KARTOLI, SE', '111')], [add('KARTOLI')], [bpjs('KARTOLI', '111')], opts);
    expect(statusOf(items, 'KARTOLI').status).toBe('all_three');
  });

  it('reunites short-vs-full DB name via BPJS+ADD (GUNTUR)', () => {
    const items = compareItems(
      [db('GUNTUR KURNIAWAN', '222')],
      [add('GUNTUR KURNIAWAN YOGIANTO')],
      [bpjs('GUNTUR KURNIAWAN YOGIANTO', '222')],
      opts,
    );
    expect(statusOf(items, 'GUNTUR').status).toBe('all_three');
  });

  it('reunites spelling variants with different NIK and flags nikMismatch (NOVA)', () => {
    const items = compareItems(
      [db('NOVA ROHIB NURDIEN', '010')],
      [add('NOVA ROHIB NURDIN')],
      [bpjs('NOVA ROHIB NOERDIN', '012')],
      opts,
    );
    const nova = statusOf(items, 'NOVA');
    expect(nova.status).toBe('all_three');
    expect(nova.nikMismatch).toBe(true);
  });

  it('keeps genuinely different people in the same desa separate', () => {
    const items = compareItems(
      [db('AHMAD FAUZI', 'A1')],
      [add('DEDI MULYANA')],
      [bpjs('SITI NURBAYA', 'B1')],
      opts,
    );
    expect(items).toHaveLength(3);
    expect(items.every((i) => i.status.startsWith('only_'))).toBe(true);
  });
});
