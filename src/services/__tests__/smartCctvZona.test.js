const mockPush = { sendToRoles: jest.fn().mockResolvedValue({ success: true }) };
jest.mock('../pushNotification.service', () => mockPush);
jest.mock('../serverAlerts.service', () => ({ periksa: jest.fn() }));
jest.mock('../go2rtc.service', () => ({}));
jest.mock('../../socket/cctv.socket', () => ({ emitCctvAlert: jest.fn() }));
jest.mock('../../config/prisma', () => ({
  cctv_cameras: { findUnique: jest.fn().mockResolvedValue({ id: 1n, name: 'Gerbang', lokasi: 'Lt 1' }) },
  cctv_events: {
    findUnique: jest.fn().mockResolvedValue(null),
    create: jest.fn().mockImplementation(async ({ data }) => ({ id: 5n, ...data }))
  },
  cctv_akses: { findMany: jest.fn().mockResolvedValue([{ user_id: 7n }]) }
}));

const prisma = require('../../config/prisma');
const svc = require('../smartCctv.service');

const zonaOk = [{ nama: 'Gerbang', titik: [[0.1, 0.1], [0.9, 0.1], [0.5, 0.9]] }];

describe('validasiZona', () => {
  test('valid dan dibulatkan 4 desimal', () => {
    const h = svc.validasiZona([{ nama: ' A ', titik: [[0.123456, 0], [1, 0.5], [0, 1]] }], { mulai: '17:00', selesai: '07:00' });
    expect(h.zona[0]).toEqual({ nama: 'A', titik: [[0.1235, 0], [1, 0.5], [0, 1]] });
    expect(h.jam_pantau).toEqual({ mulai: '17:00', selesai: '07:00' });
  });
  test('undefined tidak diubah; null/[] menghapus', () => {
    expect(svc.validasiZona(undefined, undefined)).toEqual({});
    expect(svc.validasiZona([], null)).toEqual({ zona: null, jam_pantau: null });
  });
  test.each([
    ['lebih dari 8 zona', Array(9).fill(zonaOk[0]), undefined],
    ['titik kurang dari 3', [{ nama: 'A', titik: [[0, 0], [1, 1]] }], undefined],
    ['koordinat di luar 0..1', [{ nama: 'A', titik: [[0, 0], [1.2, 1], [0, 1]] }], undefined],
    ['nama kosong', [{ nama: '', titik: zonaOk[0].titik }], undefined],
    ['jam salah format', undefined, { mulai: '25:00', selesai: '07:00' }],
    ['jam mulai = selesai', undefined, { mulai: '07:00', selesai: '07:00' }]
  ])('%s -> 422', (_n, z, j) => {
    expect(() => svc.validasiZona(z, j)).toThrow(expect.objectContaining({ status: 422 }));
  });
});

describe('ingest emergency', () => {
  beforeEach(() => jest.clearAllMocks());

  test('person tanpa di_zona diabaikan', async () => {
    const r = await svc.simpanEmergencyEvent({ camera_id: '1', type: 'person' }, Buffer.from('x'));
    expect(r).toEqual({ status: 200, hasil: { success: true, diabaikan: true } });
    expect(prisma.cctv_events.create).not.toHaveBeenCalled();
  });

  test('person di_zona disimpan dengan nama', async () => {
    const r = await svc.simpanEmergencyEvent({ camera_id: '1', type: 'person', severity: 'warning', di_zona: '1', nama: 'Orang di zona Gerbang', nama_zona: 'Gerbang', jumlah_orang: '2' }, null);
    expect(r.status).toBe(201);
    expect(prisma.cctv_events.create.mock.calls[0][0].data).toMatchObject({ nama: 'Orang di zona Gerbang', type: 'person' });
  });

  test('fall memicu push, panggilan kedua dijeda 10 menit', async () => {
    await svc.simpanEmergencyEvent({ camera_id: '1', type: 'fall' }, null);
    await svc.simpanEmergencyEvent({ camera_id: '1', type: 'fall' }, null);
    await new Promise((r) => setImmediate(r));
    expect(mockPush.sendToRoles).toHaveBeenCalledTimes(1);
    const [roles, notif, opsi] = mockPush.sendToRoles.mock.calls[0];
    expect(roles).toEqual(['superadmin']);
    expect(notif.path).toBe('cctv/peringatan');
    expect(opsi.userIds).toEqual([7n]);
  });
});
