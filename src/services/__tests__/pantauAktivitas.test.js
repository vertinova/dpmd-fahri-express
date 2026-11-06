const { EventEmitter } = require('events');
const { catatAktivitas, pantauPermintaan, catatHalaman, halamanKini, ambilAktivitas, bersihkanPath } = require('../pantauAktivitas');

const user = (id) => ({ id, name: `User ${id}`, role: 'pegawai' });

const permintaan = (method, originalUrl, statusCode = 200) => {
  const res = new EventEmitter();
  res.statusCode = statusCode;
  pantauPermintaan({ method, originalUrl, user: user(1), ip: '10.0.0.1' }, res);
  res.emit('finish');
};

describe('pantauAktivitas', () => {
  test('path dibersihkan dari id, token, dan query', () => {
    expect(bersihkanPath('/desa/123/bumdes?token=rahasia#a')).toBe('/desa/:id/bumdes');
    expect(bersihkanPath('/reset/550e8400-e29b-41d4-a716-446655440000')).toBe('/reset/:id');
    expect(bersihkanPath('/tautan/aB3dE6gH9jK2mN5p')).toBe('/tautan/:id');
    expect(bersihkanPath('/core-dashboard/asta-desa')).toBe('/core-dashboard/asta-desa');
  });

  test('hanya permintaan pengubah data yang dicatat, tanpa isi permintaan', () => {
    const sebelum = ambilAktivitas({ batas: 1 })[0]?.id || 0;
    permintaan('GET', '/api/desa/1');
    permintaan('POST', '/api/settings/presence');
    permintaan('POST', '/api/messaging/kirim');
    permintaan('PUT', '/api/desa/bumdes/42?x=1', 422);

    const baru = ambilAktivitas({ setelah: sebelum });
    expect(baru).toHaveLength(1);
    expect(baru[0]).toMatchObject({ jenis: 'ubah', teks: 'Mengubah desa › bumdes', path: 'PUT /api/desa/bumdes/:id', status: 422, ip: '10.0.0.1' });
    expect(baru[0]).not.toHaveProperty('body');
  });

  test('denyut di halaman yang sama tidak menambah jejak', () => {
    const sebelum = ambilAktivitas({ batas: 1 })[0]?.id || 0;
    catatHalaman(user(2), '/dashboard');
    catatHalaman(user(2), '/dashboard');
    catatHalaman(user(2), '/surat/77');

    expect(ambilAktivitas({ setelah: sebelum }).map((a) => a.path)).toEqual(['/surat/:id', '/dashboard']);
    expect(halamanKini(2)).toBe('/surat/:id');
  });

  test('bisa disaring per pengguna dan jejak tidak tumbuh tanpa batas', () => {
    for (let i = 0; i < 1100; i++) catatAktivitas(user(3), { jenis: 'ubah', teks: 'x' });
    catatAktivitas(user(4), { jenis: 'login', teks: 'Masuk' });

    expect(ambilAktivitas({ batas: 5000 })).toHaveLength(1000);
    expect(ambilAktivitas({ userId: 4 })).toHaveLength(1);
  });
});
