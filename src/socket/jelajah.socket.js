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
//   klien → "skor" {level,ikan,kg,jenis,pembangun,bintangW,kec} catatan untuk papan peringkat
//   klien → "lapor" {ke}                            laporkan tamu; cukup banyak laporan = chat dibatasi sementara
//   klien → "gotong"                                satu pesanan kabupaten selesai (target bersama harian)
//   klien → "hadiah" {ke, n}                         kirim koin (10/20/50) ke tamu lain
//   klien → "peringkat" (ack)                       minta papan peringkat
//   klien → "lomba:daftar" / "lomba:ikan"           Lomba Galatama bersama (lihat jelajahLomba.js)
//   klien → "basket:*"                              Lomba Basket antar-tamu (lihat jelajahBasket.js)
//   server → "selamat" {id, ruang, pemain[], kendaraan{}}  saat baru masuk
//   server → "masuk" / "keluar" / "posisi" / "ucap" / "emote" / "klakson" / "gaya" / "disapa" / "ditolak" / "lomba" / "gotong" / "basket"

// Tamu dibagi ke beberapa "ruang" (salinan kantor) berisi maks. 10 orang: siaran
// posisi tumbuh kuadrat terhadap jumlah pemain SATU ruang (10 tamu = 100 kiriman
// per tick), jadi membagi ruang menjaga beban tetap ringan walau tamunya banyak.
// Tamu baru masuk ke ruang terisi yang masih ada tempat, supaya tetap bertemu orang.
const MAKS_PER_RUANG = 10;
const MAKS_RUANG = 6;
const MAKS_TAMU = MAKS_PER_RUANG * MAKS_RUANG;
// Nama kecamatan dari klien hanya dipakai sebagai kunci ruang; ruang tertutup saat kosong.
const NAMA_KEC = /^[\p{L} .'-]{2,40}$/u;
// Longgar untuk satu Wi-Fi kantor atau balai desa, tetap jauh di bawah MAKS_TAMU.
const MAKS_PER_IP = 20;
// Laporan dari sekian jaringan berbeda membatasi chat terlapor untuk sementara.
const LAPOR_UNTUK_BISU = 3;
const BISU_MS = 30 * 60 * 1000;
const MAKS_LAPORAN_BYTE = 5 * 1024 * 1024;
const TARGET_GOTONG = 9; // tiga tamu menyelesaikan tiga pesanan hariannya
// Tamu yang diam (tab ditinggal) dikeluarkan supaya kursinya bisa dipakai tamu lain.
const BATAS_DIAM_MS = 10 * 60 * 1000;
const TICK_MS = 100;
const JEDA_GERAK_MS = 80;
const AVATAR = 4; // pilihan avatar per jenis kelamin
const KULIT = 3;
// Lemari gaya tamu: indeks topi/baju/celana/sepatu/kerudung (0 = bawaan); batas atas longgar
// supaya katalog di klien bisa bertambah tanpa mengubah server.
const gayaBersih = (g) => Object.fromEntries(["t", "b", "c", "s", "k"].map((k) => [k, Number.isInteger(g?.[k]) && g[k] >= 0 && g[k] < 64 ? g[k] : 0]));
const EMOTE = new Set(['lambai', 'jempol', 'tepuk', 'tawa', 'hati']);
const POSE = new Set(['jalan', 'duduk', 'mobil', 'motor', 'perahu', 'mancing', 'renang', 'jongkok', 'panjat']);
const ID_KENDARAAN = /^(mobil|motor|perahu):\d{1,2}$/;
// Batas dunia jelajah: kompleks Pemda + koridor Jl. Tegar Beriman sampai McD & Cibinong City
// Mall (lihat BATAS_KAWASAN di dpmd-frontend/src/features/jelajah/scene/kawasanData.js), dilonggarkan.
const BATAS = { x0: -2100, x1: 1200, z0: -1130, z1: 180, y0: -3, y1: 26 }; // y sampai Lt 4 Cibinong City Mall

// ---------- papan peringkat ----------
// Catatan terbaik tiap tamu (per kunci rahasia perangkat) — level, ikan terberat, jumlah jenis
// ikan, kemajuan BUMDes — disimpan ke berkas supaya bertahan saat server dimulai ulang. Nilainya
// dilaporkan klien (permainan santai, bukan kompetisi berhadiah), tetap dibatasi wajar.
const crypto = require('crypto');
const fs = require('fs');
const { pasangLomba } = require('./jelajahLomba');
const { pasangBasket } = require('./jelajahBasket');
const { ipKlien, kunciNama, namaTerlarang, sensor } = require('./jelajahSaring');
const path = require('path');
const DIR_DATA = process.env.JELAJAH_DATA_DIR || path.join(__dirname, '../../data/jelajah');
const BERKAS_PERINGKAT = path.join(DIR_DATA, 'peringkat.json');
const BERKAS_LAPORAN = path.join(DIR_DATA, 'laporan.jsonl');
const MAKS_CATATAN = 2000;
const peringkat = new Map();
try {
  for (const c of JSON.parse(fs.readFileSync(BERKAS_PERINGKAT, 'utf8'))) if (c?.kunci) peringkat.set(c.kunci, c);
} catch (e) {
  if (e.code !== 'ENOENT') {
    // berkas rusak jangan tertimpa kosong: simpan salinannya untuk dipulihkan manual
    console.error('[jelajah] berkas peringkat rusak:', e.message);
    try {
      fs.renameSync(BERKAS_PERINGKAT, `${BERKAS_PERINGKAT}.rusak-${Date.now()}`);
    } catch {
      /* tidak bisa dipindah: tetap jalan dengan peringkat kosong */
    }
  }
}
let tundaSimpan = null;
function simpanPeringkat() {
  if (tundaSimpan) return;
  tundaSimpan = setTimeout(() => {
    tundaSimpan = null;
    try {
      fs.mkdirSync(path.dirname(BERKAS_PERINGKAT), { recursive: true });
      // tulis lalu ganti nama: server mati di tengah penulisan tidak merusak berkas lama
      fs.writeFileSync(`${BERKAS_PERINGKAT}.tmp`, JSON.stringify([...peringkat.values()]));
      fs.renameSync(`${BERKAS_PERINGKAT}.tmp`, BERKAS_PERINGKAT);
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
    pembangun: atas((a, b) => b.pembangun - a.pembangun || b.bintangW - a.bintangW, (c) => c.pembangun > 0),
    kecamatan: ringkasKecamatan(semua),
  };
}

// Jumlah tingkat BUMDes yang dibangun semua tamu di tiap kecamatan.
function ringkasKecamatan(semua) {
  const total = new Map();
  for (const c of semua) {
    for (const [nama, lv] of Object.entries(c.kec || {})) {
      const r = total.get(nama) || { nama, nilai: 0, pemain: 0 };
      r.nilai += lv;
      r.pemain += 1;
      total.set(nama, r);
    }
  }
  return [...total.values()].sort((a, b) => b.nilai - a.nilai || b.pemain - a.pemain).slice(0, 10);
}

// Nama pegawai (nama tamu tidak boleh sama) dan kecamatan (papan peringkat hanya memuat yang
// nyata, karena nama kecamatan datang dari klien). Gagal memuat tidak menghentikan jelajah.
const normalKec = (s) => String(s).toLowerCase().replace(/[^a-z]/g, '');
const rujukan = { pegawai: new Set(), kecamatan: new Map() };
async function muatRujukan() {
  try {
    const db = require('../config/database');
    const [pegawai] = await db.query('SELECT nama_pegawai AS nama FROM pegawai');
    const [kecamatan] = await db.query('SELECT nama FROM kecamatans');
    rujukan.pegawai = new Set(pegawai.flatMap(({ nama }) => {
      const k = kunciNama(nama || '');
      return k ? [k, k.slice(0, 24).trim()] : []; // nama tamu dipotong 24 huruf
    }));
    rujukan.kecamatan = new Map(kecamatan.map(({ nama }) => [normalKec(nama), nama]));
  } catch (e) {
    console.error('[jelajah] gagal memuat rujukan:', e.message);
  }
}

function kecBersih(kec, lama) {
  if (!kec || typeof kec !== 'object') return lama || {};
  const hasil = {};
  for (const [nama, lv] of Object.entries(kec).slice(0, 60)) {
    const resmi = rujukan.kecamatan.get(normalKec(nama));
    if (resmi && Number.isInteger(lv) && lv >= 1 && lv <= 4) hasil[resmi] = lv;
  }
  return Object.keys(hasil).length ? hasil : lama || {};
}

// IP tidak ditulis mentah ke berkas: sidik jarinya cukup untuk mengenali pelaku yang sama.
const sidikIp = (ip) => crypto.createHash('sha256').update(`${process.env.JWT_SECRET || ''}:${ip}`).digest('hex').slice(0, 16);

function catatLaporan(isi) {
  fs.stat(BERKAS_LAPORAN, (_e, st) => {
    if ((st?.size || 0) >= MAKS_LAPORAN_BYTE) return;
    fs.mkdir(DIR_DATA, { recursive: true }, () => {
      fs.appendFile(BERKAS_LAPORAN, `${JSON.stringify(isi)}\n`, (e) => e && console.error('[jelajah] gagal mencatat laporan:', e.message));
    });
  });
}

const hariIni = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' });
// shortcut: hitungan gotong royong hanya di memori, ulang dari nol saat server dimulai ulang; simpan ke berkas bila deploy siang hari mengganggu tamu
const gotong = { tanggal: '', jumlah: 0, target: TARGET_GOTONG };
function gotongKini() {
  const tanggal = hariIni();
  if (gotong.tanggal !== tanggal) Object.assign(gotong, { tanggal, jumlah: 0 });
  return { ...gotong };
}

function rapikanTeks(nilai, maks) {
  if (typeof nilai !== 'string') return '';
  return nilai
    .normalize('NFC')
    .replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2066-\u2069]/g, '')
    .replace(/[<>]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maks);
}
const bersihkanTeks = (nilai, maks) => sensor(rapikanTeks(nilai, maks));

const angka = (v, min, max) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : null);
const bulat = (v, d = 100) => Math.round(v * d) / d;

