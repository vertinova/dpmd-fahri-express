const { normalisasiDaftarVideo, videoLengkap } = require('../lpjVideo');

const tiga = ['https://a.com/1', 'https://a.com/2', 'http://b.com/3'];

describe('normalisasiDaftarVideo', () => {
  test('menerima 3 link sah', () => {
    expect(normalisasiDaftarVideo(tiga)).toEqual({ ok: true, daftar: tiga });
  });
  test('trim dan buang item kosong', () => {
    const r = normalisasiDaftarVideo(['  https://a.com/1 ', '', '   ', 'https://a.com/2', 'https://a.com/3']);
    expect(r.ok).toBe(true);
    expect(r.daftar).toEqual(['https://a.com/1', 'https://a.com/2', 'https://a.com/3']);
  });
  test('duplikat dibuang lalu kurang dari 3 gagal', () => {
    const r = normalisasiDaftarVideo(['https://a.com/1', 'https://a.com/1 ', 'https://a.com/2']);
    expect(r.ok).toBe(false);
    expect(r.pesan).toMatch(/minimal 3/);
  });
  test.each(['javascript:alert(1)', 'ftp://a.com/x', 'bukan url'])('menolak %s', (u) => {
    expect(normalisasiDaftarVideo(['https://a.com/1', 'https://a.com/2', u]).ok).toBe(false);
  });
  test('menolak 11 link', () => {
    const r = normalisasiDaftarVideo(Array.from({ length: 11 }, (_, i) => `https://a.com/${i}`));
    expect(r.ok).toBe(false);
    expect(r.pesan).toMatch(/maksimal 10/);
  });
  test('menolak bukan array', () => {
    expect(normalisasiDaftarVideo('https://a.com').ok).toBe(false);
    expect(normalisasiDaftarVideo(null).ok).toBe(false);
  });
});

describe('videoLengkap', () => {
  test('null tidak lengkap', () => expect(videoLengkap(null)).toBe(false));
  test('string JSON lengkap', () => {
    const s = JSON.stringify(tiga);
    expect(videoLengkap({ dayeuh_pajajaran: s, infrastruktur: s })).toBe(true);
  });
  test('2 link tidak lengkap', () => {
    expect(videoLengkap({ dayeuh_pajajaran: tiga, infrastruktur: tiga.slice(0, 2) })).toBe(false);
  });
});
