/**
 * Cermin layar: superadmin menonton langsung layar satu pengguna.
 *
 * Hanya siaran, tidak ada rekaman. Tidak satu bingkai pun disimpan: bingkai rrweb
 * mengalir dari peramban pengguna ke peramban yang menonton lalu hilang, dan selama
 * tidak ada yang menonton peramban pengguna tidak merekam apa pun. Arsip layar semua
 * orang jauh lebih berbahaya bocor daripada gunanya.
 *
 * Namespace socket.io, bukan WebSocket sendiri: proxy produksi hanya meneruskan
 * /socket.io. Pengguna memegang satu soket diam; server baru menyuruhnya merekam
 * begitu ada penonton, dan menyuruhnya berhenti saat penonton terakhir pergi.
 *
 * Penyelubungan isian terjadi di peramban (components/CerminSubjek.jsx), sebelum
 * bingkainya lahir. Server hanya menyalurkan dan sengaja tidak membaca isinya.
 */
const jwt = require('jsonwebtoken');
const prisma = require('../config/prisma');
const logger = require('../utils/logger');
const { catatAktivitas } = require('../services/pantauAktivitas');

const ruangSubjek = (id) => `subjek:${id}`;
const ruangPenonton = (id) => `penonton:${id}`;

// Menonton layar orang lain harus meninggalkan jejak: pengawasan tanpa catatan
// siapa menonton siapa adalah wewenang yang tidak bisa dipertanggungjawabkan.
const catatJejak = (admin, sasaran, mulai) => {
  const description = `${mulai ? 'Mulai menonton' : 'Berhenti menonton'} layar ${sasaran.name}`;
  catatAktivitas(admin, { jenis: 'ubah', teks: description });
  prisma.activity_logs.create({
    data: {
      user_id: BigInt(admin.id),
      user_name: admin.name,
      user_role: admin.role,
      module: 'cermin_layar',
      action: mulai ? 'mulai_tonton' : 'henti_tonton',
      entity_type: 'user',
      entity_id: BigInt(sasaran.id),
      entity_name: sasaran.name,
      description,
    },
  }).catch((err) => logger.error('Gagal mencatat jejak cermin layar:', err.message));
};

let nspRef = null;

/** Peramban pengguna ini memegang soket cermin? Versi lama aplikasi tidak punya. */
const bisaDitonton = (userId) => !!nspRef?.adapter.rooms.has(ruangSubjek(userId));

const initCerminSocket = (io) => {
  const nsp = io.of('/cermin');
  nspRef = nsp;
  const jumlah = (ruang) => nsp.adapter.rooms.get(ruang)?.size ?? 0;
  const selaraskan = (id) => nsp.to(ruangSubjek(id)).emit(jumlah(ruangPenonton(id)) ? 'mulai-rekam' : 'henti-rekam');

  // Peran dibaca ulang dari basis data: token berumur panjang, dan akun yang baru
  // diturunkan haknya masih memegang token lama yang berbunyi superadmin.
  nsp.use(async (socket, next) => {
    try {
      const token = String(socket.handshake.auth?.token || '').replace(/^Bearer /, '');
      const { id } = jwt.verify(token, process.env.JWT_SECRET);
      const akun = await prisma.users.findUnique({
        where: { id: BigInt(id) },
        select: { id: true, name: true, role: true, is_active: true },
      });
      if (!akun?.is_active) return next(new Error('Akun tidak aktif'));
      socket.data.akun = { id: String(akun.id), name: akun.name, role: akun.role };
      next();
    } catch {
      next(new Error('Token tidak sah'));
    }
  });

  nsp.on('connection', (socket) => {
    const akun = socket.data.akun;

    if (socket.handshake.auth?.peran === 'tonton') {
      const berhenti = () => {
        const sasaran = socket.data.sasaran;
        if (!sasaran) return;
        socket.data.sasaran = null;
        socket.leave(ruangPenonton(sasaran.id));
        catatJejak(akun, sasaran, false);
        selaraskan(sasaran.id);
      };

      socket.on('tonton', async ({ userId } = {}, jawab = () => {}) => {
        if (akun.role !== 'superadmin') return jawab({ ok: false, alasan: 'Hanya superadmin yang bisa menonton' });
        try {
          const target = await prisma.users.findUnique({
            where: { id: BigInt(userId) },
            select: { id: true, name: true, role: true },
          });
          if (!target) return jawab({ ok: false, alasan: 'Akun tidak ditemukan' });
          // Begitu wewenang ini bisa diarahkan ke yang setara, tidak ada lagi batas yang bisa ditegakkan.
          if (target.role === 'superadmin') return jawab({ ok: false, alasan: 'Layar sesama superadmin tidak bisa ditonton' });
          berhenti();
          const sasaran = { id: String(target.id), name: target.name };
          socket.data.sasaran = sasaran;
          socket.join(ruangPenonton(sasaran.id));
          catatJejak(akun, sasaran, true);
          jawab({ ok: true, subjekTersambung: jumlah(ruangSubjek(sasaran.id)) > 0 });
          selaraskan(sasaran.id);
        } catch {
          jawab({ ok: false, alasan: 'Gagal memulai siaran' });
        }
      });
      socket.on('henti', berhenti);
      socket.on('disconnect', berhenti);
      return;
    }

    // --- subjek ---
    const ruang = ruangPenonton(akun.id);
    socket.join(ruangSubjek(akun.id));
    if (jumlah(ruang) > 0) {
      socket.emit('mulai-rekam');
      nsp.to(ruang).emit('subjek-hadir');
    }

    const salurkan = (nama) => (isi) => {
      // Tidak ada yang menonton lagi: jangan biarkan peramban bekerja untuk siaran kosong.
      if (jumlah(ruang) === 0) return socket.emit('henti-rekam');
      nsp.to(ruang).emit(nama, isi);
    };
    socket.on('bingkai', salurkan('bingkai'));
    socket.on('aktivitas', salurkan('aktivitas'));

    socket.on('disconnect', () => {
      if (jumlah(ruangSubjek(akun.id)) === 0) nsp.to(ruang).emit('subjek-pergi');
    });
  });
};

module.exports = { initCerminSocket, bisaDitonton };
