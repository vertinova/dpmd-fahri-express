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
//   server → "selamat" {id, ruang, pemain[], kendaraan{}}  saat baru masuk
//   server → "masuk" / "keluar" / "posisi" / "ucap" / "emote" / "disapa" / "ditolak"

// Tamu dibagi ke beberapa "ruang" (salinan kantor) berisi maks. 10 orang: siaran
// posisi tumbuh kuadrat terhadap jumlah pemain SATU ruang (10 tamu = 100 kiriman
// per tick), jadi membagi ruang menjaga beban tetap ringan walau tamunya banyak.
// Tamu baru masuk ke ruang terisi yang masih ada tempat, supaya tetap bertemu orang.
const MAKS_PER_RUANG = 10;
const MAKS_RUANG = 6;
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
// Batas dunia jelajah: kantor + kawasan Pemda di sekitarnya (lihat BATAS_KAWASAN di
// dpmd-frontend/src/features/jelajah/scene/kawasanData.js), sedikit dilonggarkan.
const BATAS = { x0: -200, x1: 650, z0: -730, z1: 180, y0: -1, y1: 9 };

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
  const perIp = new Map();
  // nomor ruang → { pemain: Map(socket.id → data publik), kendaraan: Map(id → {x,z,rot}), kotor: Set }
  const daftarRuang = new Map();

  // Ruang terisi yang masih ada tempat; bila semua penuh, buka ruang baru.
  function pilihRuang() {
    let terbaik = null;
    for (const [no, r] of daftarRuang) {
      if (r.pemain.size < MAKS_PER_RUANG && (!terbaik || r.pemain.size > daftarRuang.get(terbaik).pemain.size)) terbaik = no;
    }
    if (terbaik !== null) return terbaik;
    for (let no = 1; no <= MAKS_RUANG; no++) {
      if (!daftarRuang.has(no)) {
        daftarRuang.set(no, { pemain: new Map(), kendaraan: new Map(), kotor: new Set() });
        return no;
      }
    }
    return null;
  }

  nsp.use((socket, next) => {
    const ip = ipDari(socket);
    const no = pilihRuang();
    if (no === null) return next(new Error('penuh'));
    if ((perIp.get(ip) || 0) >= MAKS_PER_IP) return next(new Error('terlalu-banyak'));
    const a = socket.handshake.auth || {};
    const nama = bersihkanTeks(a.nama, 24) || 'Tamu';
    const jk = a.jk === 'P' ? 'P' : 'L';
    const avatar = Number.isInteger(a.avatar) && a.avatar >= 0 && a.avatar < AVATAR ? a.avatar : 0;
    const kulit = Number.isInteger(a.kulit) && a.kulit >= 0 && a.kulit < KULIT ? a.kulit : 0;
    socket.data.ip = ip;
    socket.data.ruang = no;
    socket.data.profil = { nama, jk, avatar, kulit };
    next();
  });

  // Satu siaran gabungan per tick, hanya untuk pemain yang bergerak.
  const tick = setInterval(() => {
    for (const [no, { pemain, kotor }] of daftarRuang) {
      if (!kotor.size) continue;
      const daftar = [];
      for (const id of kotor) {
        const p = pemain.get(id);
        if (p) daftar.push({ id, s: p.s });
      }
      kotor.clear();
      if (daftar.length) nsp.to(`ruang:${no}`).volatile.emit('posisi', daftar);
    }
  }, TICK_MS);
  tick.unref?.();

  const sapuDiam = setInterval(() => {
    const batas = Date.now() - BATAS_DIAM_MS;
    for (const s of nsp.sockets.values()) if ((s.data.aktif || 0) < batas) s.disconnect(true);
  }, 60 * 1000);
  sapuDiam.unref?.();

  nsp.on('connection', (socket) => {
    const ip = socket.data.ip;
    // Ruang bisa terisi tamu lain di sela middleware & connection: pilih ulang bila perlu.
    let no = socket.data.ruang;
    if (!daftarRuang.has(no) || daftarRuang.get(no).pemain.size >= MAKS_PER_RUANG) no = pilihRuang();
    if (no === null) return socket.disconnect(true);
    const { pemain, kendaraan, kotor } = daftarRuang.get(no);
    const kamar = `ruang:${no}`;
    socket.join(kamar);
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
      ruang: no,
      pemain: [...pemain.values()].filter((p) => p.id !== socket.id),
      kendaraan: Object.fromEntries(kendaraan),
    });
    socket.to(kamar).emit('masuk', data);

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
      nsp.to(kamar).emit('ucap', { id: socket.id, nama: data.nama, teks, waktu: Date.now() });
    });

    socket.on('emote', (m) => {
      if (!EMOTE.has(m?.jenis) || !bolehEmote()) return;
      nsp.to(kamar).emit('emote', { id: socket.id, jenis: m.jenis });
    });

    socket.on('sapa', (m) => {
      const ke = typeof m?.ke === 'string' ? m.ke : '';
      if (!pemain.has(ke) || ke === socket.id || !bolehSapa()) return;
      nsp.to(ke).emit('disapa', { dari: socket.id, nama: data.nama });
      nsp.to(kamar).emit('emote', { id: socket.id, jenis: 'lambai' });
    });

    socket.on('disconnect', () => {
      pemain.delete(socket.id);
      kotor.delete(socket.id);
      const sisa = (perIp.get(ip) || 1) - 1;
      if (sisa > 0) perIp.set(ip, sisa);
      else perIp.delete(ip);
      nsp.to(kamar).emit('keluar', { id: socket.id });
      // Ruang kosong ditutup; kendaraannya kembali ke posisi awal untuk tamu berikutnya.
      if (!pemain.size) daftarRuang.delete(no);
    });
  });

  return nsp;
}

module.exports = { initJelajahSocket };
