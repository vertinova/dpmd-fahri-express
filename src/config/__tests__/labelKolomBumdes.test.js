/**
 * Judul kolom ekspor BUM Desa: setiap kolom tabel `bumdes` punya label sendiri
 * (bukan nama database), tidak ada dua kolom berjudul sama, dan isian usaha
 * memakai label yang sama persis dengan formulir pengisian.
 */
const fs = require('fs');
const path = require('path');
const { LABEL_KOLOM, labelKolom, labelIsian } = require('../labelKolomBumdes');

const kolomBumdes = () => {
  const skema = fs.readFileSync(path.join(__dirname, '../../../prisma/schema.prisma'), 'utf8');
  const blok = skema.split(/^model bumdes \{$/m)[1].split(/^\}$/m)[0];
  return blok
    .split('\n')
    .map((b) => b.trim())
    .filter((b) => b && !b.startsWith('//') && !b.startsWith('@@') && !/@relation|\[\]/.test(b))
    .map((b) => b.split(/\s+/)[0]);
};

describe('label kolom ekspor BUM Desa', () => {
  it('setiap kolom tabel bumdes punya label eksplisit', () => {
    const tanpaLabel = kolomBumdes().filter((k) => !LABEL_KOLOM[k]);
    expect(tanpaLabel).toEqual([]);
  });

  it('tidak ada dua kolom berjudul sama', () => {
    const judul = kolomBumdes().map(labelKolom);
    const ganda = judul.filter((j, i) => judul.indexOf(j) !== i);
    expect(ganda).toEqual([]);
  });

  it('isian usaha sama dengan label formulir', () => {
    expect(labelKolom('KategoriUsaha')).toBe('Kategori Usaha Utama');
    expect(labelKolom('JenisUsahaUtama')).toBe('Keterangan Jenis Usaha Utama');
    expect(labelKolom('KategoriUsahaPangan')).toBe('Kategori Usaha Ketahanan Pangan');
    expect(labelKolom('KeteranganUsahaKetahananPangan')).toBe('Keterangan Jenis Usaha Ketahanan Pangan');
    expect(labelKolom('NamaDirektur')).toBe('Nama Direktur');
  });

  it('kolom baru yang belum dipetakan tetap terbaca, isian daftar berlabel', () => {
    expect(labelKolom('KolomBaruUji2027')).toBe('Kolom Baru Uji 2027');
    expect(labelIsian('RiwayatOmsetLaba', 'laba')).toBe('Laba / Rugi (Rp)');
  });
});
