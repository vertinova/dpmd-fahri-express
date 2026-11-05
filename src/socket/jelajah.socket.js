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
//   klien → "pindah" {kec}                         masuk dunia kecamatan (kec: nama) / kembali ke kantor (null)
//   klien → "ucap" {teks}                           chat ke semua pemain
//   klien → "emote" {jenis}                         lambai, jempol, tepuk, tawa, hati
//   klien → "sapa" {ke}                             menyapa satu pemain tertentu
//   klien → "klakson"                               bunyi klakson kendaraan yang dikemudikan
//   klien → "gaya" {t,b,c,s,k}                      ganti topi/baju/celana/sepatu/kerudung (indeks lemari)
//   klien → "skor" {level,ikan,kg,jenis,balap,sirkuit,pembangun,bintangW} catatan untuk papan peringkat
//   klien → "hadiah" {ke, n}                         kirim koin (10/20/50) ke tamu lain
//   klien → "peringkat" (ack)                       minta papan peringkat
//   klien → "lomba:daftar" / "lomba:ikan"           Lomba Galatama bersama (lihat jelajahLomba.js)
//   server → "selamat" {id, ruang, pemain[], kendaraan{}}  saat baru masuk
//   server → "masuk" / "keluar" / "posisi" / "ucap" / "emote" / "klakson" / "gaya" / "disapa" / "ditolak" / "lomba"

