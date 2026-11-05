// Lomba Galatama bersama di Kolam Monster Jelajah 3D (namespace "/jelajah").
//
// Satu lomba untuk SEMUA tamu yang terhubung (lintas ruang), supaya peserta yang
// koneksinya putus lalu masuk ke ruang lain tetap ikut lomba yang sama. Peserta
// dikenali lewat `kunci` rahasia buatan klien (bukan id socket), sehingga tangkapan
// setelah tersambung ulang tetap tercatat; tamu lain hanya melihat `pid` publik.
//
// Format galatama: pendaftaran 30 dtk → sesi 5 menit → juara = ikan terberat (babon),
// bila sama total berat. Tamu yang daftar sendirian ditemani pemancing tetap kolam (NPC)
// sampai 6 peserta; bila ada 2 tamu atau lebih, lombanya tanpa NPC.
// Koin hidup di perangkat tamu: biaya & hadiah dipotong/ditambah oleh klien, server
// hanya mencatat dan mengumumkan hasil (permainan santai, tangkapan tetap dibatasi wajar).
//
//   klien → "lomba:daftar" {kunci} (ack {ok, pid, alasan})
//   klien → "lomba:ikan"   {kunci, i, kg}
//   server → "lomba" {id, fase: daftar|jalan|selesai, sisa, peserta[], kabar[]} | null

const crypto = require('crypto');

const DAFTAR_MS = 30 * 1000;
const SESI_MS = 5 * 60 * 1000;
const SIMPAN_HASIL_MS = 90 * 1000;
const ISI_SAMPAI = 6;
const MAKS_PESERTA = 30;
const JEDA_IKAN_MS = 6000;

// Penghuni Kolam Monster (kelas 3 = Monster, 4 = Legenda): [kelas, kg min, kg maks].
// Sama dengan pilihIkanKolam di dpmd-frontend/src/features/jelajah/pancing.js.
const IKAN_KOLAM = {
  arapaima: [3, 40, 165],
  siluman: [3, 30, 95],
  belut: [3, 15, 45],
  gar: [3, 40, 130],
  sidat: [3, 10, 25],
  dewa: [4, 10, 40],
  arwana: [4, 8, 28],
  goliath: [3, 20, 70],
  piraiba: [3, 50, 140],
  mekong: [4, 120, 300],
  beluga: [4, 150, 400],
};
const PER_KELAS = { 3: [], 4: [] };
for (const [id, [k]] of Object.entries(IKAN_KOLAM)) PER_KELAS[k].push(id);

const LAWAN = [
  { nama: 'Pak Darto', ikon: '🧔', mahir: 1.05, laju: 48 },
  { nama: 'Teh Euis', ikon: '👩', mahir: 0.95, laju: 55 },
  { nama: 'Kang Asep', ikon: '🧢', mahir: 1.0, laju: 42 },
  { nama: 'Mang Ujang', ikon: '👴', mahir: 1.12, laju: 70 },
  { nama: 'Rina', ikon: '👧', mahir: 0.88, laju: 50 },
];

const bulat = (v) => Math.round(v * 100) / 100;
const jedaLawan = (l) => Math.max(15000, -Math.log(1 - Math.random()) * l.laju * 1000);

function ikanLawan(mahir) {
  const hoki = 1 + (mahir - 1) * 3;
  const kelas = Math.random() * (78 + 22 * Math.sqrt(hoki)) < 78 ? 3 : 4;
  const calon = PER_KELAS[kelas];
  const id = calon[Math.floor(Math.random() * calon.length)];
  const [, min, maks] = IKAN_KOLAM[id];
  const kg = min + (maks - min) * Math.pow(Math.random(), 1.5);
  return { id, kg: bulat(Math.min(maks, kg * mahir)) };
}

const urutkan = (daftar) => [...daftar].sort((a, b) => b.babon - a.babon || b.total - a.total);

