/**
 * Hapus akun diganti menonaktifkan (FK log aktivitas ke users memakai
 * ON DELETE CASCADE). Akun nonaktif harus langsung diputus walau tokennya
 * masih berlaku.
 */

process.env.JWT_SECRET = 'rahasia-uji';

const AKUN = {
  1: { role: 'desa', is_active: true },
  2: { role: 'desa', is_active: false },
  3: { role: 'kecamatan', is_active: false },
};

jest.mock('../../config/prisma', () => ({
  users: {
    findUnique: jest.fn(async ({ where }) => AKUN[String(where.id)] || null),
    update: jest.fn(() => Promise.resolve()),
  },
}));

const jwt = require('jsonwebtoken');
const { auth } = require('../auth');

const jalankan = async (id) => {
  const token = jwt.sign({ id, email: `u${id}@uji`, role: AKUN[id].role }, process.env.JWT_SECRET);
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

describe('auth — akun desa nonaktif', () => {
  it('akun desa aktif diteruskan', async () => {
    expect((await jalankan(1)).lanjut).toBe(true);
  });

  it('akun desa nonaktif diputus dengan AKUN_NONAKTIF', async () => {
    const { lanjut, res } = await jalankan(2);
    expect(lanjut).toBe(false);
    expect(res.statusCode).toBe(401);
    expect(res.body.code).toBe('AKUN_NONAKTIF');
  });

  it('role lain yang nonaktif juga diputus, dengan pesan umum', async () => {
    const { lanjut, res } = await jalankan(3);
    expect(lanjut).toBe(false);
    expect(res.body.code).toBe('AKUN_NONAKTIF');
    expect(res.body.message).not.toMatch(/Admin Desa/);
  });
});
