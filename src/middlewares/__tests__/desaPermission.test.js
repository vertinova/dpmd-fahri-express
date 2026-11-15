/**
 * Pagar izin akun desa, terutama `bacaJuga`: modul lain boleh membaca, tidak boleh menulis.
 * Kesalahan yang paling mahal: pemegang izin Kelembagaan bisa mengubah Produk Hukum,
 * atau akun tanpa izin apa pun ikut lolos membaca.
 */

jest.mock('../../config/prisma', () => ({
  desa_user_permissions: {
    findMany: jest.fn(async ({ where }) => {
      const izin = { 1: ['produk-hukum'], 2: ['kelembagaan'], 3: ['bankeu'] };
      return (izin[String(where.user_id)] || []).map((permission_key) => ({ permission_key }));
    }),
  },
}));

const { requireDesaPermission } = require('../desaPermission');

const jalankan = async (method, userId, options, role = 'desa') => {
  const res = { status: jest.fn(() => res), json: jest.fn(() => res) };
  const next = jest.fn();
  await requireDesaPermission('produk-hukum', options)({ method, user: { id: userId, role, email: 'uji@uji.test' } }, res, next);
  return next.mock.calls.length ? 'lolos' : res.status.mock.calls[0][0];
};
const BACA = { bacaJuga: ['kelembagaan', 'aparatur-desa'] };

describe('requireDesaPermission', () => {
  test('pemilik izin bebas membaca dan menulis', async () => {
    expect(await jalankan('GET', 1, BACA)).toBe('lolos');
    expect(await jalankan('POST', 1, BACA)).toBe('lolos');
  });

  test('izin modul lain hanya boleh membaca', async () => {
    expect(await jalankan('GET', 2, BACA)).toBe('lolos');
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      expect(await jalankan(method, 2, BACA)).toBe(403);
    }
  });

  test('izin yang tidak terdaftar tetap ditolak', async () => {
    expect(await jalankan('GET', 3, BACA)).toBe(403);
  });

  test('tanpa opsi bacaJuga perilaku lama tidak berubah', async () => {
    expect(await jalankan('GET', 2, undefined)).toBe(403);
  });

  test('admin desa tetap ditolak, role lain tetap diteruskan', async () => {
    expect(await jalankan('GET', 2, BACA, 'admin_desa')).toBe(403);
    expect(await jalankan('POST', 9, BACA, 'superadmin')).toBe('lolos');
  });
});