const ipDari = (socket) => ipKlien(socket.handshake.headers['x-forwarded-for'], socket.handshake.address);

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

function initJelajahSocket(io, { tanpaDb = false, basketDaftarMs } = {}) {
  const nsp = io.of('/jelajah');
  const perIp = new Map();
  const bisu = new Map(); // ip → kapan pembatasan chat berakhir
  if (!tanpaDb) {
    muatRujukan();
    setInterval(muatRujukan, 60 * 60 * 1000).unref?.();
  }
  // ruang → { pemain: Map(socket.id → data publik), kendaraan: Map(id → {x,z,rot}), kotor: Set }
  // Kunci: nomor untuk salinan kantor, "kec:Nama[:n]" untuk dunia kecamatan.
  const daftarRuang = new Map();
  const lomba = pasangLomba(nsp, { pembatas });
  const basket = pasangBasket(nsp, { pembatas, daftarMs: basketDaftarMs });

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
    const mentah = rapikanTeks(a.nama, 24);
    socket.data.namaDitolak = !!mentah && namaTerlarang(mentah, rujukan.pegawai);
    const nama = socket.data.namaDitolak ? 'Tamu' : mentah || 'Tamu';
    socket.data.kunci = typeof a.kunci === 'string' && /^[a-z0-9]{16,40}$/.test(a.kunci) ? `k:${crypto.createHash('sha256').update(a.kunci).digest('hex').slice(0, 32)}` : null;
    const jk = a.jk === 'P' ? 'P' : 'L';
    const avatar = Number.isInteger(a.avatar) && a.avatar >= 0 && a.avatar < AVATAR ? a.avatar : 0;
    const kulit = Number.isInteger(a.kulit) && a.kulit >= 0 && a.kulit < KULIT ? a.kulit : 0;
    socket.data.ip = ip;
    // sedang ikut lomba basket: sambung ulang kembali ke lapangannya
    const ruangLaga = basket.ruangUntuk(socket.data.kunci);
    socket.data.ruang = ruangLaga !== null && daftarRuang.has(ruangLaga) && daftarRuang.get(ruangLaga).pemain.size < MAKS_PER_RUANG ? ruangLaga : no;
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
    for (const [ip, sampai] of bisu) if (sampai < Date.now()) bisu.delete(ip);
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
    const bolehLapor = pembatas(3, 60000);
    const bolehGotong = pembatas(3, 10 * 60 * 1000);
    let gerakTerakhir = 0;

    const sambut = () => {
      socket.emit('selamat', {
        id: socket.id,
        ruang: typeof no === 'number' ? no : null,
        pemain: [...pemain.values()].filter((p) => p.id !== socket.id),
        kendaraan: Object.fromEntries(kendaraan),
        lomba: lomba.publik(),
        basket: basket.publikRuang(no),
        nama: data.nama,
        namaDitolak: socket.data.namaDitolak,
        gotong: gotongKini(),
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
    basket.sambung(socket, data, no);
    sambut();
    lomba.pasang(socket, data);
    basket.pasang(socket, data, () => no);

    socket.on('pindah', (m) => {
      const kec = m?.kec == null ? null : bersihkanTeks(m.kec, 40);
      if ((kec !== null && !NAMA_KEC.test(kec)) || !bolehPindah()) return socket.emit('ditolak', { alasan: 'Tunggu sebentar sebelum berpindah lagi.' });
      socket.data.aktif = Date.now();
      basket.keluar(socket);
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
      if ((bisu.get(ip) || 0) > Date.now()) return socket.emit('ditolak', { alasan: 'Chat Anda dibatasi sementara karena dilaporkan tamu lain.' });
      if (!bolehUcap()) return socket.emit('ditolak', { alasan: 'Tunggu sebentar sebelum mengirim pesan lagi.' });
      socket.data.ucapan = [...(socket.data.ucapan || []), { teks, waktu: Date.now() }].slice(-5);
      nsp.to(kamar).emit('ucap', { id: socket.id, nama: data.nama, teks, waktu: Date.now() });
    });

    socket.on('lapor', (m) => {
      const ke = typeof m?.ke === 'string' ? m.ke : '';
      const terlapor = nsp.sockets.get(ke);
      if (!terlapor || !pemain.has(ke) || ke === socket.id || !bolehLapor()) return;
      catatLaporan({
        waktu: new Date().toISOString(),
        ruang: no,
        pelapor: sidikIp(ip),
        terlapor: sidikIp(terlapor.data.ip),
        nama: terlapor.data.profil.nama,
        ucapan: terlapor.data.ucapan || [],
      });
      if (ip === terlapor.data.ip) return; // satu jaringan tidak bisa membisukan dirinya sendiri
      const pelapor = (terlapor.data.pelapor ||= new Set());
      pelapor.add(ip);
      if (pelapor.size >= LAPOR_UNTUK_BISU) {
        bisu.set(terlapor.data.ip, Date.now() + BISU_MS);
        pelapor.clear();
      }
    });

    socket.on('gotong', () => {
      if (!bolehGotong()) return;
      gotongKini();
      gotong.jumlah += 1;
      nsp.emit('gotong', { ...gotong });
    });

    socket.on('emote', (m) => {
      if (!EMOTE.has(m?.jenis) || !bolehEmote()) return;
      nsp.to(kamar).emit('emote', { id: socket.id, jenis: m.jenis });
    });

    socket.on('skor', (m) => {
      if (!m || typeof m !== 'object' || !bolehSkor()) return;
      const kunciLama = data.nama.toLowerCase();
      const kunci = socket.data.kunci ?? kunciLama;
      // catatan era kunci-nama diambil alih sekali oleh perangkat pertama yang memakai nama itu
      if (kunci !== kunciLama && !peringkat.has(kunci) && peringkat.has(kunciLama)) {
        peringkat.set(kunci, peringkat.get(kunciLama));
        peringkat.delete(kunciLama);
      }
      if (!peringkat.has(kunci) && peringkat.size >= MAKS_CATATAN) return;
      const lama = peringkat.get(kunci) || {};
      const kg = angka(m.kg, 0, 1000) ?? 0;
      peringkat.set(kunci, {
        kunci,
        nama: data.nama,
        level: Math.max(lama.level || 1, Math.round(angka(m.level, 1, 999) ?? 1)),
        xp: Math.max(lama.xp || 0, Math.round(angka(m.xp, 0, 1e8) ?? 0)),
        kg: Math.max(lama.kg || 0, bulat(kg)),
        ikan: kg >= (lama.kg || 0) && typeof m.ikan === 'string' && /^[a-z]{2,12}$/.test(m.ikan) ? m.ikan : lama.ikan || null,
        jenis: Math.max(lama.jenis || 0, Math.round(angka(m.jenis, 0, 200) ?? 0)),
        pembangun: Math.max(lama.pembangun || 0, Math.round(angka(m.pembangun, 0, 1e5) ?? 0)),
        bintangW: Math.max(lama.bintangW || 0, Math.round(angka(m.bintangW, 0, 120) ?? 0)),
        kec: kecBersih(m.kec, lama.kec),
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

module.exports = { initJelajahSocket, rujukan };
