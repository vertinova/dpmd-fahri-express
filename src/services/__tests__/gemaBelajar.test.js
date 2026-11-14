/** Memori pengalaman Gema: pola, pemolaan panggilan, contoh, catat. Database di-mock. */

jest.mock('../../config/database', () => ({ query: jest.fn() }));
jest.mock('../../utils/logger', () => ({ warn: jest.fn(), info: jest.fn(), error: jest.fn() }));

const sequelize = require('../../config/database');
const b = require('../gemaBelajar.service');

const kamus = {
  kecamatan: [{ nama: 'Jonggol' }, { nama: 'Ciawi' }, { nama: 'Cibungbulang' }],
  desa: [{ nama: 'Jonggol' }, { nama: 'Cijayanti' }, { nama: 'Cibeuteung Muara' }],
};

describe('polaDari', () => {
  test('kecamatan jadi placeholder', () => {
    const { pola, peta } = b.polaDari('Berapa posyandu di kecamatan Jonggol?', kamus);
    expect(pola).toBe('berapa posyandu di kecamatan {kecamatan}');
    expect(peta).toEqual({ '{kecamatan}': 'Jonggol' });
  });

  test('desa dan kecamatan bernama sama dibedakan kata penanda', () => {
    expect(b.polaDari('profil desa Jonggol', kamus).pola).toBe('profil desa {desa}');
    expect(b.polaDari('profil kecamatan Jonggol', kamus).pola).toBe('profil kecamatan {kecamatan}');
  });

  test('dua kecamatan dan tahun, nama desa majemuk', () => {
    const { pola, peta } = b.polaDari('Bandingkan Ciawi, dengan Jonggol tahun 2025!', kamus);
    expect(pola).toBe('bandingkan {kecamatan} dengan {kecamatan_2} tahun {tahun}');
    expect(peta).toEqual({ '{kecamatan}': 'Ciawi', '{kecamatan_2}': 'Jonggol', '{tahun}': '2025' });
    expect(b.polaDari('kepala desa Cibeuteung Muara', kamus).pola).toBe('kepala desa {desa}');
  });
});

describe('polakanPanggilan / isiPanggilan', () => {
  test('bolak-balik termasuk SQL', () => {
    const peta = { '{kecamatan}': 'Jonggol', '{tahun}': '2025' };
    const asli = [
      { nama: 'cari_kelembagaan', argumen: { lembaga: 'posyandu', kecamatan: 'jonggol' } },
      { nama: 'kueri_data', argumen: { sql: "SELECT n FROM t WHERE kec = 'Jonggol' AND th = 2025 LIMIT 5", n: 3 } },
    ];
    const pola = b.polakanPanggilan(asli, peta);
    expect(pola[0].argumen.kecamatan).toBe('{kecamatan}');
    expect(pola[1].argumen.sql).toContain("'{kecamatan}'");
    expect(pola[1].argumen.n).toBe(3);
    expect(b.isiPanggilan(pola, { '{kecamatan}': 'Ciawi', '{tahun}': '2024' })[1].argumen.sql)
      .toBe("SELECT n FROM t WHERE kec = 'Ciawi' AND th = 2024 LIMIT 5");
    expect(b.isiPanggilan(pola, {})[0].argumen.kecamatan).toBe('{kecamatan}');
  });
});

describe('contohUntuk', () => {
  beforeEach(() => { sequelize.query.mockReset(); b.segarkanPaksa(); });

  test('baris layak dipakai dengan nama wilayah baru', async () => {
    sequelize.query
      .mockResolvedValueOnce([[]]) // DELETE
      .mockResolvedValueOnce([[{ tanda: 't1', pola: 'berapa posyandu di kecamatan {kecamatan}', id_wakil: 7 }]])
      .mockResolvedValueOnce([[{
        id: 7,
        panggilan: JSON.stringify([{ nama: 'cari_kelembagaan', argumen: { lembaga: 'posyandu', kecamatan: '{kecamatan}' } }]),
      }]]);
    const hasil = await b.contohUntuk('berapa posyandu di kecamatan Ciawi', kamus);
    expect(hasil).toContain('Panduan dari pertanyaan serupa');
    expect(hasil).toContain('cari_kelembagaan {"lembaga":"posyandu","kecamatan":"Ciawi"}');
    expect(hasil).not.toContain('Jonggol');
    // pola tak mirip
    expect(await b.contohUntuk('jumlah penduduk miskin ekstrem', kamus)).toBe('');
  });

  test('database melempar -> string kosong', async () => {
    sequelize.query.mockRejectedValue(new Error('mati'));
    expect(await b.contohUntuk('berapa posyandu di kecamatan Ciawi', kamus)).toBe('');
  });
});

describe('catat', () => {
  beforeEach(() => sequelize.query.mockReset().mockResolvedValue([5, 1]));
  const dasar = { pelaku: { id: 1 }, sesi: 's', teks: 'profil desa Cijayanti', durasi_ms: 10, kamus };
  const param = () => sequelize.query.mock.calls[0][1].replacements;

  test('panggilan sensitif tidak disimpan', async () => {
    const id = await b.catat({
      ...dasar, hasil: { ditenagai: 'model', total: 1 },
      jejak: { panggilan: [{ nama: 'cari_akun_pegawai', argumen: { nama: 'Ahmad' } }] },
    });
    expect(id).toBe(5);
    expect(param()[5]).toBeNull(); // panggilan
    expect(param()[6]).toBeNull(); // tanda
  });

  test('bukan model -> panggilan null; model -> terpola + tanda', async () => {
    const jejak = { panggilan: [{ nama: 'cari_desa', argumen: { nama: 'Cijayanti' } }] };
    await b.catat({ ...dasar, hasil: { ditenagai: 'mesin', total: 1 }, jejak });
    expect(param()[5]).toBeNull();
    sequelize.query.mockClear();
    await b.catat({ ...dasar, hasil: { ditenagai: 'model', total: 1 }, jejak });
    expect(param()[5]).toContain('{desa}');
    expect(param()[6]).toHaveLength(40);
  });

  test('galat DB -> null', async () => {
    sequelize.query.mockRejectedValue(new Error('x'));
    expect(await b.catat({ ...dasar, hasil: { ditenagai: 'mesin' }, jejak: {} })).toBeNull();
  });
});
