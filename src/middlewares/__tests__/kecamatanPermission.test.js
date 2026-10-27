/**
 * Pagar fitur untuk operator kecamatan.
 *
 * Penjaga ini dipasang di titik mount, sebelum `auth`, dan rute kecamatan di
 * belakangnya kebanyakan tidak memeriksa role sama sekali. Jadi dua kesalahan
 * yang paling mahal: operator lolos ke fitur yang tidak diberikan, atau penjaga
 * ini ikut menolak akun lain (akun utama, desa, DPMD) yang bukan urusannya.
 */

process.env.JWT_SECRET = 'rahasia-uji';

const AKUN = {
  1: { operator_kecamatan: false, is_active: true, kecamatan_user_permissions: [] },
  2: { operator_kecamatan: true, is_active: true, kecamatan_user_permissions: [{ permission_key: 'bankeu' }] },
  3: { operator_kecamatan: true, is_active: false, kecamatan_user_permissions: [{ permission_key: 'bankeu' }] },
};

jest.mock('../../config/prisma', () => ({
  users: { findUnique: jest.fn(async ({ where }) => AKUN[String(where.id)] || null) },
}));

const jwt = require('jsonwebtoken');
const prisma = require('../../config/prisma');
const { gerbangOperatorKecamatan, requireKecamatanUtama } = require('../kecamatanPermission');

const permintaan = (payload) => ({
  header: (nama) =>
    nama === 'Authorization' && payload ? `Bearer ${jwt.sign(payload, process.env.JWT_SECRET)}` : undefined,
});

const jalankan = async (mw, req) => {
  const res = { statusCode: 200, body: null };
  res.status = (kode) => {
    res.statusCode = kode;
    return res;
  };
  res.json = (isi) => {
    res.body = isi;
    return res;
  };
  let lanjut = false;
  await mw(req, res, () => {
    lanjut = true;
  });
  return { lanjut, res };
};

describe('gerbangOperatorKecamatan', () => {
  beforeEach(() => prisma.users.findUnique.mockClear());

  it('akun utama kecamatan lolos ke semua fitur', async () => {
    const { lanjut } = await jalankan(gerbangOperatorKecamatan('kelembagaan'), permintaan({ id: 1, role: 'kecamatan' }));
    expect(lanjut).toBe(true);
  });

  it('operator lolos ke fitur yang diberikan', async () => {
    const { lanjut } = await jalankan(gerbangOperatorKecamatan('bankeu'), permintaan({ id: 2, role: 'kecamatan' }));
    expect(lanjut).toBe(true);
  });

  it('operator ditolak di fitur yang tidak diberikan', async () => {
    const { lanjut, res } = await jalankan(gerbangOperatorKecamatan('kelembagaan'), permintaan({ id: 2, role: 'kecamatan' }));
    expect(lanjut).toBe(false);
    expect(res.statusCode).toBe(403);
    expect(res.body.code).toBe('KECAMATAN_PERMISSION_DENIED');
  });

  it('operator nonaktif ditolak walau fiturnya diberikan', async () => {
    const { lanjut, res } = await jalankan(gerbangOperatorKecamatan('bankeu'), permintaan({ id: 3, role: 'kecamatan' }));
    expect(lanjut).toBe(false);
    expect(res.body.code).toBe('OPERATOR_KECAMATAN_NONAKTIF');
  });

  it('role lain diteruskan tanpa menyentuh database', async () => {
    for (const role of ['desa', 'pegawai', 'superadmin', 'dinas_terkait']) {
      const { lanjut } = await jalankan(gerbangOperatorKecamatan('bankeu'), permintaan({ id: 99, role }));
      expect(lanjut).toBe(true);
    }
    expect(prisma.users.findUnique).not.toHaveBeenCalled();
  });

  it('tanpa token atau token palsu diteruskan — penolakannya tugas auth', async () => {
    expect((await jalankan(gerbangOperatorKecamatan('bankeu'), permintaan(null))).lanjut).toBe(true);
    const palsu = { header: () => `Bearer ${jwt.sign({ id: 2, role: 'kecamatan' }, 'kunci-lain')}` };
    expect((await jalankan(gerbangOperatorKecamatan('kelembagaan'), palsu)).lanjut).toBe(true);
  });
});

describe('requireKecamatanUtama', () => {
  it('meloloskan akun utama dan menolak operator', async () => {
    expect((await jalankan(requireKecamatanUtama, { user: { id: 1 } })).lanjut).toBe(true);
    const { lanjut, res } = await jalankan(requireKecamatanUtama, { user: { id: 2 } });
    expect(lanjut).toBe(false);
    expect(res.body.code).toBe('BUKAN_AKUN_UTAMA_KECAMATAN');
  });
});
