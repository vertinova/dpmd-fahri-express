const mockAlerts = { periksa: jest.fn() };
jest.mock('../serverAlerts.service', () => mockAlerts);
jest.mock('../go2rtc.service', () => ({}));
jest.mock('../../socket/cctv.socket', () => ({ emitCctvAlert: jest.fn() }));
jest.mock('../../config/prisma', () => ({
  cctv_cameras: { update: jest.fn().mockResolvedValue({}), findUnique: jest.fn().mockResolvedValue({ id: 1n, name: 'K1', lokasi: 'X' }) },
  cctv_events: { create: jest.fn().mockImplementation(async ({ data }) => ({ id: 9n, ...data })) }
}));

const prisma = require('../../config/prisma');
const svc = require('../smartCctv.service');

const menit = (n) => new Date(Date.now() - n * 60000).toISOString();
const balas = (bingkai) => {
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ kamera: [{ id: 1, nama: 'K1', aktif: true, bingkai_terakhir: bingkai, galat: 'timeout' }] })
  });
};

beforeEach(() => jest.clearAllMocks());

describe('pantauKesehatanKamera', () => {
  test('bingkai segar: update last_online_at, tanpa peristiwa', async () => {
    balas({ pada: menit(1), orang: 0 });
    await svc.pantauKesehatanKamera();
    expect(prisma.cctv_cameras.update).toHaveBeenCalledTimes(1);
    expect(prisma.cctv_events.create).not.toHaveBeenCalled();
    expect(mockAlerts.periksa).toHaveBeenCalledWith('cctv_ai', false, expect.any(Object));
  });

  test('basi: satu peristiwa warning saja, lalu pulih -> info', async () => {
    balas({ pada: menit(10), orang: 0 });
    await svc.pantauKesehatanKamera();
    await svc.pantauKesehatanKamera();
    expect(prisma.cctv_events.create).toHaveBeenCalledTimes(1);
    expect(prisma.cctv_events.create.mock.calls[0][0].data).toMatchObject({ severity: 'warning', status: 'active', nama: 'Kamera tidak menjawab' });

    balas({ pada: menit(0), orang: 1 });
    await svc.pantauKesehatanKamera();
    expect(prisma.cctv_events.create).toHaveBeenCalledTimes(2);
    expect(prisma.cctv_events.create.mock.calls[1][0].data).toMatchObject({ severity: 'info', status: 'resolved', nama: 'Kamera kembali online' });
  });

  test('fetch gagal: alerts.periksa dipanggil dengan kondisi gagal', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    await svc.pantauKesehatanKamera();
    expect(mockAlerts.periksa).toHaveBeenCalledWith('cctv_ai', true, expect.objectContaining({ message: 'ECONNREFUSED' }));
  });
});

test('batas tanggal WIB', () => {
  expect(svc.batasTanggalWib('2026-11-19', false).toISOString()).toBe('2026-11-18T17:00:00.000Z');
  expect(svc.batasTanggalWib('2026-11-19', true).toISOString()).toBe('2026-11-19T16:59:59.999Z');
});
