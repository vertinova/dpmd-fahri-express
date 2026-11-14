/** Akun pegawai di Gema: data sensitif hanya untuk peran yang berwenang. */

jest.mock('../../config/prisma', () => ({
  users: {
    findMany: jest.fn(async () => [{
      id: 7,
      name: 'Budi Santoso',
      email: 'budi@dpmd.test',
      role: 'pegawai',
      is_active: true,
      no_hp: '081234567890',
      password: 'bukan-hash',
      bidang_id: null,
      pegawai: {
        nip: '198001012005011001',
        jabatan: 'Staf Pelaksana',
        tanggal_lahir: new Date('1980-01-01'),
        bidangs: { id: 1, nama: 'SPKED' },
      },
    }]),
  },
  bidangs: { findUnique: jest.fn() },
}));

const { cariAkun, ambilKataCari } = require('../gemaAkunPegawai.service');

describe('detail akun pegawai', () => {
  test('peran pegawai hanya melihat nama, jabatan, bidang, status aktif', async () => {
    const hasil = await cariAkun('budi', { id: 1, role: 'pegawai' });
    const json = JSON.stringify(hasil);
    expect(json).toMatch(/Budi Santoso/);
    expect(json).toMatch(/SPKED/);
    expect(json).not.toMatch(/198001012005011001/);
    expect(json).not.toMatch(/081234567890/);
    expect(json).not.toMatch(/1980/);
    expect(json).not.toMatch(/budi@dpmd\.test/);
    expect(json).not.toMatch(/default/i);
    expect(json).not.toMatch(/plain_password/);
  });

  test('tanpa pelaku diperlakukan sebagai peran biasa', async () => {
    expect(JSON.stringify(await cariAkun('budi'))).not.toMatch(/198001012005011001/);
  });

  test('superadmin melihat NIP, HP, tanggal lahir, dan status sandi', async () => {
    const json = JSON.stringify(await cariAkun('budi', { id: 1, role: 'superadmin' }));
    expect(json).toMatch(/198001012005011001/);
    expect(json).toMatch(/081234567890/);
    expect(json).toMatch(/Tanggal lahir/);
    expect(json).toMatch(/Sandi/);
    expect(json).not.toMatch(/plain_password/);
  });
});

describe('ambilKataCari', () => {
  test('hanya membuang kata utuh', () => {
    expect(ambilKataCari('akun staf Mustafa')).toBe('mustafa');
    expect(ambilKataCari('reset password akun pegawai Budi Santoso')).toBe('budi santoso');
  });
});
