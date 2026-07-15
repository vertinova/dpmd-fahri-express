// Matching logic is pure; stub the prisma-laden base controller so the module loads under Jest.
jest.mock('../base.controller', () => ({ prisma: {} }));

const { _internals } = require('../rtrwComparison.controller');
const { normalizeName, isSimilarName, compareItems, resolveMembership, markBaruOnItems } = _internals;

const db = (nama, nik, extra = {}) => ({ source: 'db', nama, normalized: normalizeName(nama), nik, ...extra });
const add = (nama, extra = {}) => ({ source: 'add', nama, normalized: normalizeName(nama), totalNilai: 0, details: [], ...extra });
const bpjs = (nama, nik, extra = {}) => ({ source: 'bpjs', nama, normalized: normalizeName(nama), nik, totalUpah: 0, details: [], ...extra });
// BPJS item pembawa detail (nik+kpj) — dibutuhkan overlay status kepesertaan.
const bpjsD = (nama, nik, kpj, extra = {}) => bpjs(nama, nik, { details: [{ nik: nik || '', kpj: kpj || '' }], ...extra });

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

describe('overlay status kepesertaan BPJS', () => {
  it('menandai AKTIF via NIK', () => {
    const items = compareItems(
      [db('BUDI SANTOSO', '111')], [],
      [bpjsD('BUDI SANTOSO', '111', 'K1')],
      { enableFuzzy: true, membershipByNik: { 111: { status: 'aktif' } }, membershipByKpj: {} },
    );
    const it = statusOf(items, 'BUDI');
    expect(it.bpjsMembership).toBe('aktif');
    expect(it.bpjsAktifCount).toBe(1);
  });

  it('menandai NON-AKTIF via KPJ (tanpa NIK) beserta sebab', () => {
    const items = compareItems(
      [], [],
      [bpjsD('SITI AMINAH', '', 'K9')],
      { enableFuzzy: true, membershipByNik: {}, membershipByKpj: { K9: { status: 'non_aktif', sebab: 'Berakhir Masa Bakti' } } },
    );
    const it = statusOf(items, 'SITI');
    expect(it.bpjsMembership).toBe('non_aktif');
    expect(it.bpjsNonAktifSebab).toBe('Berakhir Masa Bakti');
  });

  it('memberi label unmarked bila peserta BPJS tak ada di overlay', () => {
    const items = compareItems(
      [], [], [bpjsD('AGUS SALIM', '222', 'K2')],
      { enableFuzzy: true, membershipByNik: {}, membershipByKpj: {} },
    );
    expect(statusOf(items, 'AGUS').bpjsMembership).toBe('unmarked');
  });

  it('item tanpa BPJS -> bpjsMembership null', () => {
    const items = compareItems([db('DEDI MULYANA', '333')], [], [], { enableFuzzy: true });
    expect(statusOf(items, 'DEDI').bpjsMembership).toBeNull();
  });

  it('fallback nama+desa: non-aktif ketika KPJ master kosong (kasus OBAY)', () => {
    const items = compareItems(
      [db('OBAY SOBARI', '3201051505860004')], [],
      // detail master: KPJ kosong, NIK ada (persis kasus OBAY)
      [bpjs('OBAY SOBARI', '3201051505860004', { desaKode: '32.01.05.2001', details: [{ nik: '3201051505860004', kpj: '', namaLengkap: 'OBAY SOBARI', tglLahir: '1986-05-15' }] })],
      {
        enableFuzzy: true,
        membershipByNik: {}, membershipByKpj: {},
        membershipByNameDesa: { 'OBAY SOBARI|32.01.05.2001': { status: 'non_aktif', sebab: 'Mengundurkan Diri', tglLahir: '1986-05-15' } },
      },
    );
    const it = statusOf(items, 'OBAY');
    expect(it.bpjsMembership).toBe('non_aktif');
    expect(it.bpjsNonAktifSebab).toBe('Mengundurkan Diri');
  });

  it('fallback nama+desa: DITOLAK bila tgl lahir beda', () => {
    const res = resolveMembership(
      [{ desaKode: 'D1', details: [{ nik: 'X', kpj: '', namaLengkap: 'BUDI', tglLahir: '1980-01-01' }] }],
      {}, {},
      { 'BUDI|D1': { status: 'non_aktif', sebab: 'x', tglLahir: '1999-09-09' } },
    );
    expect(res.membership).toBe('unmarked');
  });

  it('resolveMembership: aktif+non-aktif -> mixed', () => {
    const res = resolveMembership(
      [{ details: [{ nik: '1', kpj: '' }, { nik: '', kpj: 'K2' }] }],
      { 1: { status: 'aktif' } },
      { K2: { status: 'non_aktif', sebab: 'Meninggal Dunia' } },
    );
    expect(res.membership).toBe('mixed');
    expect(res.aktif).toBe(1);
    expect(res.nonAktif).toBe(1);
  });
});

describe('penandaan pengurus BARU', () => {
  it('menandai item DB-tanpa-BPJS yang ada di daftar BARU (via NIK)', () => {
    const items = [{ inBpjs: false, dbNik: ['111'], normalized: 'BUDI', inBaru: false }];
    const matched = new Set();
    markBaruOnItems(items, [{ nik: '111', normalized: 'BUDI', nama: 'BUDI', jabatan: 'KETUA RT', desaKode: 'D1' }], matched);
    expect(items[0].inBaru).toBe(true);
    expect(items[0].baruJabatan).toBe('KETUA RT');
    expect(matched.has('D1|111')).toBe(true);
  });

  it('menandai anomali bila item yang sudah di BPJS juga tercatat BARU (via NIK BPJS)', () => {
    const items = [{ inBpjs: true, dbNik: [], bpjsNik: ['111'], normalized: 'BUDI', inBaru: false }];
    const matched = new Set();
    markBaruOnItems(items, [{ nik: '111', normalized: 'BUDI', nama: 'BUDI', desaKode: 'D1' }], matched);
    expect(items[0].inBaru).toBe(true);
    expect(items[0].baruAnomali).toBe(true);
    expect(items[0].baruMatchType).toBe('nik');
  });

  it('item non-BPJS yang cocok BARU bukan anomali', () => {
    const items = [{ inBpjs: false, dbNik: ['222'], bpjsNik: [], normalized: 'SITI', inBaru: false }];
    const matched = new Set();
    markBaruOnItems(items, [{ nik: '222', normalized: 'SITI', nama: 'SITI', desaKode: 'D2' }], matched);
    expect(items[0].inBaru).toBe(true);
    expect(items[0].baruAnomali).toBe(false);
  });
});
