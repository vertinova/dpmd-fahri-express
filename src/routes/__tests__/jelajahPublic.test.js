const fs = require('fs');
const os = require('os');
const path = require('path');
const express = require('express');
const request = require('supertest');

const dirData = fs.mkdtempSync(path.join(os.tmpdir(), 'jelajah-'));
process.env.JELAJAH_DATA_DIR = dirData;

const mockQuery = jest.fn();
jest.mock('../../config/database', () => ({ query: (...a) => mockQuery(...a) }));

const app = express();
app.use(express.json({ limit: '10mb' }));
app.use('/j', require('../jelajahPublic.routes'));

afterAll(() => fs.rmSync(dirData, { recursive: true, force: true }));

describe('kode simpan', () => {
  const data = { 'jelajah:kebun:v3': '{"a":1}', 'jelajah-progres-v1': '{"xp":5}' };

  test('buat, baca, perbarui', async () => {
    const buat = await request(app).post('/j/simpanan').send({ data });
    expect(buat.status).toBe(200);
    expect(buat.body.kode).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);

    const baca = await request(app).get(`/j/simpanan/${buat.body.kode.toLowerCase().replace(/-/g, '')}`);
    expect(baca.body.data).toEqual(data);

    const baru = { 'jelajah:kebun:v3': '{"a":2}' };
    expect((await request(app).put(`/j/simpanan/${buat.body.kode}`).send({ data: baru })).status).toBe(200);
    expect((await request(app).get(`/j/simpanan/${buat.body.kode}`)).body.data).toEqual(baru);
  });

  test('berkas tidak memuat kode di namanya', async () => {
    const { body } = await request(app).post('/j/simpanan').send({ data });
    const berkas = fs.readdirSync(path.join(dirData, 'simpanan'));
    expect(berkas.some((f) => f.includes(body.kode))).toBe(false);
    expect(berkas.every((f) => /^[0-9a-f]{64}\.json$/.test(f))).toBe(true);
  });

  test.each([
    ['kunci di luar jelajah', { token: 'x' }],
    ['nilai bukan teks', { 'jelajah:a': 1 }],
    ['kosong', {}],
    ['bukan objek', ['a']],
    ['kunci berisi jalur', { 'jelajah:../../x': 'a' }],
  ])('menolak %s', async (_n, isi) => {
    expect((await request(app).post('/j/simpanan').send({ data: isi })).status).toBe(400);
  });

  test('menolak simpanan terlalu besar', async () => {
    const res = await request(app).post('/j/simpanan').send({ data: { 'jelajah:a': 'x'.repeat(300 * 1024) } });
    expect(res.status).toBe(413);
  });

  test('kode tak dikenal dan kode rusak', async () => {
    expect((await request(app).get('/j/simpanan/AAAA-AAAA-AAAA')).status).toBe(404);
    expect((await request(app).get('/j/simpanan/..%2F..%2Fetc')).status).toBe(404);
    expect((await request(app).put('/j/simpanan/AAAA-AAAA-AAAA').send({ data })).status).toBe(404);
  });
});

describe('penghitung', () => {
  test('hanya menerima peristiwa yang dikenal', async () => {
    expect((await request(app).post('/j/tanda').send({ peristiwa: 'mulai-3d' })).status).toBe(200);
    expect((await request(app).post('/j/tanda').send({ peristiwa: 'apa-saja' })).status).toBe(400);
    const { body } = await request(app).get('/j/statistik');
    expect(Object.values(body.data)[0]['mulai-3d']).toBe(1);
  });
});

describe('data kecamatan', () => {
  test('menggabungkan bumdes walau penulisan kecamatan berbeda', async () => {
    mockQuery
      .mockResolvedValueOnce([[{ nama: 'Cibinong', desa: '5', kelurahan: '7' }, { nama: 'Tenjo', desa: '9', kelurahan: '0' }]])
      .mockResolvedValueOnce([[{ kecamatan: 'CIBINONG', bumdes_aktif: 2, produk: 3 }, { kecamatan: 'cibinong ', bumdes_aktif: 1, produk: 0 }]]);
    const { body } = await request(app).get('/j/wilayah');
    expect(body.data).toEqual([
      { nama: 'Cibinong', desa: 5, kelurahan: 7, bumdes_aktif: 3, produk: 3 },
      { nama: 'Tenjo', desa: 9, kelurahan: 0, bumdes_aktif: 0, produk: 0 },
    ]);
  });

  test('galat basis data tidak membocorkan pesan', async () => {
    mockQuery.mockRejectedValueOnce(new Error('rahasia'));
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const res = await request(app).get('/j/wilayah');
    spy.mockRestore();
    expect(res.status).toBe(500);
    expect(JSON.stringify(res.body)).not.toContain('rahasia');
  });
});
