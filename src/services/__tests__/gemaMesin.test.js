/**
 * Mesin kata kunci Gema: pencocokan di batas kata, daftar desa per kecamatan,
 * nama desa kembar, dan tahun keuangan. Prisma, kamus, dan SIPANDA di-mock.
 */

jest.mock('../../config/prisma', () => ({
  desas: { findMany: jest.fn(async () => [
    { id: 1, nama: 'Sukamaju', status_pemerintahan: 'desa' },
    { id: 2, nama: 'Cibatu', status_pemerintahan: 'kelurahan' },
  ]) },
  profil_desas: {
    count: jest.fn(async () => 1),
    findMany: jest.fn(async () => []),
  },
  rts: {
    count: jest.fn(async () => 5),
    findMany: jest.fn(async () => []),
    groupBy: jest.fn(async () => []),
  },
}));

jest.mock('../gemaKamus.service', () => ({
  muatKamus: jest.fn(async () => ({
    kecamatan: [
      { id: 1, nama: 'Cibinong', kunci: 'cibinong' },
      { id: 2, nama: 'Jonggol', kunci: 'jonggol' },
      { id: 3, nama: 'Leuwiliang', kunci: 'leuwiliang' },
    ],
    desa: [
      { id: 1, nama: 'Sukamaju', kunci: 'sukamaju', kecamatan: 'Cibinong', kecamatan_id: 1 },
      { id: 2, nama: 'Sukamaju', kunci: 'sukamaju', kecamatan: 'Jonggol', kecamatan_id: 2 },
      { id: 3, nama: 'Sukamaju', kunci: 'sukamaju', kecamatan: 'Leuwiliang', kecamatan_id: 3 },
      { id: 4, nama: 'Cijayanti', kunci: 'cijayanti', kecamatan: 'Jonggol', kecamatan_id: 2 },
    ],
    nilai: [
      { kolom: 'tipologi_desa', nilai: 'Persawahan', kunci: 'persawahan' },
      { kolom: 'klasifikasi_desa', nilai: 'Swakarya', kunci: 'swakarya' },
    ],
    jabatan: [],
  })),
}));

jest.mock('../sipanda.service', () => ({
  SIPANDA_TAHUN: '2026',
  fetchSipandaRows: jest.fn(async () => [
    { desa: 'SUKAMAJU', kecamatan: 'CIBINONG', sumber_dana: 'DD REGULER', anggaran: 100, sudah_cair: 'Y' },
    { desa: 'SUKAMAJU', kecamatan: 'JONGGOL', sumber_dana: 'DD REGULER', anggaran: 900, sudah_cair: 'N' },
  ]),
}));

const { jawab, analisis } = require('../gemaMesin.service');

describe('pencocokan kata kunci di batas kata', () => {
  test('"desa bertipologi persawahan" -> topik desa, bukan kelembagaan', async () => {
    expect((await analisis('desa bertipologi persawahan')).topik).toBe('desa');
  });

  test('"desa berklasifikasi swakarya" -> bukan aparatur', async () => {
    expect((await analisis('desa berklasifikasi swakarya')).topik).toBe('desa');
  });

  test('"data rt di desa Cijayanti" -> kelembagaan RT', async () => {
    const hasil = await jawab('data rt di desa Cijayanti');
    expect(hasil.maksud).toBe('daftar-kelembagaan');
    expect(hasil.kalimat).toMatch(/RT/);
  });
});

describe('desa di kecamatan', () => {
  test('"daftar desa di kecamatan Cibinong" -> daftar desa dengan jumlahnya', async () => {
    const hasil = await jawab('daftar desa di kecamatan Cibinong');
    expect(hasil.maksud).toBe('daftar-desa');
    expect(hasil.total).toBe(2);
    expect(hasil.kalimat).toMatch(/2 desa/);
    expect(hasil.baris[0].pemerintahan).toBe('desa');
  });

  test('"desa di kecamatan Cibinong" juga daftar; "kecamatan Cibinong" saja tetap rapor', async () => {
    expect((await jawab('desa di kecamatan Cibinong')).maksud).toBe('daftar-desa');
    const { cariJawaban } = require('../gemaMesin.service');
    const mentah = await analisis('kecamatan Cibinong');
    expect(mentah.topik).toBe('desa');
    expect(typeof cariJawaban).toBe('function');
  });
});

describe('nama desa kembar', () => {
  test('tanpa kecamatan -> tanya balik dengan pilihan kecamatan', async () => {
    const hasil = await jawab('profil desa Sukamaju');
    expect(hasil.maksud).toBe('desa-kembar');
    expect(hasil.kalimat).toMatch(/Sukamaju ada di Kecamatan Cibinong, Jonggol, dan Leuwiliang. Yang mana?/);
  });

  test('dengan kecamatan -> desa yang benar', async () => {
    const a = await analisis('desa Sukamaju di kecamatan Jonggol');
    expect(a.desaKembar).toBeNull();
    expect(a.desa.id).toBe(2);
  });
});

describe('keuangan', () => {
  test('tahun lain dari data SIPANDA dijawab jujur', async () => {
    const hasil = await jawab('penyaluran dana desa 2025');
    expect(hasil.maksud).toBe('keuangan-tahun-lain');
    expect(hasil.kalimat).toMatch(/hanya TA 2026/);
  });

  test('desa kembar dipasangkan dengan kecamatannya di baris SIPANDA', async () => {
    const hasil = await jawab('penyaluran dana desa Sukamaju kecamatan Jonggol');
    expect(hasil.maksud).toBe('keuangan-desa');
    expect(hasil.rincian.find((r) => r.label === 'Tahap tercatat').nilai).toMatch(/0 dari 1/);
  });
});
