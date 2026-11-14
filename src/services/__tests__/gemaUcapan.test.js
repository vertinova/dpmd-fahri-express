/** Ucapan Gema: angka, rupiah, persen, tanggal, singkatan, markdown. */

const { keUcapan, pecahKalimat } = require('../gemaUcapan.service');

describe('keUcapan', () => {
  test.each([
    ['0', 'nol'],
    ['11', 'sebelas'],
    ['100', 'seratus'],
    ['1000', 'seribu'],
    ['1.250.000', 'satu juta dua ratus lima puluh ribu'],
    ['2.500.000.000', 'dua miliar lima ratus juta'],
    ['Rp 1.250.000', 'satu juta dua ratus lima puluh ribu rupiah'],
    ['Rp1.250.000,50', 'satu juta dua ratus lima puluh ribu rupiah'],
    ['12,5%', 'dua belas koma lima persen'],
    ['14/11/2026', 'empat belas November dua ribu dua puluh enam'],
    ['2026-11-14', 'empat belas November dua ribu dua puluh enam'],
    ['tahun 2025', 'tahun dua ribu dua puluh lima'],
    ['DPMD dan BUMDes di RT 3', 'de pe em de dan bum des di er te tiga'],
    ['ADD dan DD, NIP', 'alokasi dana desa dan dana desa, en i pe'],
    ['**tebal** dan `kode`\n- poin', 'tebal dan kode poin'],
  ])('%s', (masuk, keluar) => {
    expect(keUcapan(masuk)).toBe(keluar);
  });
});

describe('pecahKalimat', () => {
  test('tidak memecah angka desimal atau singkatan', () => {
    expect(pecahKalimat('Ada 12,5 persen dari 3.5 total. Kata Dr. Budi? Oke!'))
      .toEqual(['Ada 12,5 persen dari 3.5 total.', 'Kata Dr. Budi?', 'Oke!']);
  });
});
