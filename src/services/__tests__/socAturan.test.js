const {
  nilaiEvent, nilaiLogin, nilai2fa, perubahanSuperadmin, bandingSeverity, kunciEvent,
} = require('../socAturan');
// Cermin soc.service: RFC1918 + LAN DPMD 172.168.x.x.
const privat = (ip) => /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|172\.168\.)/.test(ip);

const ctx = (o = {}) => ({
  ipKantor: new Set(['103.51.103.197']),
  ipPrivat: privat,
  hitungMedium: () => 1,
  ...o,
});
const ev = (o) => ({ ip_address: '8.8.8.8', event_type: 'sql_injection', severity: 'critical', source: 'app', detail: null, ...o });

describe('nilaiEvent', () => {
  test('critical dan high membuka insiden dengan kategori & judul', () => {
    expect(nilaiEvent(ev(), ctx())).toEqual({
      buka: true, kunci: 'ip:8.8.8.8', kategori: 'serangan_web', severity: 'critical', judul: 'SQL Injection dari 8.8.8.8',
    });
    expect(nilaiEvent(ev({ event_type: 'xss', severity: 'high' }), ctx()).severity).toBe('high');
    expect(nilaiEvent(ev({ event_type: 'honeypot', severity: 'high' }), ctx()).kategori).toBe('honeypot');
  });

  test('medium hanya membuka bila >= 5 dalam 30 menit; low tidak pernah', () => {
    const e = ev({ event_type: 'scanner', severity: 'medium' });
    expect(nilaiEvent(e, ctx({ hitungMedium: () => 4 }))).toBeNull();
    expect(nilaiEvent(e, ctx({ hitungMedium: () => 5 })).severity).toBe('medium');
    expect(nilaiEvent(ev({ severity: 'low' }), ctx())).toBeNull();
  });

  test('IP privat hanya untuk ssh_failed, brute_force, wazuh_alert', () => {
    expect(nilaiEvent(ev({ ip_address: '172.168.20.23' }), ctx())).toBeNull();
    const ssh = nilaiEvent(ev({ ip_address: '10.0.0.5', event_type: 'ssh_failed', severity: 'high' }), ctx());
    expect(ssh.kategori).toBe('server');
  });

  test('IP kantor mengabaikan login_failed/rate_limit tetapi tetap memproses serangan', () => {
    const kantor = '103.51.103.197';
    expect(nilaiEvent(ev({ ip_address: kantor, event_type: 'brute_force', severity: 'high' }), ctx())).toBeNull();
    expect(nilaiEvent(ev({ ip_address: kantor, event_type: 'rate_limit', severity: 'high' }), ctx())).toBeNull();
    expect(nilaiEvent(ev({ ip_address: kantor }), ctx()).buka).toBe(true);
  });

  test('wazuh memakai kunci agent, kecuali srcip publik', () => {
    const w = ev({ ip_address: '0.0.0.0', event_type: 'wazuh_alert', severity: 'medium', source: 'wazuh', detail: 'ct-web: [5710] sshd gagal' });
    expect(kunciEvent(w)).toBe('wazuh:ct-web');
    expect(nilaiEvent(w, ctx())).toMatchObject({ buka: true, kunci: 'wazuh:ct-web', kategori: 'server' });
    expect(nilaiEvent({ ...w, severity: 'low' }, ctx())).toBeNull();
    expect(nilaiEvent({ ...w, ip_address: '1.2.3.4' }, ctx()).kunci).toBe('ip:1.2.3.4');
  });
});

describe('nilaiLogin', () => {
  const dasar = { peran: 'pegawai', ipPernahDipakai: true, negara: 'ID', ipBerbahaya: false, jamWib: 10 };
  const login = { user_id: 12 };

  test('login normal tidak membuka insiden', () => {
    expect(nilaiLogin(login, dasar)).toBeNull();
  });
  test('A1-A4', () => {
    expect(nilaiLogin(login, { ...dasar, ipBerbahaya: true }).severity).toBe('critical');
    expect(nilaiLogin(login, { ...dasar, negara: 'US' }).judul).toBe('Login dari luar negeri (US)');
    expect(nilaiLogin(login, { ...dasar, peran: 'superadmin', ipPernahDipakai: false })).toMatchObject({ severity: 'high', kunci: 'akun:12', kategori: 'akun' });
    expect(nilaiLogin(login, { ...dasar, peran: 'superadmin', jamWib: 23 }).severity).toBe('medium');
    expect(nilaiLogin(login, { ...dasar, peran: 'superadmin', jamWib: 3 }).severity).toBe('medium');
    expect(nilaiLogin(login, { ...dasar, jamWib: 23 })).toBeNull();
  });
  test('mengambil yang terberat', () => {
    const r = nilaiLogin(login, { ...dasar, peran: 'superadmin', ipPernahDipakai: false, negara: 'RU', ipBerbahaya: true, jamWib: 2 });
    expect(r.severity).toBe('critical');
    const r2 = nilaiLogin(login, { ...dasar, peran: 'superadmin', jamWib: 2, negara: 'RU' });
    expect(r2.severity).toBe('high');
  });
});

describe('nilai2fa', () => {
  const f = (email, n) => Array.from({ length: n }, () => ({ detail: `Email: ${email} (kode 2FA salah)` }));
  test('ambang 3 untuk email yang sama', () => {
    expect(nilai2fa(f('a@x.id', 2))).toBeNull();
    expect(nilai2fa([...f('a@x.id', 2), ...f('b@x.id', 2)])).toBeNull();
    expect(nilai2fa(f('a@x.id', 3))).toMatchObject({ buka: true, kunci: 'akun-email:a@x.id', severity: 'high', kategori: 'akun' });
  });
  test('login gagal biasa tidak dihitung', () => {
    expect(nilai2fa(Array.from({ length: 5 }, () => ({ detail: 'Email: a@x.id (sandi salah)' })))).toBeNull();
  });
});

test('perubahanSuperadmin', () => {
  expect(perubahanSuperadmin(new Set(['1', '2']), new Set(['2', '3']))).toEqual({ tambah: ['3'], hapus: ['1'] });
});

test('bandingSeverity mengurutkan low<medium<high<critical', () => {
  expect(bandingSeverity('low', 'medium')).toBeLessThan(0);
  expect(bandingSeverity('critical', 'high')).toBeGreaterThan(0);
  expect(bandingSeverity('high', 'high')).toBe(0);
});
