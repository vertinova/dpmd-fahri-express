/* node --test scripts/bnba-build/reader.test.js */
const test = require('node:test');
const assert = require('node:assert');
const xlsx = require('xlsx');
const { detectWilayah, resolveHeader, sheetRows } = require('./reader.js');

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

test('sheet yang !ref-nya tidak mulai di A1 tetap menyusun header bertingkat', () => {
  // Merge disimpan dengan nomor baris absolut; kalau sheetRows memangkas baris
  // kosong di atas, induk "JABATAN" tidak sampai ke anak "RW"/"RT" dan kolom
  // penanda wilayah hilang tanpa pesan.
  const ws = xlsx.utils.aoa_to_sheet([
    [], [], [], [], [], [],
    ['No.', 'NAMA LENGKAP', 'NO KTP', 'JABATAN', null, null, 'ALAMAT', null, null],
    [null, null, null, 'JABATAN', 'RW', 'RT', 'JALAN/GANG DAN NOMOR RUMAH', 'RT', 'RW'],
    ['1', 'SITI', '3201214904790003', 'KETUA RW 001', '01', null, 'KP PARENGPENG', '01', '01'],
  ]);
  ws['!ref'] = 'A7:I9';
  ws['!merges'] = [
    xlsx.utils.decode_range('D7:F7'),
    xlsx.utils.decode_range('G7:I7'),
  ];
  const { fields } = resolveHeader(ws, sheetRows(ws));
  assert.strictEqual(fields.nik, 2, 'kolom NO KTP harus terbaca sebagai nik');
  assert.strictEqual(fields._wilayah_rw, 4);
  assert.strictEqual(fields._wilayah_rt, 5);
  assert.strictEqual(fields.rt_rumah, 7);
  assert.strictEqual(fields.rw_rumah, 8);
});
