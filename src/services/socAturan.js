/**
 * Aturan SOC — fungsi murni (tanpa DB/jaringan) yang menilai event keamanan
 * dan login menjadi insiden. Mesin yang memakainya ada di soc.service.js.
 */

const { EVENT_TYPES } = require('../config/serverManagement');

const URUTAN = { low: 1, medium: 2, high: 3, critical: 4 };

/** Negatif bila a lebih ringan dari b, positif bila lebih berat, 0 bila sama. */
const bandingSeverity = (a, b) => (URUTAN[a] || 0) - (URUTAN[b] || 0);

const KATEGORI = {
  honeypot: 'honeypot',
  brute_force: 'brute_force',
  login_failed: 'brute_force',
  auth_flood: 'brute_force',
  ssh_failed: 'server',
  wazuh_alert: 'server',
  sql_injection: 'serangan_web',
  xss: 'serangan_web',
  path_traversal: 'serangan_web',
  command_injection: 'serangan_web',
  scanner: 'serangan_web',
  bad_bot: 'serangan_web',
  nginx_attack: 'serangan_web',
  not_found_flood: 'serangan_web',
  rate_limit: 'serangan_web',
  upload_rejected: 'serangan_web',
};

const TIPE_IP_PRIVAT = new Set(['ssh_failed', 'brute_force', 'wazuh_alert']);
const TIPE_KANTOR_ABAI = new Set(['login_failed', 'brute_force', 'rate_limit', 'auth_flood', 'not_found_flood']);

/** Nama agent Wazuh dari detail "<agent>: [id] deskripsi". */
const agentWazuh = (detail) => {
  const i = String(detail || '').indexOf(':');
  const nama = i > 0 ? String(detail).slice(0, i).trim() : '';
  return nama || 'umum';
};

/** Kunci korelasi sebuah event (dipakai juga untuk menempelkan event yang tidak membuka insiden). */
const kunciEvent = (e) => {
  if (e.source === 'wazuh' && (!e.ip_address || e.ip_address === '0.0.0.0')) return `wazuh:${agentWazuh(e.detail)}`;
  return `ip:${e.ip_address}`;
};

const nilaiEvent = (e, ctx) => {
  const tipe = e.event_type;
  const ip = e.ip_address;
  const kunci = kunciEvent(e);
  const label = EVENT_TYPES[tipe]?.label || tipe;
  const kategori = KATEGORI[tipe] || 'lainnya';
  const sev = e.severity;

  if (e.source === 'wazuh') {
    if (bandingSeverity(sev, 'medium') < 0) return null;
    const judul = kunci.startsWith('wazuh:') ? `${label} pada ${kunci.slice(6)}` : `${label} dari ${ip}`;
    return { buka: true, kunci, kategori: 'server', severity: sev, judul };
  }
  if (ctx.ipPrivat(ip) && !TIPE_IP_PRIVAT.has(tipe)) return null;
  if (ctx.ipKantor.has(ip) && TIPE_KANTOR_ABAI.has(tipe)) return null;

  let buka = false;
  if (sev === 'critical' || sev === 'high') buka = true;
  else if (sev === 'medium') buka = ctx.hitungMedium(ip) >= 5;
  if (!buka) return null;
  return { buka: true, kunci, kategori, severity: sev, judul: `${label} dari ${ip}` };
};

const nilaiLogin = (login, ctx) => {
  const kandidat = [];
  const tambah = (severity, judul) => kandidat.push({ buka: true, kunci: `akun:${login.user_id}`, kategori: 'akun', severity, judul });
  const mulai = ctx.jamSepiMulai ?? 22;
  const selesai = ctx.jamSepiSelesai ?? 5;
  const superadmin = ctx.peran === 'superadmin';

  if (ctx.ipBerbahaya) tambah('critical', 'Login berhasil dari IP yang sebelumnya menyerang');
  if (ctx.negara && ctx.negara !== 'ID') tambah('high', `Login dari luar negeri (${ctx.negara})`);
  if (superadmin && !ctx.ipPernahDipakai) tambah('high', 'Login superadmin dari IP baru');
  if (superadmin && (ctx.jamWib >= mulai || ctx.jamWib < selesai)) tambah('medium', 'Login superadmin di luar jam kerja');

  return kandidat.sort((a, b) => bandingSeverity(b.severity, a.severity))[0] || null;
};

/** Email dari detail login_failed: "Email: x@y (alasan)". */
const emailDariDetail = (detail) => {
  const m = /^Email:\s*(.+?)\s*\(/.exec(String(detail || ''));
  return m ? m[1] : null;
};

const nilai2fa = (daftar) => {
  const hitung = new Map();
  for (const e of daftar || []) {
    if (!/kode 2FA salah/i.test(e.detail || '')) continue;
    const email = emailDariDetail(e.detail);
    if (email) hitung.set(email, (hitung.get(email) || 0) + 1);
  }
  for (const [email, n] of hitung) {
    if (n >= 3) {
      return {
        buka: true,
        kunci: `akun-email:${email}`,
        kategori: 'akun',
        severity: 'high',
        judul: `Kode 2FA salah berulang untuk ${email} (sandi kemungkinan sudah diketahui pihak lain)`,
      };
    }
  }
  return null;
};

const perubahanSuperadmin = (idLama, idBaru) => ({
  tambah: [...idBaru].filter((x) => !idLama.has(x)),
  hapus: [...idLama].filter((x) => !idBaru.has(x)),
});

module.exports = { bandingSeverity, kunciEvent, nilaiEvent, nilaiLogin, nilai2fa, emailDariDetail, perubahanSuperadmin };
