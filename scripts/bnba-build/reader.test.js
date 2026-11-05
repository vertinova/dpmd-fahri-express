/* node --test scripts/bnba-build/reader.test.js */
const test = require('node:test');
const assert = require('node:assert');
const { detectWilayah } = require('./reader.js');

test('label "DESA" polos dengan nilai ": X" terbaca', () => {
  const rows = [
    ['NOMINATIF LEMBAGA KEMASYARAKATAN DESA'], [], [],
    [null, 'DESA', ': HAMBARO'],
    [null, 'KECAMATAN ', ': NANGGUNG'],
  ];
  assert.deepStrictEqual(detectWilayah(rows), { desa: 'HAMBARO', kecamatan: 'NANGGUNG' });
});

test('header kolom ALAMAT RUMAH tidak dianggap nama wilayah', () => {
  const rows = [['NOMINATIF LEMBAGA KEMASYARAKATAN DESA'], [], [], [], [],
    ['NO', 'NAMA', 'JALAN/GANG DAN NOMOR RUMAH', 'RT', 'RW', 'DESA', 'KECAMATAN', 'KODE POS']];
  assert.deepStrictEqual(detectWilayah(rows), { desa: '', kecamatan: '' });
});

test('format "Desa/Kelurahan" lama tetap terbaca', () => {
  const rows = [[], [null, 'Desa/Kelurahan', 'CURUG'], [null, 'Kecamatan', 'JASINGA']];
  assert.deepStrictEqual(detectWilayah(rows), { desa: 'CURUG', kecamatan: 'JASINGA' });
});
