/**
 * Socket Smart CCTV.
 *
 * Dipasang dari meeting.socket.js (pemilik instance io). Hanya pengguna yang
 * berizin "peringatan" (atau superadmin) yang bergabung ke room `cctv`; setiap
 * peristiwa deteksi baru di-broadcast ke room itu sebagai event `cctv_alert`
 * sehingga grid kamera & toast peringatan langsung ter-update tanpa polling.
 * Saat superadmin mengubah akses, room disesuaikan saat itu juga (segarkanRoomCctv).
 */

let ioRef = null;

const STAFF_ROLES = [
  'superadmin',
  'kepala_dinas',
  'sekretaris_dinas',
  'kepala_bidang',
  'ketua_tim',
  'bendahara',
  'pegawai'
];

/** Daftarkan handler join room. Dipanggil sekali saat server start. */
const initCctvSocket = (io) => {
  ioRef = io;
  // dimuat di sini (bukan di atas) supaya tidak berputar dengan cctvAccess → prisma saat start
  const { izinCctv } = require('../middlewares/cctvAccess');
  io.on('connection', async (socket) => {
    const user = socket.user;
    if (!user || user.isGuest || !STAFF_ROLES.includes(user.role)) return;
    try {
      const izin = await izinCctv(user);
      if (izin.includes('peringatan')) socket.join('cctv');
    } catch (err) {
      console.warn(`[Socket] Gagal memeriksa akses CCTV ${user.name}: ${err.message}`);
    }
  });
};

/** Masukkan / keluarkan semua socket milik userId dari room `cctv`. */
const segarkanRoomCctv = (userId, boleh) => {
  if (!ioRef) return;
  for (const s of ioRef.sockets.sockets.values()) {
    if (String(s.user?.id) !== String(userId)) continue;
    if (boleh) s.join('cctv');
    else s.leave('cctv');
  }
};

/** Broadcast peristiwa baru ke staf berizin yang sedang membuka aplikasi. */
const emitCctvAlert = (payload) => {
  if (!ioRef) return;
  ioRef.to('cctv').emit('cctv_alert', payload);
};

module.exports = { initCctvSocket, emitCctvAlert, segarkanRoomCctv };
