// Namespace socket.io "/jelajah": tamu Jelajah Kantor 3D (halaman publik /jelajah)
// saling melihat dan berinteraksi di kantor yang sama.
//
// Namespace ini TIDAK memakai middleware JWT milik namespace utama — pengunjungnya
// tamu tanpa akun. Karena terbuka untuk umum, semua masukan dibersihkan dan dibatasi:
// nama ≤ 24 huruf, posisi harus angka di dalam batas dunia, chat ≤ 120 huruf dengan
// batas laju, dan jumlah koneksi per IP maupun total dibatasi.
//
// Alur:
//   klien → "gerak" {x,y,z,rot,pose,udara,lari,kend?}   (maks ±12x/detik, sisanya dibuang)
//   klien → "ucap" {teks}                           chat ke semua pemain
//   klien → "emote" {jenis}                         lambai, jempol, tepuk, tawa, hati
//   klien → "sapa" {ke}                             menyapa satu pemain tertentu
//   server → "selamat" {id, pemain[], kendaraan{}}  saat baru masuk
//   server → "masuk" / "keluar" / "posisi" / "ucap" / "emote" / "disapa" / "ditolak"

// Dibatasi 10 tamu sekaligus supaya beban server tetap ringan: siaran posisi
// tumbuh kuadrat terhadap jumlah pemain (10 tamu = 100 kiriman per tick).
const MAKS_PEMAIN = 10;
const MAKS_PER_IP = 10;
// Tamu yang diam (tab ditinggal) dikeluarkan supaya kursinya bisa dipakai tamu lain.
const BATAS_DIAM_MS = 10 * 60 * 1000;
const TICK_MS = 100;
const JEDA_GERAK_MS = 80;
const AVATAR = 4; // pilihan avatar per jenis kelamin
const KULIT = 3;
const EMOTE = new Set(['lambai', 'jempol', 'tepuk', 'tawa', 'hati']);
const POSE = new Set(['jalan', 'duduk', 'mobil', 'motor']);
const ID_KENDARAAN = /^(mobil|motor):\d{1,2}$/;
// Batas dunia jelajah (lihat dpmd-frontend/src/features/jelajah/scene/layout.js).
const BATAS = { x0: -40, x1: 40, z0: -30, z1: 40, y0: -1, y1: 9 };

// Kata kasar yang paling umum disaring dari nama & chat. Bukan filter sempurna,
// sekadar mencegah yang paling mencolok tampil di atas kepala tamu lain.
const KATA_KASAR = /\b(anjing|anjg|bangsat|babi|kontol|memek|ngentot|goblok|tolol|asu|jancok|jancuk|bajingan|fuck|shit)\b/gi;

function bersihkanTeks(nilai, maks) {
  if (typeof nilai !== 'string') return '';
  return nilai
    .normalize('NFC')
    .replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2066-\u2069]/g, '')
    .replace(/[<>]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maks)
    .replace(KATA_KASAR, (k) => '*'.repeat(k.length));
}

const angka = (v, min, max) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : null);
const bulat = (v, d = 100) => Math.round(v * d) / d;

function ipDari(socket) {
  const xff = socket.handshake.headers['x-forwarded-for'];
  if (typeof xff === 'string' && xff) return xff.split(',')[0].trim();
  return socket.handshake.address || 'tak-dikenal';
}

// Batas laju sederhana: maksimum `n` kejadian per `ms` milidetik.
function pembatas(n, ms) {
  const waktu = [];
  return () => {
    const kini = Date.now();
    while (waktu.length && kini - waktu[0] > ms) waktu.shift();
    if (waktu.length >= n) return false;
    waktu.push(kini);
    return true;
  };
}

