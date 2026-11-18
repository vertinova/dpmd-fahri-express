/**
 * Akun pegawai DPMD wajib 2FA: token tanpa tanda `mfa` ditolak middleware auth.
 */

process.env.JWT_SECRET = 'rahasia-uji';

jest.mock('../../config/prisma', () => ({
  users: {
    findUnique: jest.fn(async () => null),
    update: jest.fn(() => Promise.resolve()),
  },
}));

const jwt = require('jsonwebtoken');
const { auth } = require('../auth');

const jalankan = async (payload) => {
  const token = jwt.sign({ id: 1, email: 'u1@uji', ...payload }, process.env.JWT_SECRET);
  const req = { header: (nama) => (nama === 'Authorization' ? `Bearer ${token}` : undefined) };
  const res = { statusCode: 200, body: null, setHeader() {} };
  res.status = (kode) => {
    res.statusCode = kode;
    return res;
  };
  res.json = (isi) => {
    res.body = isi;
    return res;
  };
  let lanjut = false;
  await auth(req, res, () => {
    lanjut = true;
  });
  return { lanjut, res };
};

describe('auth — wajib 2FA semua akun', () => {
  afterEach(() => {
    delete process.env.WAJIB_2FA;
  });

  it('pegawai tanpa mfa ditolak WAJIB_2FA', async () => {
    const { lanjut, res } = await jalankan({ role: 'pegawai' });
    expect(lanjut).toBe(false);
    expect(res.statusCode).toBe(401);
    expect(res.body.code).toBe('WAJIB_2FA');
  });

  it('pegawai dengan mfa diteruskan', async () => {
    expect((await jalankan({ role: 'pegawai', mfa: true })).lanjut).toBe(true);
  });

  it('superadmin tanpa mfa ditolak', async () => {
    expect((await jalankan({ role: 'superadmin' })).res.body?.code).toBe('WAJIB_2FA');
  });

  it.each(['desa', 'admin_desa', 'kecamatan', 'verifikator_dinas', 'dinas_terkait', 'bpjs'])('%s tanpa mfa ditolak', async (role) => {
    expect((await jalankan({ role })).res.body?.code).toBe('WAJIB_2FA');
  });

  it('desa dengan mfa diteruskan', async () => {
    expect((await jalankan({ role: 'desa', mfa: true })).lanjut).toBe(true);
  });

  it('WAJIB_2FA=pegawai: desa tanpa mfa diteruskan, pegawai tetap ditolak', async () => {
    process.env.WAJIB_2FA = 'pegawai';
    expect((await jalankan({ role: 'desa' })).lanjut).toBe(true);
    expect((await jalankan({ role: 'pegawai' })).res.body?.code).toBe('WAJIB_2FA');
  });

  it('WAJIB_2FA=off meloloskan pegawai tanpa mfa', async () => {
    process.env.WAJIB_2FA = 'off';
    expect((await jalankan({ role: 'pegawai' })).lanjut).toBe(true);
  });
});
