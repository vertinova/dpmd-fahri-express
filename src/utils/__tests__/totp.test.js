process.env.JWT_SECRET = process.env.JWT_SECRET || 'rahasia-uji';
const totp = require('../totp');

// Vektor uji RFC 6238 (SHA1, rahasia ASCII "12345678901234567890"), 6 digit terakhir.
const RAHASIA_RFC = totp.base32Encode(Buffer.from('12345678901234567890'));

describe('totp', () => {
  it.each([
    [59, '287082'],
    [1111111109, '081804'],
    [1234567890, '005924'],
    [2000000000, '279037'],
  ])('vektor RFC 6238 pada t=%i', (detik, kode) => {
    expect(totp.cocokkanKode(RAHASIA_RFC, kode, { sekarang: detik * 1000 })).toBe(Math.floor(detik / 30));
  });

  it('base32 bolak-balik', () => {
    const buf = Buffer.from('12345678901234567890');
    expect(RAHASIA_RFC).toBe('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
    expect(totp.base32Decode(RAHASIA_RFC).equals(buf)).toBe(true);
  });

  it('menerima ±30 detik, menolak di luar itu dan kode tak berbentuk', () => {
    const t = 1234567890 * 1000;
    expect(totp.cocokkanKode(RAHASIA_RFC, '005924', { sekarang: t + 30000 })).not.toBeNull();
    expect(totp.cocokkanKode(RAHASIA_RFC, '005924', { sekarang: t + 90000 })).toBeNull();
    expect(totp.cocokkanKode(RAHASIA_RFC, '12345', { sekarang: t })).toBeNull();
    expect(totp.cocokkanKode(RAHASIA_RFC, 'abcdef', { sekarang: t })).toBeNull();
  });

  it('enkripsi rahasia bolak-balik dan menolak data yang diubah', () => {
    const r = totp.buatRahasia();
    const simpan = totp.enkripsiRahasia(r);
    expect(simpan).not.toContain(r);
    expect(totp.dekripsiRahasia(simpan)).toBe(r);
    const [iv, tag, isi] = simpan.split('.');
    const rusak = [iv, tag, Buffer.from('x' + isi).toString('base64')].join('.');
    expect(() => totp.dekripsiRahasia(rusak)).toThrow();
  });

  it('tautan otpauth memuat rahasia dan penerbit', () => {
    const url = totp.tautanOtpauth('ABCD', 'a@b.id');
    expect(url).toMatch(/^otpauth:\/\/totp\/DPMD%20Kab%20Bogor:a%40b\.id\?secret=ABCD&issuer=DPMD%20Kab%20Bogor/);
  });
});