function pasangLomba(nsp, { pembatas }) {
  let lomba = null;

  const publik = () =>
    lomba && {
      id: lomba.id,
      fase: lomba.fase,
      sisa: Math.max(0, (lomba.fase === 'daftar' ? lomba.tutup : lomba.fase === 'jalan' ? lomba.selesai : lomba.hapus) - Date.now()),
      peserta: urutkan(lomba.peserta.values()).map(({ pid, nama, ikon, npc, ikan, total, babon, babonIkan }) => ({ pid, nama, ikon, npc, ikan, total, babon, babonIkan })),
      kabar: lomba.kabar,
    };
  const siarkan = () => nsp.emit('lomba', publik());

  const catat = (p, id, kg) => {
    p.ikan += 1;
    p.total = bulat(p.total + kg);
    if (kg > p.babon) {
      p.babon = kg;
      p.babonIkan = id;
      lomba.kabar = [{ pid: p.pid, i: id, kg, t: Date.now() }, ...lomba.kabar].slice(0, 4);
      return true;
    }
    return false;
  };

  function mulai() {
    const kini = Date.now();
    const manusia = lomba.peserta.size;
    // Ada teman terdaftar = lomba antar-tamu murni; NPC hanya menemani tamu yang daftar sendirian.
    LAWAN.slice(0, manusia > 1 ? 0 : ISI_SAMPAI - manusia).forEach((l, i) => {
      lomba.peserta.set(`npc:${i}`, { pid: `npc${i}`, nama: l.nama, ikon: l.ikon, npc: true, l, ikan: 0, total: 0, babon: 0, babonIkan: null, berikut: kini + jedaLawan(l) });
    });
    lomba.fase = 'jalan';
    lomba.selesai = kini + SESI_MS;
  }

  const jam = setInterval(() => {
    if (!lomba) return;
    const kini = Date.now();
    if (lomba.fase === 'daftar' && kini >= lomba.tutup) {
      mulai();
      return siarkan();
    }
    if (lomba.fase === 'jalan') {
      let berubah = false;
      for (const p of lomba.peserta.values()) {
        if (!p.npc) continue;
        while (p.berikut <= Math.min(kini, lomba.selesai)) {
          const { id, kg } = ikanLawan(p.l.mahir);
          catat(p, id, kg);
          p.berikut += jedaLawan(p.l);
          berubah = true;
        }
      }
      if (kini >= lomba.selesai) {
        lomba.fase = 'selesai';
        lomba.hapus = kini + SIMPAN_HASIL_MS;
        berubah = true;
      }
      if (berubah) siarkan();
      return;
    }
    if (lomba.fase === 'selesai' && kini >= lomba.hapus) {
      lomba = null;
      siarkan();
    }
  }, 1000);
  jam.unref?.();

  const kunciSah = (k) => typeof k === 'string' && /^[a-z0-9]{16,40}$/.test(k);

  function pasang(socket, data) {
    const bolehDaftar = pembatas(4, 10000);
    const bolehIkan = pembatas(6, 30000);

    socket.on('lomba:daftar', (m, balas) => {
      if (typeof balas !== 'function') return;
      if (!kunciSah(m?.kunci) || !bolehDaftar()) return balas({ ok: false, alasan: 'Coba lagi sebentar lagi' });
      if (lomba?.peserta.has(m.kunci)) return balas({ ok: true, id: lomba.id, pid: lomba.peserta.get(m.kunci).pid, lama: true });
      if (lomba?.fase === 'jalan') return balas({ ok: false, alasan: 'Lomba sedang berlangsung — tunggu sesi berikutnya' });
      const baru = !lomba || lomba.fase === 'selesai';
      if (baru) lomba = { id: crypto.randomBytes(6).toString('hex'), fase: 'daftar', tutup: Date.now() + DAFTAR_MS, peserta: new Map(), kabar: [], pembuka: data.nama };
      if (lomba.peserta.size >= MAKS_PESERTA) return balas({ ok: false, alasan: 'Peserta lomba sudah penuh' });
      const pid = crypto.randomBytes(4).toString('hex');
      lomba.peserta.set(m.kunci, { pid, nama: data.nama, ikon: '🎣', npc: false, ikan: 0, total: 0, babon: 0, babonIkan: null, terakhir: 0 });
      balas({ ok: true, id: lomba.id, pid, baru });
      siarkan();
    });

    socket.on('lomba:ikan', (m) => {
      if (!lomba || lomba.fase !== 'jalan' || !kunciSah(m?.kunci) || !bolehIkan()) return;
      const p = lomba.peserta.get(m.kunci);
      const spesies = IKAN_KOLAM[m.i];
      const kg = typeof m.kg === 'number' && Number.isFinite(m.kg) ? bulat(m.kg) : null;
      const kini = Date.now();
      if (!p || p.npc || !spesies || kg === null || kg < spesies[1] * 0.9 || kg > spesies[2] || kini - p.terakhir < JEDA_IKAN_MS) return;
      p.terakhir = kini;
      p.nama = data.nama;
      catat(p, m.i, kg);
      siarkan();
    });
  }

  return { publik, pasang, hentikan: () => clearInterval(jam) };
}

module.exports = { pasangLomba, IKAN_KOLAM };
