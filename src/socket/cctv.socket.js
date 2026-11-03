/**
 * Socket Smart CCTV.
 *
 * Dipasang dari meeting.socket.js (pemilik instance io). Staf yang
 * terautentikasi bergabung ke room `cctv`; setiap peristiwa deteksi baru
 * di-broadcast ke room itu sebagai event `cctv_alert` sehingga grid kamera &
 * toast peringatan langsung ter-update tanpa polling.
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
  io.on('connection', (socket) => {
    const user = socket.user;
    if (!user || user.isGuest) return;
    if (STAFF_ROLES.includes(user.role)) {
      socket.join('cctv');
      console.log(`[Socket] ${user.name} joined room cctv`);
    }
  });
};

/** Broadcast peristiwa baru ke seluruh staf yang sedang membuka aplikasi. */
const emitCctvAlert = (payload) => {
  if (!ioRef) return;
  ioRef.to('cctv').emit('cctv_alert', payload);
};

module.exports = { initCctvSocket, emitCctvAlert };
