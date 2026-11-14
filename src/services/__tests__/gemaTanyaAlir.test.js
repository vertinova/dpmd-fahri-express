/** Controller SSE Gema: token lalu selesai, dengan req/res tiruan. */

jest.mock('../gemaLLM.service', () => ({
  jawab: jest.fn(async (teks, pelaku, sesi, opsi) => {
    opsi.onToken('Halo');
    return { maksud: 'desa', kalimat: 'Halo', total: 1 };
  }),
  tersedia: () => true,
}));
jest.mock('../gemaAkunPegawai.service', () => ({ jalankanSetelUlangSandi: jest.fn() }));

const { EventEmitter } = require('events');
const { tanyaAlir } = require('../../controllers/gema.controller');

const buatRes = () => {
  const res = new EventEmitter();
  res.out = '';
  res.flushes = 0;
  res.writableEnded = false;
  res.status = () => res;
  res.set = () => res;
  res.flushHeaders = jest.fn();
  res.write = (s) => { res.out += s; };
  res.flush = () => { res.flushes += 1; };
  res.end = () => { res.writableEnded = true; };
  return res;
};

test('tanyaAlir mengirim event token lalu selesai', async () => {
  const res = buatRes();
  await tanyaAlir({ body: { teks: 'halo', sesi: 's1' }, user: { id: 1 } }, res);

  expect(res.flushHeaders).toHaveBeenCalled();
  expect(res.flushes).toBeGreaterThan(0);
  expect(res.out.indexOf('event: token')).toBeGreaterThanOrEqual(0);
  expect(res.out.indexOf('event: selesai')).toBeGreaterThan(res.out.indexOf('event: token'));
  expect(res.writableEnded).toBe(true);
});
