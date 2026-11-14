/** Endpoint penilaian jawaban Gema: validasi dan kepemilikan. */

jest.mock('../gemaBelajar.service', () => ({ nilai: jest.fn(), catat: jest.fn(), statistik: jest.fn() }));
jest.mock('../gemaLLM.service', () => ({ jawab: jest.fn(), tersedia: jest.fn() }));
jest.mock('../gemaKamus.service', () => ({ muatKamus: jest.fn() }));
jest.mock('../gemaAkunPegawai.service', () => ({ jalankanSetelUlangSandi: jest.fn() }));
jest.mock('../../utils/logger', () => ({ warn: jest.fn(), info: jest.fn(), error: jest.fn() }));

const belajar = require('../gemaBelajar.service');
const { nilai } = require('../../controllers/gema.controller');

const panggil = async (body) => {
  const res = { status: jest.fn(() => res), json: jest.fn() };
  await nilai({ body, user: { id: 9 } }, res);
  return res;
};

describe('POST /nilai', () => {
  test.each([[{}], [{ id: 0, nilai: 1 }], [{ id: 1.5, nilai: 1 }], [{ id: 3, nilai: 2 }], [{ id: 'x', nilai: 1 }]])(
    'tidak valid %j -> 400', async (body) => {
      expect((await panggil(body)).status).toHaveBeenCalledWith(400);
    },
  );

  test('bukan milik penilai -> 404', async () => {
    belajar.nilai.mockResolvedValue(false);
    const res = await panggil({ id: 3, nilai: -1 });
    expect(belajar.nilai).toHaveBeenCalledWith(3, 9, -1);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  test('berhasil', async () => {
    belajar.nilai.mockResolvedValue(true);
    const res = await panggil({ id: 3, nilai: 0 });
    expect(res.json).toHaveBeenCalledWith({ success: true });
  });
});
