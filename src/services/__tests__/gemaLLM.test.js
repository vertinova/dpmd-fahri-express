/** Lapis model Gema: loop alat, SSE, dan jatuh ke mesin cadangan. fetch, mesin, kamus, dan data di-mock. */

jest.mock('../gemaMesin.service', () => ({
  jawab: jest.fn(async () => ({
    maksud: 'desa', kalimat: 'Ada 2 desa', judul: 'Desa', kolom: ['nama'], baris: [{ nama: 'A' }, { nama: 'B' }], total: 2,
  })),
  pencarianMenyeluruh: jest.fn(),
}));
jest.mock('../gemaKamus.service', () => ({
  muatKamus: jest.fn(async () => ({ kecamatan: [{}], desa: [{}, {}] })),
}));
jest.mock('../gemaAkunPegawai.service', () => ({ cariAkun: jest.fn(), siapkanSetelUlangSandi: jest.fn() }));
jest.mock('../gemaData.service', () => ({
  cariTabel: jest.fn(),
  jalankanKueri: jest.fn(async () => ({ kolom: ['n'], baris: [{ n: 1 }], total: 1 })),
}));

process.env.GEMA_LLM_URL = 'http://llm.test/v1';
const mesin = require('../gemaMesin.service');
const llm = require('../gemaLLM.service');

const sse = (...delta) => {
  const teks = `${delta.map((d) => `data: ${JSON.stringify({ choices: [{ delta: d }] })}\n\n`).join('')}data: [DONE]\n\n`;
  return new Response(new ReadableStream({
    start(c) { c.enqueue(new TextEncoder().encode(teks)); c.close(); },
  }));
};
// Argumen dipecah ke dua delta, seperti aliran sungguhan.
const panggilan = (args) => [
  { tool_calls: [{ index: 0, id: 'c1', function: { name: 'cari_desa', arguments: args.slice(0, 5) } }] },
  { tool_calls: [{ index: 0, function: { arguments: args.slice(5) } }] },
];

describe('gemaLLM', () => {
  afterEach(() => { jest.clearAllMocks(); delete global.fetch; });

  test('tool_call lalu jawaban teks', async () => {
    global.fetch = jest.fn()
      .mockResolvedValueOnce(sse({ content: 'Sebentar ' }, ...panggilan('{"status_desa":"Mandiri"}')))
      .mockResolvedValueOnce(sse({ reasoning_content: 'mikir' }, { content: 'Ada ' }, { content: 'dua desa.' }));
    const onToken = jest.fn();
    const onReset = jest.fn();
    const jejak = { alat: [], sql: [] };

    const r = await llm.jawab('desa mandiri', { id: 1 }, null, { onToken, onReset, jejak });

    expect(r.ditenagai).toBe('model');
    expect(r.kalimat).toBe('Ada dua desa.');
    expect(r.baris).toHaveLength(2);
    expect(onToken).toHaveBeenCalledWith('Ada ');
    expect(onReset).toHaveBeenCalledTimes(1);
    expect(mesin.jawab).toHaveBeenCalledWith('desa berstatus Mandiri');
    expect(jejak.alat).toEqual(['cari_desa']);
  });

  test('fetch melempar -> mesin-cadangan', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('putus'));
    const r = await llm.jawab('desa', { id: 1 });
    expect(r.ditenagai).toBe('mesin-cadangan');
  });

  test('signal sudah dibatalkan -> dilempar, tidak jatuh ke mesin', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('abort'));
    const kontrol = new AbortController();
    kontrol.abort();
    await expect(llm.jawab('desa', { id: 1 }, null, { signal: kontrol.signal })).rejects.toThrow();
  });

  test('tool_call terus-menerus -> mesin-cadangan', async () => {
    global.fetch = jest.fn(async () => sse(...panggilan('{}')));
    const r = await llm.jawab('desa', { id: 1 });
    expect(global.fetch).toHaveBeenCalledTimes(6);
    expect(r.ditenagai).toBe('mesin-cadangan');
  });

  test('bacaAliran menggabungkan argumen per index', async () => {
    const r = await llm.bacaAliran(sse(...panggilan('{"a":1}')));
    expect(r.toolCalls).toEqual([{ id: 'c1', name: 'cari_desa', arguments: '{"a":1}' }]);
  });
});
