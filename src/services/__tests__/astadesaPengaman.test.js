/**
 * Pengaman penyusuran ASTA DESA:
 *  - hasil yang jauh lebih buruk (halaman gagal) tidak menimpa potret lama;
 *  - kegagalan 502 beruntun mengerem, lalu menyerah dan beristirahat.
 */

process.env.ASTADESA_POTRET = '0';
process.env.ASTADESA_TOKEN = 'uji';

jest.mock('axios');
const axios = require('axios');
const asta = require('../astadesa.service');

const halaman = (p, ukuran = 200, last = 3) => ({
  data: {
    data: Array.from({ length: ukuran }, (_, i) => ({ id: (p - 1) * ukuran + i + 1 })),
    meta: { last_page: last, total: last * ukuran }
  }
});
const galat = (status) => Object.assign(new Error(`status ${status}`), { response: { status, headers: {} } });

beforeEach(() => axios.get.mockReset());
afterEach(() => jest.useRealTimers());

test('penyusuran dengan halaman gagal tidak menimpa potret lama yang utuh', async () => {
  axios.get.mockImplementation((url, { params }) => Promise.resolve(halaman(params.page)));
  const utuh = await asta.ambilSemua('/uji-a', {}, { force: true });
  expect(utuh.terbaca).toBe(600);

  // Halaman 2–3 gagal (404: bukan galat sesaat, langsung dihitung gagal).
  axios.get.mockImplementation((url, { params }) =>
    params.page === 1 ? Promise.resolve(halaman(1)) : Promise.reject(galat(404))
  );
  const kedua = await asta.ambilSemua('/uji-a', {}, { force: true });
  expect(kedua.terbaca).toBe(600);
  expect(kedua).toBe(utuh);
});

test('502 beruntun mengerem lalu menyerah, dan tidak langsung mulai lagi', async () => {
  jest.useFakeTimers();
  axios.get.mockImplementation((url, { params }) =>
    params.page === 1 ? Promise.resolve(halaman(1, 200, 50)) : Promise.reject(galat(502))
  );
  let hasil;
  const p = asta.ambilSemua('/uji-b', {}, { force: true }).then(
    (v) => (hasil = { v }),
    (e) => (hasil = { e })
  );
  // Rem 60 dtk x 11 + percobaan ulang per halaman; maju sampai selesai.
  for (let i = 0; i < 400 && !hasil; i += 1) await jest.advanceTimersByTimeAsync(5000);
  await p;
  expect(hasil.e?.tidakSehat).toBe(true);
  // Jauh lebih sedikit dari ±300 permintaan/menit selama ±11 menit.
  expect(axios.get.mock.calls.length).toBeLessThan(400);

  const lagi = await asta.ambilSemua('/uji-b', {}, { latar: true });
  expect(lagi.belum_siap).toBe(true);
  await expect(asta.ambilSemua('/uji-b', {})).rejects.toThrow(/ditunda/);
});
