/**
 * Push pengingat pagi untuk Daftar Tugas pribadi. Khusus akun Sekretaris Dinas
 * (permintaan 11 Nov 2026): tugas pengguna lain tidak pernah dikirimi push.
 */
const prisma = require('../config/prisma');
const logger = require('../utils/logger');
const PushNotificationService = require('./pushNotificationService');
const { susunPengingat } = require('../utils/tugasPribadi');

const PERAN_PENERIMA = 'sekretaris_dinas';
const hariIniWib = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(new Date());

/** Satu push per pengguna berisi tugas belum selesai yang jatuh tempo hari ini atau sudah lewat. */
async function kirimPengingatTugas(hari = hariIniWib()) {
  const baris = await prisma.tugas_pribadi.findMany({
    where: {
      selesai: false,
      tanggal_pengingat: { lte: new Date(`${hari}T00:00:00Z`) },
      users: { role: PERAN_PENERIMA, is_active: true },
    },
    select: { user_id: true, judul: true, tanggal_pengingat: true },
    orderBy: [{ tanggal_pengingat: 'asc' }, { created_at: 'asc' }],
  });

  const perPengguna = new Map();
  for (const b of baris) {
    const k = String(b.user_id);
    if (!perPengguna.has(k)) perPengguna.set(k, []);
    perPengguna.get(k).push(b);
  }

  let terkirim = 0;
  for (const [userId, daftar] of perPengguna) {
    const { title, body } = susunPengingat(daftar, hari);
    const payload = {
      title, body,
      icon: '/logo-192.png', badge: '/logo-96.png',
      tag: 'tugas_pribadi',
      data: { type: 'tugas_pribadi', url: '/dpmd/dashboard' },
    };
    try {
      // simpan di lonceng notifikasi juga, supaya tetap terlihat bila push gagal/izin ditolak
      await PushNotificationService.storeNotifications([userId], payload);
      const hasil = await PushNotificationService.sendToUser(Number(userId), payload);
      if (hasil.success) terkirim++;
    } catch (error) {
      logger.error(`Pengingat tugas gagal untuk user ${userId}:`, error);
    }
  }
  return { pengguna: perPengguna.size, terkirim };
}

module.exports = { kirimPengingatTugas, hariIniWib };