// Tamu dibagi ke beberapa "ruang" (salinan kantor) berisi maks. 10 orang: siaran
// posisi tumbuh kuadrat terhadap jumlah pemain SATU ruang (10 tamu = 100 kiriman
// per tick), jadi membagi ruang menjaga beban tetap ringan walau tamunya banyak.
// Tamu baru masuk ke ruang terisi yang masih ada tempat, supaya tetap bertemu orang.
const MAKS_PER_RUANG = 10;
const MAKS_RUANG = 6;
const MAKS_TAMU = MAKS_PER_RUANG * MAKS_RUANG;
// Nama kecamatan dari klien hanya dipakai sebagai kunci ruang; ruang tertutup saat kosong.
const NAMA_KEC = /^[\p{L} .'-]{2,40}$/u;
const MAKS_PER_IP = 10;
// Tamu yang diam (tab ditinggal) dikeluarkan supaya kursinya bisa dipakai tamu lain.
const BATAS_DIAM_MS = 10 * 60 * 1000;
const TICK_MS = 100;
const JEDA_GERAK_MS = 80;
const AVATAR = 4; // pilihan avatar per jenis kelamin
const KULIT = 3;
// Lemari gaya tamu: indeks topi/baju/celana/sepatu/kerudung (0 = bawaan); batas atas longgar
// supaya katalog di klien bisa bertambah tanpa mengubah server.
const gayaBersih = (g) => Object.fromEntries(["t", "b", "c", "s", "k"].map((k) => [k, Number.isInteger(g?.[k]) && g[k] >= 0 && g[k] < 32 ? g[k] : 0]));
const EMOTE = new Set(['lambai', 'jempol', 'tepuk', 'tawa', 'hati']);
const POSE = new Set(['jalan', 'duduk', 'mobil', 'motor', 'perahu', 'mancing', 'renang', 'jongkok', 'panjat']);
const ID_KENDARAAN = /^(mobil|motor|perahu):\d{1,2}$/;
// Batas dunia jelajah: kompleks Pemda + koridor Jl. Tegar Beriman sampai McD & Cibinong City
// Mall (lihat BATAS_KAWASAN di dpmd-frontend/src/features/jelajah/scene/kawasanData.js), dilonggarkan.
const BATAS = { x0: -2100, x1: 1200, z0: -1130, z1: 180, y0: -3, y1: 26 }; // y sampai Lt 4 Cibinong City Mall

// Kata kasar yang paling umum disaring dari nama & chat. Bukan filter sempurna,
// sekadar mencegah yang paling mencolok tampil di atas kepala tamu lain.
const KATA_KASAR = /\b(anjing|anjg|bangsat|babi|kontol|memek|ngentot|goblok|tolol|asu|jancok|jancuk|bajingan|fuck|shit)\b/gi;

// ---------- papan peringkat ----------
// Catatan terbaik tiap tamu (per nama) — level, ikan terberat, jumlah jenis ikan, rekor
// balapan motor — disimpan ke berkas supaya bertahan saat server dimulai ulang. Nilainya
// dilaporkan klien (permainan santai, bukan kompetisi berhadiah), tetap dibatasi wajar.
const fs = require('fs');
const { pasangLomba } = require('./jelajahLomba');
const path = require('path');
const BERKAS_PERINGKAT = path.join(__dirname, '../../data/jelajah/peringkat.json');
const MAKS_CATATAN = 2000;
const peringkat = new Map();
try {
  for (const c of JSON.parse(fs.readFileSync(BERKAS_PERINGKAT, 'utf8'))) if (c?.kunci) peringkat.set(c.kunci, c);
} catch {
  /* belum ada berkas */
}
let tundaSimpan = null;
function simpanPeringkat() {
  if (tundaSimpan) return;
  tundaSimpan = setTimeout(() => {
    tundaSimpan = null;
    try {
      fs.mkdirSync(path.dirname(BERKAS_PERINGKAT), { recursive: true });
      fs.writeFileSync(BERKAS_PERINGKAT, JSON.stringify([...peringkat.values()]));
    } catch (e) {
      console.error('[jelajah] gagal menyimpan peringkat:', e.message);
    }
  }, 5000);
}
function ringkasPeringkat() {
  const semua = [...peringkat.values()];
  const atas = (urut, saring = () => true) => semua.filter(saring).sort(urut).slice(0, 10).map(({ kunci, ...c }) => c);
  return {
    level: atas((a, b) => b.level - a.level || b.xp - a.xp),
    ikan: atas((a, b) => b.kg - a.kg, (c) => c.kg > 0),
    jenis: atas((a, b) => b.jenis - a.jenis, (c) => c.jenis > 0),
    balap: atas((a, b) => a.balap - b.balap, (c) => c.balap > 0),
    sirkuit: atas((a, b) => a.sirkuit - b.sirkuit, (c) => c.sirkuit > 0),
    pembangun: atas((a, b) => b.pembangun - a.pembangun || b.bintangW - a.bintangW, (c) => c.pembangun > 0),
  };
}

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
  // ruang → { pemain: Map(socket.id → data publik), kendaraan: Map(id → {x,z,rot}), kotor: Set }
  // Kunci: nomor untuk salinan kantor, "kec:Nama[:n]" untuk dunia kecamatan.
  const daftarRuang = new Map();
  const lomba = pasangLomba(nsp, { pembatas });

  // Ruang terisi yang masih ada tempat; bila semua penuh, buka ruang baru.
  function pilihRuang() {
    let terbaik = null;
    for (const [no, r] of daftarRuang) {
      if (typeof no === 'number' && r.pemain.size < MAKS_PER_RUANG && (!terbaik || r.pemain.size > daftarRuang.get(terbaik).pemain.size)) terbaik = no;
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

  // Ruang kecamatan: teman di kecamatan yang sama masuk ruang yang sama; bila penuh, ruang berikutnya.
  function ruangKecamatan(kec) {
    for (let n = 1; ; n++) {
      const kunci = n === 1 ? `kec:${kec}` : `kec:${kec}:${n}`;
      const r = daftarRuang.get(kunci);
      if (!r) daftarRuang.set(kunci, { pemain: new Map(), kendaraan: new Map(), kotor: new Set() });
      if (!r || r.pemain.size < MAKS_PER_RUANG) return kunci;
    }
  }

  nsp.use((socket, next) => {
    const ip = ipDari(socket);
    if (nsp.sockets.size >= MAKS_TAMU) return next(new Error('penuh'));
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
    socket.data.profil = { nama, jk, avatar, kulit, gaya: gayaBersih(a.gaya) };
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
    let { pemain, kendaraan, kotor } = daftarRuang.get(no);
    let kamar = `ruang:${no}`;
    socket.join(kamar);
    perIp.set(ip, (perIp.get(ip) || 0) + 1);
    const data = { id: socket.id, ...socket.data.profil, s: null };
    socket.data.aktif = Date.now();
    pemain.set(socket.id, data);

    const bolehUcap = pembatas(5, 10000);
    const bolehEmote = pembatas(4, 4000);
    const bolehSapa = pembatas(3, 6000);
    const bolehKlakson = pembatas(5, 3000);
    const bolehGaya = pembatas(6, 10000);
    const bolehSkor = pembatas(6, 30000);
    const bolehHadiah = pembatas(5, 60000);
    const bolehPeringkat = pembatas(10, 30000);
    const bolehPindah = pembatas(10, 30000);
    let gerakTerakhir = 0;

    const sambut = () => {
      socket.emit('selamat', {
        id: socket.id,
        ruang: typeof no === 'number' ? no : null,
        pemain: [...pemain.values()].filter((p) => p.id !== socket.id),
        kendaraan: Object.fromEntries(kendaraan),
        lomba: lomba.publik(),
      });
      socket.to(kamar).emit('masuk', data);
    };
    const tinggalkanRuang = () => {
      pemain.delete(socket.id);
      kotor.delete(socket.id);
      socket.to(kamar).emit('keluar', { id: socket.id });
      socket.leave(kamar);
      // Ruang kosong ditutup; kendaraannya kembali ke posisi awal untuk tamu berikutnya.
      if (!pemain.size) daftarRuang.delete(no);
    };
    sambut();
    lomba.pasang(socket, data);

    socket.on('pindah', (m) => {
      const kec = m?.kec == null ? null : bersihkanTeks(m.kec, 40);
      if ((kec !== null && !NAMA_KEC.test(kec)) || !bolehPindah()) return socket.emit('ditolak', { alasan: 'Tunggu sebentar sebelum berpindah lagi.' });
      socket.data.aktif = Date.now();
      tinggalkanRuang();
      const tujuan = kec === null ? pilihRuang() : ruangKecamatan(kec);
      // semua salinan kantor penuh: lepas koneksi, tamu tetap bisa menjelajah sendiri
      if (tujuan === null) return socket.disconnect(true);
      no = tujuan;
      ({ pemain, kendaraan, kotor } = daftarRuang.get(no));
      kamar = `ruang:${no}`;
      socket.join(kamar);
      data.s = null;
      pemain.set(socket.id, data);
      sambut();
    });

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
      // kemajuan memanjat (0..1) & tinggi pagar (0 = tepi air), supaya tamu lain melihat gerakannya
      if (s.pose === 'panjat') {
        s.pu = bulat(angka(m.pu, 0, 1) ?? 0);
        s.pt = bulat(angka(m.pt, 0, 2) ?? 0);
      }
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
            h: bulat(angka(k.h, 0, 5) ?? 0), // tinggi loncatan motor
            // 0 = pengemudi; 1–3 = penumpang (mobil berempat, motor & perahu berdua)
            kursi: Math.round(angka(k.kursi, 0, 3) ?? 0),
          };
          // Posisi kendaraan untuk tamu yang baru masuk hanya dari pengemudinya.
          if (s.kend.kursi === 0) kendaraan.set(k.id, { x: s.kend.x, z: s.kend.z, rot: s.kend.rot });
        }
      }
      // Pancingan yang sedang berlangsung, supaya tamu lain melihat joran, pelampung,
      // ikan yang melawan, dan ikan hasil tangkapan.
      const pc = m.pc;
      if (pc && typeof pc === 'object') {
        const f = angka(pc.f, 0, 6);
        const px = angka(pc.x, BATAS.x0, BATAS.x1);
        const pz = angka(pc.z, BATAS.z0, BATAS.z1);
        if (f !== null && px !== null && pz !== null) {
          s.pc = {
            f: Math.round(f),
            x: bulat(px),
            z: bulat(pz),
            y: bulat(angka(pc.y, -2, 20) ?? 0),
            a: bulat(angka(pc.a, -1000, 1000) ?? 0),
            t: bulat(angka(pc.t, 0, 2) ?? 0),
            ...(typeof pc.i === 'string' && /^[a-z]{2,12}$/.test(pc.i) ? { i: pc.i, kg: bulat(angka(pc.kg, 0, 1000) ?? 0) } : {}),
          };
        }
      }
      // Keranjang belanja yang sedang ditenteng (isi: id barang, maks. 12), supaya tamu
      // lain melihatnya di tangan.
      if (Array.isArray(m.kr)) s.kr = m.kr.slice(0, 12).filter((id) => typeof id === 'string' && /^[a-z]{2,12}$/.test(id));
      // aktivitas yang terlihat tamu lain (mis. sedang makan mie ayam)
      if (m.ak === 'makan') s.ak = 'makan';
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

    socket.on('skor', (m) => {
      if (!m || typeof m !== 'object' || !bolehSkor()) return;
      const kunci = data.nama.toLowerCase();
      if (!peringkat.has(kunci) && peringkat.size >= MAKS_CATATAN) return;
      const lama = peringkat.get(kunci) || {};
      const kg = angka(m.kg, 0, 1000) ?? 0;
      const balap = angka(m.balap, 15, 3600);
      const sirkuit = angka(m.sirkuit, 60, 7200);
      peringkat.set(kunci, {
        kunci,
        nama: data.nama,
        level: Math.round(angka(m.level, 1, 999) ?? 1),
        xp: Math.round(angka(m.xp, 0, 1e8) ?? 0),
        kg: Math.max(lama.kg || 0, bulat(kg)),
        ikan: kg >= (lama.kg || 0) && typeof m.ikan === 'string' && /^[a-z]{2,12}$/.test(m.ikan) ? m.ikan : lama.ikan || null,
        jenis: Math.round(angka(m.jenis, 0, 200) ?? 0),
        balap: balap ? Math.min(lama.balap || Infinity, bulat(balap)) : lama.balap || null,
        sirkuit: sirkuit ? Math.min(lama.sirkuit || Infinity, bulat(sirkuit)) : lama.sirkuit || null,
        pembangun: Math.round(angka(m.pembangun, 0, 1e5) ?? lama.pembangun ?? 0),
        bintangW: Math.round(angka(m.bintangW, 0, 120) ?? lama.bintangW ?? 0),
        waktu: Date.now(),
      });
      simpanPeringkat();
    });

    socket.on('peringkat', (_m, balas) => {
      if (typeof balas !== 'function' || !bolehPeringkat()) return;
      balas(ringkasPeringkat());
    });

    socket.on('gaya', (m) => {
      if (!bolehGaya()) return;
      data.gaya = gayaBersih(m);
      socket.data.profil.gaya = data.gaya;
      socket.to(kamar).emit('gaya', { id: socket.id, gaya: data.gaya });
    });

    socket.on('klakson', () => {
      if (!bolehKlakson()) return;
      socket.to(kamar).emit('klakson', { id: socket.id });
    });

    // Koin hidup di perangkat masing-masing; pengirim sudah memotong koinnya sendiri,
    // server hanya meneruskan (jumlah dibatasi & dibatasi lajunya).
    socket.on('hadiah', (m) => {
      const ke = typeof m?.ke === 'string' ? m.ke : '';
      if (![10, 20, 50].includes(m?.n) || !pemain.has(ke) || ke === socket.id || !bolehHadiah()) return;
      nsp.to(ke).emit('hadiah', { dari: socket.id, nama: data.nama, n: m.n });
      nsp.to(kamar).emit('emote', { id: socket.id, jenis: 'hati' });
    });

    socket.on('sapa', (m) => {
      const ke = typeof m?.ke === 'string' ? m.ke : '';
      if (!pemain.has(ke) || ke === socket.id || !bolehSapa()) return;
      nsp.to(ke).emit('disapa', { dari: socket.id, nama: data.nama });
      nsp.to(kamar).emit('emote', { id: socket.id, jenis: 'lambai' });
    });

    socket.on('disconnect', () => {
      const sisa = (perIp.get(ip) || 1) - 1;
      if (sisa > 0) perIp.set(ip, sisa);
      else perIp.delete(ip);
      tinggalkanRuang();
    });
  });

  return nsp;
}

module.exports = { initJelajahSocket };
