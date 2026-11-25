jest.mock('../../config/prisma', () => ({}));
jest.mock('../sipanda.service', () => ({ fetchSipandaRows: jest.fn(), SIPANDA_TAHUN: '2026' }));

const { olahDesa, hitungTotal, susunPerhatian, kunciKode } = require('../coreRingkasan.service');

const desas = [1, 2, 3].map((i) => ({
  id: BigInt(i), nama: ['Sukamaju', 'Cibodas', 'Ciawi'][i - 1], kode: `32.01.02.200${i}`, kecamatan_id: BigInt(1),
  status_pemerintahan: 'desa', kecamatans: { nama: 'Cisarua' },
}));
desas.push({ id: BigInt(4), nama: 'Kelurahan A', kode: 'K4', kecamatan_id: BigInt(1), status_pemerintahan: 'kelurahan', kecamatans: { nama: 'Cisarua' } });

const profilLengkap = (id) => ({
  desa_id: BigInt(id), status_desa: 'Mandiri', klasifikasi_desa: 'Swasembada', jumlah_penduduk: 1000, latitude: -6.5, longitude: 106.8,
});

const bangun = (extra = {}) =>
  olahDesa({
    desas,
    profil: [profilLengkap(1), { ...profilLengkap(2), latitude: null }],
    aparaturAktif: [{ desa_id: BigInt(1), _count: { _all: 5 } }],
    kades: [{ desa_id: BigInt(1), nama_lengkap: 'Pak A' }, { desa_id: BigInt(1), nama_lengkap: 'Pak B' }],
    bumdes: [
      { id: 7, desa_id: 1, namabumdesa: 'Lama', status: 'tidak_aktif', badanhukum: 'x' },
      { id: 9, desa_id: 1, namabumdesa: 'Baru', status: 'aktif', badanhukum: '  ' },
      { id: 3, desa_id: 2, namabumdesa: 'B2', status: 'tidak_aktif', badanhukum: null },
    ],
    produkHukum: [{ desa_id: BigInt(1), _count: { _all: 3 } }],
    perdes: [{ desa_id: BigInt(1), _count: { _all: 1 } }],
    sipanda: null,
    ...extra,
  });

test('profil_lengkap false bila latitude null, true bila semua terisi', () => {
  const b = bangun();
  expect(b[0].profil_lengkap).toBe(true);
  expect(b[1].profil_lengkap).toBe(false);
  expect(b[2].profil_lengkap).toBe(false);
});

test('kades dari daftar kades; bumdes ganda memilih yang aktif', () => {
  const b = bangun();
  expect(b[0].kades).toBe('Pak A');
  expect(b[1].kades).toBeNull();
  expect(b[0].bumdes).toEqual({ id: 9, nama: 'Baru', status: 'aktif', badan_hukum: false });
  expect(b[0].aparatur).toBe(5);
  expect(b[0].skor).toBe(100);
});

test('dana dicocokkan lewat kode desa (bukan nama); cair hanya Y/y', () => {
  const sipanda = [
    // Nama sengaja beda ejaan: yang menentukan id_desa.
    { id_desa: '3201022001', kecamatan: 'CISARUA', desa: 'SUKAMAJOE', anggaran: '100', sudah_cair: 'Y' },
    { id_desa: 3201022001, kecamatan: 'cisarua', desa: 'Sukamaju', anggaran: '50', sudah_cair: 'y' },
    { id_desa: '3201022001', kecamatan: 'Cisarua', desa: 'Sukamaju', anggaran: '25', sudah_cair: 'N' },
    // Nama sama dengan desa 2, kode lain: tidak boleh ikut.
    { id_desa: '3201099999', kecamatan: 'Cisarua', desa: 'Cibodas', anggaran: '999', sudah_cair: 'Y' },
  ];
  const b = bangun({ sipanda });
  expect(b[0].dana).toEqual({ pagu: 175, cair: 150 });
  expect(b[1].dana).toBeNull();
  expect(kunciKode('32.01.02.2001')).toBe('3201022001');
});

test('hitungTotal: kelurahan tidak masuk hitungan desa; skor 1 desimal', () => {
  const t = hitungTotal(bangun());
  expect(t.desa).toBe(3);
  expect(t.kelurahan).toBe(1);
  expect(t.kades).toBe(1);
  expect(t.bumdes).toBe(2);
  expect(t.bumdes_aktif).toBe(1);
  // skor: 100, 0, 0 -> 33.3
  expect(t.skor).toBe(33.3);
  expect(t.dana).toBeNull();
  expect(hitungTotal([]).skor).toBeNull();
});

test('susunPerhatian: urutan tetap, tanpa dana bila sipanda null, kelurahan tak muncul', () => {
  const p = susunPerhatian(bangun(), { tahunDana: '2026' });
  expect(p.map((x) => x.kunci)).toEqual([
    'tanpa_kades', 'tanpa_bumdes', 'bumdes_tidak_aktif', 'tanpa_perdes', 'profil_belum_lengkap',
  ]);
  expect(p.every((x) => x.desa.every((d) => d.id !== 4))).toBe(true);
  const dana = susunPerhatian(
    bangun({ sipanda: [{ id_desa: '3201022002', kecamatan: 'Cisarua', desa: 'Cibodas', anggaran: '10', sudah_cair: 'N' }] }),
    { tahunDana: '2026' }
  );
  expect(dana[0].kunci).toBe('dana_belum_cair');
  expect(dana[0].desa.map((d) => d.nama)).toEqual(['Cibodas']);
});
