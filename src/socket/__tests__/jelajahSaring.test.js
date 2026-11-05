const { sensor, kasar, namaTerlarang, kunciNama, ipKlien } = require('../jelajahSaring');

describe('sensor chat', () => {
  test.each(['anjing', 'ANJIIING', '4nj1ng', 'a.n.j.i.n.g', 'kontolnya', 'goblog', 'asu', 'b4b1', 'kehed'])('menyaring %s', (k) => {
    expect(sensor(`dasar ${k} sia`)).not.toContain(k);
    expect(sensor(`dasar ${k} sia`)).toContain('*');
  });

  test('menyaring huruf yang dieja terpisah', () => {
    expect(sensor('dasar k o n t o l ya')).toBe('dasar * * * * * * ya');
  });

  test.each(['babinsa', 'perekam', 'perekonomian', 'asumsi', 'masukan', 'kontrol', 'bangsa', 'pelerai', 'MK', 'sawah a b c'])('tidak menyaring %s', (k) => {
    expect(sensor(k)).toBe(k);
  });
});

describe('nama terlarang', () => {
  const pegawai = new Set([kunciNama('Dr. H. Ahmad Fauzi, S.Sos., M.Si')]);

  test.each(['Bupati Bogor', 'pak camat', 'B u p a t i', 'Kepala Desa', 'Admin', 'bupati2', 'si anjing', 'DPMD'])('menolak %s', (n) => {
    expect(namaTerlarang(n, pegawai)).toBe(true);
  });

  test('menolak nama lengkap pegawai, dengan atau tanpa gelar', () => {
    expect(namaTerlarang('ahmad fauzi', pegawai)).toBe(true);
    expect(namaTerlarang('H. Ahmad Fauzi', pegawai)).toBe(true);
  });

  test.each(['Ahmad', 'Ahmad Mintarja', 'Fahri', 'Tamu', 'Kang Ujang'])('menerima %s', (n) => {
    expect(namaTerlarang(n, pegawai)).toBe(false);
  });
});

describe('ip klien', () => {
  test('mengabaikan nilai karangan klien di paling kiri', () => {
    expect(ipKlien('1.1.1.1, 36.1.2.3, 172.168.20.23', '127.0.0.1')).toBe('36.1.2.3');
  });

  test('tanpa rantai proxy lengkap', () => {
    expect(ipKlien('36.1.2.3', '127.0.0.1')).toBe('36.1.2.3');
    expect(ipKlien(undefined, '127.0.0.1')).toBe('127.0.0.1');
    expect(ipKlien('', undefined)).toBe('tak-dikenal');
  });
});

test('kasar menerima kata kosong', () => {
  expect(kasar('...')).toBe(false);
});
