const { bacaSts, bentukSts } = require('../bankeuSts');

const HARI = '2026-11-11';
const sts = (o = {}) => bacaSts({ tahun_anggaran: '2026', nominal: '1000', tanggal_setor: '2026-11-01', ...o }, HARI);

describe('bacaSts', () => {
  test('tahun valid dan tidak valid', () => {
    expect(sts().data.tahun_anggaran).toBe(2026);
    expect(sts({ tahun_anggaran: '2024' }).galat).toBeTruthy();
    expect(sts({ tahun_anggaran: 'abc' }).galat).toBeTruthy();
  });

  test('nominal dengan titik ribuan menjadi BigInt', () => {
    expect(sts({ nominal: '1.500.000' }).data.nominal).toBe(1500000n);
  });

  test.each(['0', '', '-5', '12a', '12345678901234'])('nominal %p ditolak', (n) => {
    expect(sts({ nominal: n }).galat).toBeTruthy();
  });

  test('tanggal tidak valid ditolak', () => {
    expect(sts({ tanggal_setor: '2026-02-31' }).galat).toBeTruthy();
    expect(sts({ tanggal_setor: '11/11/2026' }).galat).toBeTruthy();
  });

  test('tanggal masa depan ditolak, hari ini boleh', () => {
    expect(sts({ tanggal_setor: '2026-11-12' }).galat).toMatch(/masa depan/);
    expect(sts({ tanggal_setor: '2026-11-11' }).data).toBeTruthy();
  });
});


describe('bentuk respons', () => {
  test('bentukSts: nominal number dan tanggal YYYY-MM-DD', () => {
    const r = bentukSts({
      id: 1n, tahun_anggaran: 2026, nominal: 2500000n, tanggal_setor: new Date('2026-11-05T00:00:00Z'),
      nama_file: 'a.pdf', file_path: '1/2/sts_x.pdf', file_size: 10, created_at: new Date(),
    });
    expect(r.nominal).toBe(2500000);
    expect(r.tanggal_setor).toBe('2026-11-05');
  });
});
