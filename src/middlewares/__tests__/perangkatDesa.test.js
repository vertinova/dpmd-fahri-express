/**
 * Akun perangkat desa: gerbang jalur di middleware auth dan cakupan checkAbsensiAdmin per kelompok.
 */

process.env.JWT_SECRET = 'rahasia-uji';

jest.mock('../../config/prisma', () => ({
  users: {
    findUnique: jest.fn(async () => null),
    update: jest.fn(() => Promise.resolve()),
  },
  bidangs: {
    findUnique: jest.fn(async ({ where }) => (Number(where.id) === 1 ? { nama: 'Sekretariat' } : { nama: 'Pemerintahan Desa' })),
  },
}));

const jwt = require('jsonwebtoken');
const { auth, checkAbsensiAdmin } = require('../auth');

const buatRes = () => {
  const res = { statusCode: 200, body: null, setHeader() {} };
  res.status = (kode) => {
    res.statusCode = kode;
    return res;
  };
  res.json = (isi) => {
    res.body = isi;
    return res;
  };
  return res;
};

const jalankan = async (payload, url) => {
  // mfa: true seperti sesi sungguhan sejak 2FA wajib semua akun.
  const token = jwt.sign({ id: 1, email: 'u1@uji', mfa: true, ...payload }, process.env.JWT_SECRET);
  const req = { originalUrl: url, header: (nama) => (nama === 'Authorization' ? `Bearer ${token}` : undefined) };
  const res = buatRes();
  let lanjut = false;
  await auth(req, res, () => {
    lanjut = true;
  });
  return { lanjut, res };
};

describe('auth — gerbang akun perangkat desa', () => {
  it('menolak rute di luar presensi dengan DI_LUAR_WEWENANG', async () => {
    const { lanjut, res } = await jalankan({ role: 'perangkat_desa', desa_id: 5 }, '/api/aparatur-desa');
    expect(lanjut).toBe(false);
    expect(res.statusCode).toBe(403);
    expect(res.body.code).toBe('DI_LUAR_WEWENANG');
  });

  it('meloloskan /api/absensi-perangkat/today (juga dengan query)', async () => {
    expect((await jalankan({ role: 'perangkat_desa' }, '/api/absensi-perangkat/today?x=1')).lanjut).toBe(true);
  });

  it('meloloskan /api/auth/ dan /api/push-notification/', async () => {
    expect((await jalankan({ role: 'perangkat_desa' }, '/api/auth/force-change-password')).lanjut).toBe(true);
    expect((await jalankan({ role: 'perangkat_desa' }, '/api/push-notification/subscribe')).lanjut).toBe(true);
  });

  it('menolak /api/authx dan /api/absensi (kelompok pegawai)', async () => {
    expect((await jalankan({ role: 'perangkat_desa' }, '/api/authx/login')).res.statusCode).toBe(403);
    expect((await jalankan({ role: 'perangkat_desa' }, '/api/absensi/today')).res.statusCode).toBe(403);
  });

  it('role lain tidak terpengaruh', async () => {
    expect((await jalankan({ role: 'desa' }, '/api/aparatur-desa')).lanjut).toBe(true);
    expect((await jalankan({ role: 'pegawai', mfa: true }, '/api/absensi/today')).lanjut).toBe(true);
  });
});

describe('checkAbsensiAdmin per kelompok', () => {
  const panggil = async (kelompokAbsensi, user) => {
    const req = { kelompokAbsensi, user: { email: 'x@uji', ...user } };
    const res = buatRes();
    let lanjut = false;
    await checkAbsensiAdmin(req, res, () => {
      lanjut = true;
    });
    return { lanjut, res };
  };

  it('perangkat_desa: bidang 6, superadmin, sekretaris_dinas lolos', async () => {
    expect((await panggil('perangkat_desa', { role: 'pegawai', bidang_id: 6 })).lanjut).toBe(true);
    expect((await panggil('perangkat_desa', { role: 'superadmin' })).lanjut).toBe(true);
    expect((await panggil('perangkat_desa', { role: 'sekretaris_dinas' })).lanjut).toBe(true);
  });

  it('perangkat_desa: Sekretariat (bidang 1) ditolak 403', async () => {
    const { lanjut, res } = await panggil('perangkat_desa', { role: 'pegawai', bidang_id: 1 });
    expect(lanjut).toBe(false);
    expect(res.statusCode).toBe(403);
  });

  it('pegawai: bidang 6 ditolak, Sekretariat lolos (perilaku lama)', async () => {
    expect((await panggil('pegawai', { role: 'pegawai', bidang_id: 6 })).res.statusCode).toBe(403);
    expect((await panggil('pegawai', { role: 'pegawai', bidang_id: 1 })).lanjut).toBe(true);
    expect((await panggil(undefined, { role: 'pegawai', bidang_id: 1 })).lanjut).toBe(true);
  });
});