function initJelajahSocket(io) {
  const nsp = io.of('/jelajah');
  const pemain = new Map(); // socket.id → data publik
  const perIp = new Map();
  const kendaraan = new Map(); // id → { x, z, rot } terakhir
  const kotor = new Set();

  nsp.use((socket, next) => {
    const ip = ipDari(socket);
    if (pemain.size >= MAKS_PEMAIN) return next(new Error('penuh'));
    if ((perIp.get(ip) || 0) >= MAKS_PER_IP) return next(new Error('terlalu-banyak'));
    const a = socket.handshake.auth || {};
    const nama = bersihkanTeks(a.nama, 24) || 'Tamu';
    const jk = a.jk === 'P' ? 'P' : 'L';
    const avatar = Number.isInteger(a.avatar) && a.avatar >= 0 && a.avatar < AVATAR ? a.avatar : 0;
    const kulit = Number.isInteger(a.kulit) && a.kulit >= 0 && a.kulit < KULIT ? a.kulit : 0;
    socket.data.ip = ip;
    socket.data.profil = { nama, jk, avatar, kulit };
    next();
  });

  // Satu siaran gabungan per tick, hanya untuk pemain yang bergerak.
  const tick = setInterval(() => {
    if (!kotor.size) return;
    const daftar = [];
    for (const id of kotor) {
      const p = pemain.get(id);
      if (p) daftar.push({ id, s: p.s });
    }
    kotor.clear();
    if (daftar.length) nsp.volatile.emit('posisi', daftar);
  }, TICK_MS);
  tick.unref?.();

  const sapuDiam = setInterval(() => {
    const batas = Date.now() - BATAS_DIAM_MS;
    for (const s of nsp.sockets.values()) if ((s.data.aktif || 0) < batas) s.disconnect(true);
  }, 60 * 1000);
  sapuDiam.unref?.();

  nsp.on('connection', (socket) => {
    const ip = socket.data.ip;
    perIp.set(ip, (perIp.get(ip) || 0) + 1);
    const data = { id: socket.id, ...socket.data.profil, s: null };
    socket.data.aktif = Date.now();
    pemain.set(socket.id, data);

    const bolehUcap = pembatas(5, 10000);
    const bolehEmote = pembatas(4, 4000);
    const bolehSapa = pembatas(3, 6000);
    let gerakTerakhir = 0;

    socket.emit('selamat', {
      id: socket.id,
      pemain: [...pemain.values()].filter((p) => p.id !== socket.id),
      kendaraan: Object.fromEntries(kendaraan),
    });
    socket.broadcast.emit('masuk', data);

    socket.on('gerak', (m) => {
      const kini = Date.now();
      if (kini - gerakTerakhir < JEDA_GERAK_MS || !m || typeof m !== 'object') return;
      gerakTerakhir = kini;
      socket.data.aktif = kini;
      const x = angka(m.x, BATAS.x0, BATAS.x1);
      const y = angka(m.y, BATAS.y0, BATAS.y1);
      const z = angka(m.z, BATAS.z0, BATAS.z1);
      const rot = angka(m.rot, -1000, 1000);
      if (x === null || y === null || z === null || rot === null) return;
      const s = { x: bulat(x), y: bulat(y), z: bulat(z), rot: bulat(rot), pose: POSE.has(m.pose) ? m.pose : 'jalan', udara: !!m.udara, lari: !!m.lari };
      const k = m.kend;
      if (k && typeof k === 'object' && typeof k.id === 'string' && ID_KENDARAAN.test(k.id)) {
        const kx = angka(k.x, BATAS.x0, BATAS.x1);
        const kz = angka(k.z, BATAS.z0, BATAS.z1);
        const kr = angka(k.rot, -1000, 1000);
        if (kx !== null && kz !== null && kr !== null) {
          s.kend = {
            id: k.id,
            x: bulat(kx),
            z: bulat(kz),
            rot: bulat(kr),
            laju: bulat(angka(k.laju, -30, 30) ?? 0),
            setir: bulat(angka(k.setir, -1, 1) ?? 0),
            pintu: bulat(angka(k.pintu, 0, 1) ?? 0),
            miring: bulat(angka(k.miring, -1, 1) ?? 0),
          };
          kendaraan.set(k.id, { x: s.kend.x, z: s.kend.z, rot: s.kend.rot });
        }
      }
      data.s = s;
      kotor.add(socket.id);
    });

    socket.on('ucap', (m) => {
      const teks = bersihkanTeks(m?.teks, 120);
      if (!teks) return;
      socket.data.aktif = Date.now();
      if (!bolehUcap()) return socket.emit('ditolak', { alasan: 'Tunggu sebentar sebelum mengirim pesan lagi.' });
      nsp.emit('ucap', { id: socket.id, nama: data.nama, teks, waktu: Date.now() });
    });

    socket.on('emote', (m) => {
      if (!EMOTE.has(m?.jenis) || !bolehEmote()) return;
      nsp.emit('emote', { id: socket.id, jenis: m.jenis });
    });

    socket.on('sapa', (m) => {
      const ke = typeof m?.ke === 'string' ? m.ke : '';
      if (!pemain.has(ke) || ke === socket.id || !bolehSapa()) return;
      nsp.to(ke).emit('disapa', { dari: socket.id, nama: data.nama });
      nsp.emit('emote', { id: socket.id, jenis: 'lambai' });
    });

    socket.on('disconnect', () => {
      pemain.delete(socket.id);
      kotor.delete(socket.id);
      const sisa = (perIp.get(ip) || 1) - 1;
      if (sisa > 0) perIp.set(ip, sisa);
      else perIp.delete(ip);
      nsp.emit('keluar', { id: socket.id });
    });
  });

  return nsp;
}

module.exports = { initJelajahSocket };
