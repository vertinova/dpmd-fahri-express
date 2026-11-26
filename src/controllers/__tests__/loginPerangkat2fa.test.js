/**
 * Login NIPD perangkat desa ikut aturan 2FA wajib: sandi benar baru menghasilkan
 * tiket 2FA (403 PERLU_PASANG_2FA / PERLU_KODE_2FA), bukan token sesi.
 */

process.env.JWT_SECRET = 'rahasia-uji';

const mockPrisma = {
  aparatur_desa: { findFirst: jest.fn() },
  users: { findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
  user_totp: { findUnique: jest.fn() },
};
jest.mock('../../config/prisma', () => mockPrisma);
jest.mock('../../services/serverSecurity.service', () => ({ onLoginFailed: jest.fn(), onLoginSuccess: jest.fn() }));
jest.mock('../../services/pantauAktivitas', () => ({ catatAktivitas: jest.fn() }));

const { login } = require('../auth.controller');
const { SANDI_DEFAULT_PERANGKAT } = require('../../config/sandiDefault');

const NIPD = '12345678901234567890';
const APARATUR = { id: 'apa-1', desa_id: 5n, nama_lengkap: 'Budi', jabatan: 'Kaur Umum' };
const AKUN = { id: 77n, name: 'Budi', email: 'perangkat-apa-1@presensi.dpmd.local', role: 'perangkat_desa', desa_id: 5n, jabatan_desa: 'Kaur Umum', is_active: true };

const panggil = async (password) => {
  const res = { statusCode: 200, body: null, locals: {} };
  res.status = (k) => ((res.statusCode = k), res);
  res.json = (b) => ((res.body = b), res);
  await login({ body: { email: NIPD, password }, ip: '127.0.0.1', headers: {} }, res);
  return res;
};

beforeEach(() => {
  jest.clearAllMocks();
  delete process.env.WAJIB_2FA;
  mockPrisma.aparatur_desa.findFirst.mockResolvedValue(APARATUR);
});

describe('login NIPD perangkat desa + 2FA wajib', () => {
  it('login pertama: akun dibuat lalu diminta memasang 2FA, tanpa token sesi', async () => {
    mockPrisma.users.findUnique.mockResolvedValue(null);
    mockPrisma.users.create.mockResolvedValue({ ...AKUN, password: 'hash' });
    mockPrisma.user_totp.findUnique.mockResolvedValue(null);

    const res = await panggil(SANDI_DEFAULT_PERANGKAT);
    expect(mockPrisma.users.create).toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
    expect(res.body.code).toBe('PERLU_PASANG_2FA');
    expect(res.body.data.tiket_2fa).toEqual(expect.any(String));
    expect(res.body.data.token).toBeUndefined();
    expect(res.locals.langkah2fa).toBe(true);
  });

  it('2FA sudah terpasang: diminta kode 6 digit', async () => {
    const bcrypt = require('bcryptjs');
    mockPrisma.users.findUnique.mockResolvedValue({ ...AKUN, password: await bcrypt.hash('sandiBaru1', 4) });
    mockPrisma.user_totp.findUnique.mockResolvedValue({ aktif_at: new Date() });

    const res = await panggil('sandiBaru1');
    expect(res.statusCode).toBe(403);
    expect(res.body.code).toBe('PERLU_KODE_2FA');
  });

  it('sandi salah tetap 401 tanpa tiket', async () => {
    mockPrisma.users.findUnique.mockResolvedValue(null);
    const res = await panggil('salah');
    expect(res.statusCode).toBe(401);
    expect(res.body.data).toBeUndefined();
  });
});
