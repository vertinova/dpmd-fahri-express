/**
 * Daftar nama warga Asta Desa: fungsi murni penyaring, penyusun, pengurut.
 */

jest.mock('../../services/astadesa.service', () => ({}));
jest.mock('../../utils/activityLogger', () => ({ log: jest.fn() }));

const { saringOrang, susunDaftarNama, itemAnggota } = require('../astadesa.controller').__uji;

const o = (n, s, h, j, u, p = null, d = null, k = null) => ({ n, s, h, j, u, p, d, k });
const orang = [
  o('Budi', '1', 'Kepala Keluarga', 'L', 45, 'SMA', 'Tidak'),
  o('Siti', '1', 'Istri', 'P', 40, 'SD', 'Tidak'),
  o(null, '1', 'Anak', 'P', 3, 'Belum bisa membaca'),
  o('Agus', '2', 'Kepala Keluarga', 'L', 70, 'sd ', 'Mental'),
  o('Wati', '3', 'Anak', 'lain', null, null)
];
const kkPerId = new Map([['1', 'Budi Santoso'], ['2', 'Agus Salim'], ['3', null]]);
const nama = (hasil) => hasil.items.map((i) => i.nama);

describe('saringOrang', () => {
  test('anggota: semua', () => expect(saringOrang(orang, { tipe: 'anggota' })).toHaveLength(5));

  test('sifat pendidikan: tak peka huruf dan di-trim', () => {
    const r = saringOrang(orang, { tipe: 'sifat', dim: 'pendidikan', label: 'SD' });
    expect(r.map((x) => x.n)).toEqual(['Siti', 'Agus']);
  });

  test('sifat jk: Laki-laki, Perempuan, Tidak diketahui', () => {
    const f = (label) => saringOrang(orang, { tipe: 'sifat', dim: 'jk', label }).length;
    expect([f('Laki-laki'), f('Perempuan'), f('Tidak diketahui')]).toEqual([2, 2, 1]);
  });

  test('sifat hubungan dan disabilitas', () => {
    expect(saringOrang(orang, { tipe: 'sifat', dim: 'hubungan', label: 'anak' })).toHaveLength(2);
    expect(saringOrang(orang, { tipe: 'sifat', dim: 'disabilitas', label: 'Mental' })).toHaveLength(1);
  });

  test('usia: kelompok, sisi, dan tanpa usia dikecualikan', () => {
    const f = (kelompok, sisi) => saringOrang(orang, { tipe: 'usia', kelompok, sisi }).map((x) => x.n);
    expect(f(['40–54'])).toEqual(['Budi', 'Siti']);
    expect(f(['40–54'], 'P')).toEqual(['Siti']);
    expect(f(['0–4', '65+'])).toEqual([null, 'Agus']);
  });
});

describe('susunDaftarNama', () => {
  const susun = (filter, extra = {}) => susunDaftarNama({ sumber: orang, kkPerId, filter, halaman: 1, ...extra });

  test('nama kosong -> tampil memakai nama KK; keterangan memuat hubungan', () => {
    const i = itemAnggota(orang[2], 'Budi Santoso');
    expect(i.tampil).toBe('Anggota keluarga dari Budi Santoso');
    expect(i.keterangan).toBe('Anak · keluarga Budi Santoso');
    expect(itemAnggota(orang[2], null).tampil).toBe('Anggota keluarga dari kepala keluarga tanpa nama');
  });

  test('urut: nama KK, kepala dulu, lalu nama; KK kosong di akhir', () => {
    const h = susun({ tipe: 'anggota' });
    expect(nama(h)).toEqual(['Agus', 'Budi', 'Siti', null, 'Wati']);
  });

  test('pencarian q di nama atau nama KK', () => {
    expect(nama(susun({ tipe: 'anggota' }, { q: 'siti' }))).toEqual(['Siti']);
    expect(susun({ tipe: 'anggota' }, { q: 'santoso' }).total).toBe(3);
  });

  test('tidak membocorkan field sensitif', () => {
    expect(Object.keys(susun({ tipe: 'anggota' }).items[0]).sort()).toEqual(
      ['hubungan', 'jk', 'keterangan', 'kk_nama', 'nama', 'sensus_id', 'tampil', 'usia']
    );
  });

  test('paginasi 50 per halaman', () => {
    const banyak = Array.from({ length: 120 }, (_, i) => o(`N${String(i).padStart(3, '0')}`, '1', 'Anak', 'L', 10));
    const h2 = susunDaftarNama({ sumber: banyak, kkPerId, filter: { tipe: 'anggota' }, halaman: 3 });
    expect(h2.total).toBe(120);
    expect(h2.per_halaman).toBe(50);
    expect(h2.items).toHaveLength(20);
    expect(h2.halaman).toBe(3);
  });

  test('tipe keluarga: nama = nama KK', () => {
    const h = susunDaftarNama({
      sumber: [{ id: 2, kk_nama: 'Zed' }, { id: 1, kk_nama: 'Ani' }, { id: 3, kk_nama: null }],
      kkPerId,
      filter: { tipe: 'keluarga' },
      halaman: 1
    });
    expect(h.items.map((i) => i.tampil)).toEqual(['Ani', 'Zed', 'Kepala keluarga tanpa nama']);
    expect(h.items[0].keterangan).toBe('Kepala keluarga');
  });
});
