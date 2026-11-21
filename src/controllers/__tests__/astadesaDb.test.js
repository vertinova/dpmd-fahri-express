/**
 * Jalur database Asta Desa: agregat GROUPING SETS -> ember harus sama aturannya
 * dengan jalur penyusuran API; pencocokan nilai kolom kategori untuk daftar nama.
 */

jest.mock('../../services/astadesa.service', () => ({}));
jest.mock('../../services/astadesaDb.service', () => ({ aktif: () => false }));
jest.mock('../../utils/activityLogger', () => ({ log: jest.fn() }));

const { susunDemografiDb, cocokNilaiKolom, jkDari } = require('../astadesa.controller').__uji;

// Baris seperti keluaran agregatAnggota(): gj/gp/gh/gd = grouping() per dimensi.
const jkUsia = (kec, desa, jk, usia, n) => ({ kec, desa, jk, usia, gj: 0, gp: 1, gh: 1, gd: 1, n });
const pend = (kec, desa, v, n) => ({ kec, desa, pend: v, gj: 1, gp: 0, gh: 1, gd: 1, n });
const hub = (kec, desa, v, n) => ({ kec, desa, hub: v, gj: 1, gp: 1, gh: 0, gd: 1, n });

describe('jkDari', () => {
  test.each([
    ['Laki-laki', 'L'],
    ['L', 'L'],
    ['1', 'L'],
    [' perempuan ', 'P'],
    ['WANITA', 'P'],
    ['2', 'P'],
    ['', 'lain'],
    [null, 'lain']
  ])('%p -> %p', (masuk, keluar) => expect(jkDari(masuk)).toBe(keluar));
});

describe('susunDemografiDb', () => {
  const o = susunDemografiDb([
    jkUsia('Cileungsi', 'Ds. Dayeuh', 'Laki-laki', 3, 10),
    jkUsia('Cileungsi', 'Ds. Dayeuh', 'Perempuan', 30, 5),
    jkUsia('Cileungsi', 'Ds. Dayeuh', '', null, 2),
    jkUsia('Cibinong', 'Ds. Pakansari', 'Perempuan', 70, 4),
    jkUsia('Cibinong', 'Ds. Pakansari', 'Laki-laki', 130, 1), // di luar 0–129 = tanpa usia
    pend('Cileungsi', 'Ds. Dayeuh', 'SMA', 7),
    pend('Cibinong', 'Ds. Pakansari', 'SMA', 3),
    pend('Cibinong', 'Ds. Pakansari', null, 2), // kosong tidak dihitung
    hub('Cileungsi', 'Ds. Dayeuh', 'Anak', 9)
  ]);

  test('total hanya dari set jenis kelamin x usia', () => expect(o.total).toBe(22));

  test('jenis kelamin dengan label baku', () => {
    const jk = Object.fromEntries(o.per_jenis_kelamin.map((x) => [x.label, x.total]));
    expect(jk).toEqual({ 'Laki-laki': 11, Perempuan: 9, 'Tidak diketahui': 2 });
  });

  test('piramida dan tanpa usia', () => {
    const p = Object.fromEntries(o.piramida.map((b) => [b.label, b]));
    expect(p['0–4']).toMatchObject({ L: 10, P: 0, total: 10 });
    expect(p['25–39']).toMatchObject({ P: 5, total: 5 });
    expect(p['65+']).toMatchObject({ P: 4, total: 4 });
    expect(o.tanpa_usia).toBe(3);
  });

  test('pendidikan dijumlahkan lintas desa, nilai kosong diabaikan', () => {
    expect(o.per_pendidikan).toEqual([{ label: 'SMA', total: 10 }]);
    expect(o.per_hubungan).toEqual([{ label: 'Anak', total: 9 }]);
  });

  test('per wilayah berkunci "kecamatan\\0desa" seperti jalur penyusuran', () => {
    const e = o.per_wilayah.get('Cileungsi\u0000Ds. Dayeuh');
    expect(e.total).toBe(17);
    expect(o.per_wilayah.get('Cibinong\u0000Ds. Pakansari').total).toBe(5);
    expect(o.terpeta).toBe(22);
    expect(o.tanpa_wilayah).toBe(0);
  });
});

describe('cocokNilaiKolom', () => {
  test('teks: tak peka huruf, di-trim', () => expect(cocokNilaiKolom(' Bisa ', 'bisa')).toBe(true));
  test('teks lain tidak cocok', () => expect(cocokNilaiKolom('Tidak bisa', 'Bisa')).toBe(false));
  test('array (pilihan ganda) dari kolom json', () => expect(cocokNilaiKolom(['PKH', 'BPNT'], 'bpnt')).toBe(true));
  test('JSON-array dalam teks', () => expect(cocokNilaiKolom('["PKH","BLT"]', 'BLT')).toBe(true));
  test('boolean seperti OLAH_KATEGORI', () => expect(cocokNilaiKolom(true, 'Ya')).toBe(true));
  test('kosong cocok dengan __kosong__', () => {
    expect(cocokNilaiKolom(null, '__kosong__')).toBe(true);
    expect(cocokNilaiKolom('', '__kosong__')).toBe(true);
    expect(cocokNilaiKolom([], '__kosong__')).toBe(true);
    expect(cocokNilaiKolom('Bisa', '__kosong__')).toBe(false);
  });
});
