/**
 * Jejak aktivitas langsung untuk monitor user online di dashboard superadmin:
 * login, halaman yang dibuka, dan permintaan yang mengubah data.
 *
 * Sengaja di memori, bukan di activity_logs. Tabel itu jejak audit per modul yang
 * dibaca dashboard bidang; tiap buka halaman akan membanjirinya, dan monitor ini
 * hanya perlu tahu apa yang sedang terjadi, bukan menyimpan riwayat.
 * shortcut: hilang saat proses restart dan hanya sah untuk satu proses PM2 (seperti
 * onlineUsers di meeting.socket.js), pindah ke tabel sendiri bila butuh riwayat atau cluster.
 *
 * Isi permintaan tidak pernah disimpan, hanya path yang sudah dibersihkan.
 */

const BATAS_JEJAK = 1000;

// Dimulai dari jam supaya id tetap naik sesudah restart; monitor yang terbuka tidak tersangkut.
let urut = Date.now();
const jejak = [];
const halamanTerakhir = new Map(); // userId(string) -> path

const VERBA = { POST: 'Membuat', PUT: 'Mengubah', PATCH: 'Mengubah', DELETE: 'Menghapus' };

// Permintaan latar yang bukan tindakan pengguna.
const LEWATI = /^\/api\/(settings\/presence|auth\/renew|push-notification|messaging|chatbot)(\/|$)/;

const LABEL_KHUSUS = {
  '/api/auth/logout': 'Keluar dari aplikasi',
  '/api/settings/change-password': 'Mengganti kata sandi',
};

// Id dan token di path tidak berguna bagi pembaca, dan sebagian bersifat rahasia.
const bukanNama = (s) => /^\d+$/.test(s) || /^[0-9a-f-]{8,}$/i.test(s) || s.length > 40 || (s.length >= 16 && /\d/.test(s));

const bersihkanPath = (path) =>
  `/${String(path).split(/[?#]/)[0].split('/').filter(Boolean).map((s) => (bukanNama(s) ? ':id' : s)).join('/')}`;

const deskripsi = (method, path) => {
  const bersih = bersihkanPath(path);
  if (LABEL_KHUSUS[bersih]) return LABEL_KHUSUS[bersih];
  const bagian = bersih.split('/').filter((s) => s && s !== 'api' && s !== ':id').map((s) => s.replace(/[-_]/g, ' '));
  return `${VERBA[method]} ${bagian.join(' › ') || 'data'}`;
};

const catatAktivitas = (user, { jenis, teks, path = null, status = null, ip = null }) => {
  jejak.push({
    id: ++urut,
    waktu: new Date().toISOString(),
    user_id: String(user.id),
    nama: user.name,
    peran: user.role,
    jenis,
    teks,
    path,
    status,
    ip: ip?.replace(/^::ffff:/, '') || null,
  });
  if (jejak.length > BATAS_JEJAK) jejak.shift();
};

/** Dipanggil middleware auth: mencatat permintaan yang mengubah data begitu selesai. */
const pantauPermintaan = (req, res) => {
  if (!VERBA[req.method]) return;
  const path = req.originalUrl.split('?')[0];
  if (LEWATI.test(path)) return;
  const user = req.user;
  res.once('finish', () => {
    catatAktivitas(user, {
      jenis: 'ubah',
      teks: deskripsi(req.method, path),
      path: `${req.method} ${bersihkanPath(path)}`,
      status: res.statusCode,
      ip: req.ip,
    });
  });
};

/** Denyut dari peramban: mencatat halaman baru, denyut di halaman yang sama diabaikan. */
const catatHalaman = (user, path, ip) => {
  const bersih = bersihkanPath(path);
  const id = String(user.id);
  if (halamanTerakhir.get(id) === bersih) return;
  halamanTerakhir.set(id, bersih);
  catatAktivitas(user, { jenis: 'halaman', teks: 'Membuka halaman', path: bersih, ip });
};

const halamanKini = (userId) => halamanTerakhir.get(String(userId)) || null;

/** Terbaru lebih dulu; `setelah` = id terakhir yang sudah dimiliki monitor. */
const ambilAktivitas = ({ setelah = 0, userId = null, batas = 100 } = {}) => {
  const hasil = [];
  for (let i = jejak.length - 1; i >= 0 && hasil.length < batas; i--) {
    if (jejak[i].id <= setelah) break;
    if (!userId || jejak[i].user_id === String(userId)) hasil.push(jejak[i]);
  }
  return hasil;
};

module.exports = { catatAktivitas, pantauPermintaan, catatHalaman, halamanKini, ambilAktivitas, bersihkanPath };
