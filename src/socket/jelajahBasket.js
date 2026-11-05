// Lomba Basket antar-tamu di lapangan Taman Warga, satu laga per ruang (namespace "/jelajah").
//
// Format seperti Lomba Galatama: pendaftaran 30 dtk → laga → hasil. Dua tamu atau lebih bertanding
// tanpa NPC, sampai 3 lawan 3 (bagi rata, peserta ganjil berat sebelah satu orang). Tamu yang
// daftar sendirian dikembalikan ke klien untuk bermain lawan warga (fase "sendiri").
//
// Server memegang aturan & hasil acak; klien hanya menggerakkan badannya sendiri (posisi dibaca dari
// "gerak") dan memutar lintasan bola yang dikirim server, sehingga bola tetap mulus di tiap layar.
//
//   klien → "basket:daftar" (ack {ok, pid, alasan}) / "basket:keluar"
//   klien → "basket:tembak" {isi,x,z} / "basket:oper" {ke} / "basket:rebut" / "basket:kecoh" / "basket:bidik" {on}
//   server → "basket" {id, fase: daftar|mulai|main|skor|selesai|sendiri, sisa, jam, skor, pemegang, sisi, bidik, peserta[], bola, ev} | null

const crypto = require('crypto');

const DAFTAR_MS = 30 * 1000;
const MULAI_MS = 3000;
const LAGA_MS = 4 * 60 * 1000;
const SKOR_MENANG = 21;
const JAM_SERANG_MS = 14 * 1000;
const JEDA_SKOR_MS = 1500;
const SIMPAN_HASIL_MS = 60 * 1000;
const MAKS_PESERTA = 6;
const TENGGANG_PUTUS_MS = 20 * 1000; // jaringan kantor sering putus sesaat: kursi ditahan sebentar
const TICK_MS = 50;
const DENYUT_MS = 2000;
const TUNDA_LEPAS = 0.1; // bola lepas dari tangan sesaat setelah pesan, menutupi jeda jaringan
const JEDA_MASUK = 0.18; // angka dihitung saat bola melewati jaring

// --- sama dengan dpmd-frontend/src/features/jelajah/basket.js ---
const G = 9.8;
const R_BOLA = 0.12;
const LANTAI = 0.07 + R_BOLA;
const TINGGI_LEPAS = 2.35;
const JARAK_TIGA = 6;
const JARAK_DEKAT = 1.8;
const LAPANGAN = { x0: -64, x1: -52, z0: 10.5, z1: 27.5 };
const RIM = [
  { x: -58, z: 11.45, y: 3.05, papanZ: 11.13, arah: 1 },
  { x: -58, z: 26.55, y: 3.05, papanZ: 26.87, arah: -1 },
];
const jepit = (v, a, b) => Math.max(a, Math.min(b, v));
const acak = (a, b) => a + Math.random() * (b - a);
const kontesDari = (jarak) => jepit(1 - jarak / 1.6, 0, 1);
const perfectDari = (isi) => isi >= 0.7 && isi <= 0.88;
function peluangTembak(isi, jarak, kontes) {
  if (perfectDari(isi)) return jepit(0.97 - Math.max(0, jarak - 6) * 0.045, 0.6, 0.97) * (1 - kontes * 0.3);
  const mutu = 1 - Math.min(1, Math.abs(isi - 0.79) / 0.55);
  return (0.1 + 0.5 * mutu) * jepit(1.1 - jarak * 0.075, 0.25, 1) * (1 - kontes * 0.6);
}
const peluangDekat = (kontes) => 0.92 * (1 - kontes * 0.5);
const kecepatanTiba = (a, b, T) => ({ vx: (b[0] - a[0]) / T, vy: (b[1] - a[1] + 0.5 * G * T * T) / T - G * T, vz: (b[2] - a[2]) / T });

// Rangkaian titik & lama tiap ruas parabola; klien memutarnya apa adanya.
function rencanaTembakan(p, rim, o) {
  const d = Math.hypot(rim.x - p.x, rim.z - p.z);
  const asal = [p.x, TINGGI_LEPAS, p.z];
  const pusat = [rim.x, rim.y, rim.z];
  const T = 0.85 + d * 0.045;
  const kePemain = Math.atan2(p.x - rim.x, p.z - rim.z);
  const tepi = (r, a) => {
    const t = [rim.x + Math.sin(a) * r, rim.y, rim.z + Math.cos(a) * r];
    if ((t[2] - rim.papanZ) * rim.arah < 0.15) t[2] = rim.papanZ + rim.arah * 0.15;
    return t;
  };
  const papan = (x, y) => [x, y, rim.papanZ + rim.arah * (R_BOLA + 0.03)];
  if (o.dunk) return { titik: [[p.x, 2.75, p.z], [rim.x, rim.y + 0.18, rim.z], pusat], T: [0.24, 0.07], gaya: 'dunk', pantul: null };
  if (o.masuk) {
    const tembusPapan = papan(rim.x + (p.x - rim.x) * 0.18, rim.y + 0.42);
    if (o.dekat) return { titik: [asal, tembusPapan, pusat], T: [0.42, 0.2], gaya: 'papan', pantul: null };
    const r = Math.random();
    if (!o.perfect && r < 0.35) return { titik: [asal, tepi(0.21, kePemain + acak(-0.7, 0.7)), pusat], T: [T, 0.34], gaya: 'bibir', pantul: null };
    if (!o.perfect && r < 0.55 && d < 5) return { titik: [asal, tembusPapan, pusat], T: [T * 0.92, 0.22], gaya: 'papan', pantul: null };
    return { titik: [asal, pusat], T: [T], gaya: 'swish', pantul: null };
  }
  if (o.jauh) {
    const akhir = tepi(acak(0.6, 1.2), kePemain + acak(-0.6, 0.6));
    const v = kecepatanTiba(asal, akhir, T);
    return { titik: [asal, akhir], T: [T], gaya: 'angin', pantul: [v.vx, v.vy, v.vz] };
  }
  if (d > 3 && Math.random() < 0.3) {
    const akhir = papan(rim.x + acak(-0.6, 0.6), rim.y + acak(0.2, 0.55));
    const v = kecepatanTiba(asal, akhir, T);
    return { titik: [asal, akhir], T: [T], gaya: 'papan', pantul: [v.vx * 0.7, v.vy * 0.8, -v.vz * 0.6] };
  }
  const akhir = tepi(acak(0.25, 0.33), kePemain + acak(-1.5, 1.5));
  const v = kecepatanTiba(asal, akhir, T);
  const nx = akhir[0] - rim.x;
  const nz = akhir[2] - rim.z;
  const n = Math.hypot(nx, nz) || 1;
  const laju = acak(1.6, 3);
  return { titik: [asal, akhir], T: [T], gaya: 'ring', pantul: [(nx / n) * laju, Math.abs(v.vy) * 0.45, (nz / n) * laju] };
}

// Fisika bola bebas: gravitasi, papan, bibir ring, lantai, dan batas lapangan.
function langkahBola(o, dt) {
  o.vy -= G * dt;
  const zLama = o.z;
  o.x += o.vx * dt;
  o.y += o.vy * dt;
  o.z += o.vz * dt;
  for (const r of RIM) {
    if ((zLama - r.papanZ) * (o.z - r.papanZ) <= 0 && Math.abs(o.x - r.x) < 0.9 && o.y > 2.78 && o.y < 3.82) {
      o.z = zLama;
      o.vz *= -0.6;
    }
    const dy = o.y - r.y;
    const rr = Math.hypot(o.x - r.x, o.z - r.z);
    if (Math.abs(dy) < 0.2 && rr > 1e-3) {
      const dx = (o.x - r.x) * (1 - 0.23 / rr);
      const dz = (o.z - r.z) * (1 - 0.23 / rr);
      const d = Math.hypot(dx, dy, dz);
      const vn = d > 1e-3 ? (o.vx * dx + o.vy * dy + o.vz * dz) / d : 0;
      if (d < R_BOLA + 0.022 && vn < 0) {
        o.vx -= (1.55 * vn * dx) / d;
        o.vy -= (1.55 * vn * dy) / d;
        o.vz -= (1.55 * vn * dz) / d;
      }
    }
  }
  if (o.y < LANTAI) {
    o.y = LANTAI;
    o.vy = o.vy < -1.2 ? o.vy * -0.72 : 0;
    const gesek = Math.exp(-1.2 * dt);
    o.vx *= gesek;
    o.vz *= gesek;
  }
  if (o.x < LAPANGAN.x0 + R_BOLA || o.x > LAPANGAN.x1 - R_BOLA) {
    o.x = jepit(o.x, LAPANGAN.x0 + R_BOLA, LAPANGAN.x1 - R_BOLA);
    o.vx *= -0.6;
  }
  if (o.z < LAPANGAN.z0 + R_BOLA || o.z > LAPANGAN.z1 - R_BOLA) {
    o.z = jepit(o.z, LAPANGAN.z0 + R_BOLA, LAPANGAN.z1 - R_BOLA);
    o.vz *= -0.6;
  }
}
// --- akhir bagian yang sama ---

const bulat = (v) => Math.round(v * 1000) / 1000;
const bolaKeluar = (o) => o && { x: bulat(o.x), y: bulat(o.y), z: bulat(o.z), vx: bulat(o.vx), vy: bulat(o.vy), vz: bulat(o.vz) };
// Titik bola di ruas pertama, untuk memeriksa blok & curian.
function titikRuas(ts, t) {
  const [a, b] = ts.titik;
  const T = ts.T[0];
  const s = Math.min(t, T);
  return { x: a[0] + ((b[0] - a[0]) / T) * s, y: a[1] + ((b[1] - a[1] + 0.5 * G * T * T) / T) * s - 0.5 * G * s * s, z: a[2] + ((b[2] - a[2]) / T) * s };
}

function pasangBasket(nsp, { pembatas, daftarMs = DAFTAR_MS }) {
  const semua = new Map(); // ruang → laga

  const publik = (L) => {
    if (!L) return null;
    const kini = Date.now();
    const sisa = L.fase === 'daftar' ? L.tutup - kini : L.fase === 'mulai' ? L.sampai - kini : L.fase === 'selesai' ? L.hapus - kini : L.sisaMs;
    return {
      id: L.id,
      fase: L.fase,
      sisa: Math.max(0, sisa),
      jam: Math.max(0, L.jamMs),
      skor: L.skor,
      pemegang: L.pemegang,
      sisi: L.sisi,
      bidik: L.bidik,
      menang: L.menang,
      wo: L.wo,
      mvp: L.mvp,
      peserta: [...L.peserta.values()].map(({ pid, sid, nama, tim, poin, reb, ast, stl, blk, putus, keluar, awal, beruntun }) => ({ pid, sid, nama, tim, poin, reb, ast, stl, blk, putus: !!putus, keluar: !!keluar, awal, panas: beruntun >= 3 })),
      bola: L.tembakan || L.pemegang ? null : bolaKeluar(L.bola),
    };
  };
  const siarkan = (L, ev) => nsp.to(`ruang:${L.ruang}`).emit('basket', { ...publik(L), ev });
  const pos = (P) => P.data?.s || P.awal;
  const hidup = (L) => [...L.peserta.values()].filter((P) => !P.putus);

  function terdekat(L, saring, x, z) {
    let terbaik = null;
    let jarak = Infinity;
    for (const P of hidup(L)) {
      if (!saring(P)) continue;
      const s = pos(P);
      const d = Math.hypot(s.x - x, s.z - z);
      if (d < jarak) [terbaik, jarak] = [P, d];
    }
    return { P: terbaik, d: jarak };
  }

  function berikan(L, P, { ulangJam = true, kebalMs = 0 } = {}) {
    if (L.timBola !== P.tim) L.asisten = null;
    L.timBola = P.tim;
    L.pemegang = P.pid;
    L.bidik = null;
    L.tembakan = null;
    L.bola = null;
    L.sisi = 1;
    L.kebalSampai = Date.now() + kebalMs;
    if (ulangJam) L.jamMs = JAM_SERANG_MS;
  }

  function lepaskanBola(L, x, z) {
    L.pemegang = null;
    L.bidik = null;
    L.bola = { x, y: 1, z, vx: acak(-1, 1), vy: 0, vz: acak(-1, 1) };
  }

  function mulaiLaga(L, kini) {
    const daftar = [...L.peserta.values()].sort(() => Math.random() - 0.5);
    const hitung = [0, 0];
    daftar.forEach((P, i) => {
      P.tim = i % 2;
      const n = hitung[P.tim]++;
      // tim 0 menyerang ring z kecil, jadi berangkat dari setengah lapangan z besar
      P.awal = { x: -58 + [0, -3, 3][n], z: P.tim === 0 ? 21 : 17, rot: P.tim === 0 ? Math.PI : 0 };
    });
    Object.assign(L, { fase: 'mulai', sampai: kini + MULAI_MS, sisaMs: LAGA_MS, jamMs: JAM_SERANG_MS });
  }

  function akhiri(L, kini, wo = false) {
    const [a, b] = L.skor;
    const tinggal = wo ? [0, 1].filter((t) => hidup(L).some((P) => P.tim === t)) : [];
    L.menang = wo ? (tinggal.length === 1 ? tinggal[0] : -1) : a > b ? 0 : 1;
    L.wo = wo;
    Object.assign(L, { fase: 'selesai', hapus: kini + SIMPAN_HASIL_MS, tembakan: null, pemegang: null, bidik: null });
    const nilai = (P) => P.poin + P.ast + P.reb * 0.5 + P.stl + P.blk;
    L.mvp = [...L.peserta.values()].filter((P) => P.tim === L.menang).sort((p, q) => nilai(q) - nilai(p))[0]?.pid ?? null;
    siarkan(L, { k: 'selesai' });
  }

  function selesaikanTerbang(L, kini) {
    const ts = L.tembakan;
    const akhir = ts.titik[ts.titik.length - 1];
    L.tembakan = null;
    const P = [...L.peserta.values()].find((q) => q.pid === ts.pid);
    if (ts.jenis === 'oper') {
      const ke = [...L.peserta.values()].find((q) => q.pid === ts.ke);
      if (ke && !ke.putus && Math.hypot(pos(ke).x - akhir[0], pos(ke).z - akhir[2]) < 2.2) {
        L.asisten = { pid: ts.pid, sampai: kini + 6000 };
        berikan(L, ke, { ulangJam: false });
        return siarkan(L, { k: 'terima', pid: ke.pid });
      }
      const v = kecepatanTiba(ts.titik[0], akhir, ts.T[0]);
      L.bola = { x: akhir[0], y: akhir[1], z: akhir[2], ...v };
      return siarkan(L);
    }
    if (!ts.masuk) {
      if (P) P.beruntun = 0;
      L.bolaDariTembakan = true;
      L.bola = { x: akhir[0], y: akhir[1], z: akhir[2], vx: ts.pantul[0], vy: ts.pantul[1], vz: ts.pantul[2] };
      return siarkan(L);
    }
    L.skor[ts.tim] += ts.poin;
    let asisten = null;
    if (P) {
      P.poin += ts.poin;
      P.beruntun += 1;
      if (L.asisten && L.asisten.pid !== P.pid && kini < L.asisten.sampai) {
        asisten = [...L.peserta.values()].find((q) => q.pid === L.asisten.pid) || null;
        if (asisten) asisten.ast += 1;
      }
    }
    L.asisten = null;
    L.bola = { x: akhir[0], y: akhir[1] - 0.5, z: akhir[2], vx: 0, vy: -3, vz: 0 };
    L.fase = 'skor';
    L.sampai = kini + JEDA_SKOR_MS;
    L.timBolaBerikut = 1 - ts.tim;
    siarkan(L, { k: 'skor', pid: ts.pid, poin: ts.poin, tim: ts.tim, asisten: asisten?.pid ?? null, gaya: ts.gaya });
  }

  function majukanTerbang(L, dt, kini) {
    const ts = L.tembakan;
    ts.t += dt;
    if (ts.t > 0) {
      const o = titikRuas(ts, ts.t);
      if (ts.jenis === 'tembak' && ts.t < 0.45) {
        const { P, d } = terdekat(L, (q) => q.tim !== ts.tim && q.data?.s?.udara, o.x, o.z);
        if (P && d < 1.1) {
          const a = Math.random() * Math.PI * 2;
          P.blk += 1;
          L.tembakan = null;
          L.bolaDariTembakan = true;
          L.bola = { ...o, vx: Math.sin(a) * 3, vy: -1, vz: Math.cos(a) * 3 };
          return siarkan(L, { k: 'tepis', pid: P.pid });
        }
      }
      if (ts.jenis === 'oper' && o.y < 2.4) {
        const { P, d } = terdekat(L, (q) => q.tim !== ts.tim && !ts.dicoba.has(q.pid), o.x, o.z);
        if (P && d < 0.7) {
          ts.dicoba.add(P.pid);
          if (Math.random() < 0.55) {
            P.stl += 1;
            berikan(L, P);
            return siarkan(L, { k: 'curi', pid: P.pid });
          }
        }
      }
    }
    if (ts.t >= ts.lama + (ts.masuk ? JEDA_MASUK : 0)) selesaikanTerbang(L, kini);
  }

  function tutup(L) {
    semua.delete(L.ruang);
    nsp.to(`ruang:${L.ruang}`).emit('basket', null);
  }

  function langkah(L, kini) {
    const dt = Math.min(0.2, (kini - L.t) / 1000);
    L.t = kini;
    if (L.fase === 'daftar') {
      if (kini < L.tutup) return;
      if (L.peserta.size < 2) {
        const [P] = L.peserta.values();
        semua.delete(L.ruang);
        return nsp.to(`ruang:${L.ruang}`).emit('basket', { id: L.id, fase: 'sendiri', pid: P?.pid ?? null });
      }
      mulaiLaga(L, kini);
      return siarkan(L);
    }
    if (L.fase === 'selesai') {
      if (kini >= L.hapus) tutup(L);
      return;
    }
    // tamu yang putus melewati tenggang dilepas; satu tim habis = lawannya menang WO
    for (const P of L.peserta.values()) if (P.putus && kini - P.putus > TENGGANG_PUTUS_MS) P.keluar = true;
    const aktif = (t) => [...L.peserta.values()].some((P) => P.tim === t && !P.keluar);
    if (!aktif(0) && !aktif(1)) return tutup(L); // semua sudah pergi: lapangan langsung bebas
    if (!aktif(0) || !aktif(1)) return akhiri(L, kini, true);

    if (L.fase === 'mulai') {
      if (kini < L.sampai) return;
      L.fase = 'main';
      L.bola = { x: -58, y: 2.2, z: 19, vx: 0, vy: 4, vz: 0 }; // bola loncat di tengah
      return siarkan(L, { k: 'main' });
    }
    if (L.fase === 'skor') {
      if (L.bola) for (let i = 0; i < 3; i++) langkahBola(L.bola, dt / 3);
      if (kini < L.sampai) return;
      const [a, b] = L.skor;
      if (a >= SKOR_MENANG || b >= SKOR_MENANG || (L.sisaMs <= 0 && a !== b)) return akhiri(L, kini);
      const timBola = L.timBolaBerikut;
      const rumah = RIM[1 - timBola]; // ring yang dijaga tim itu
      const { P } = terdekat(L, (q) => q.tim === timBola, rumah.x, rumah.z);
      L.fase = 'main';
      if (P) berikan(L, P, { kebalMs: 1200 });
      return siarkan(L, { k: 'lanjut' });
    }

    L.sisaMs = Math.max(0, L.sisaMs - dt * 1000);
    if (L.sisaMs <= 0 && L.skor[0] !== L.skor[1] && !L.tembakan) return akhiri(L, kini);
    if (L.pemegang) {
      L.jamMs -= dt * 1000;
      if (L.jamMs <= 0) {
        const pegang = [...L.peserta.values()].find((P) => P.pid === L.pemegang);
        const s = pos(pegang);
        const { P } = terdekat(L, (q) => q.tim !== pegang.tim, s.x, s.z);
        if (P) {
          berikan(L, P, { kebalMs: 800 });
          siarkan(L, { k: 'hangus' });
        } else L.jamMs = JAM_SERANG_MS;
      }
    }
    if (L.tembakan) majukanTerbang(L, dt, kini);
    else if (L.bola) {
      for (let i = 0; i < 3; i++) langkahBola(L.bola, dt / 3);
      if (L.bola.y < 1.9) {
        const { P, d } = terdekat(L, () => true, L.bola.x, L.bola.z);
        if (P && d < 0.85) {
          if (L.bolaDariTembakan) P.reb += 1;
          L.bolaDariTembakan = false;
          berikan(L, P);
          return siarkan(L, { k: 'ambil', pid: P.pid });
        }
      }
    }
    if (L.fase === 'main' && kini - L.denyut > DENYUT_MS) {
      L.denyut = kini;
      siarkan(L);
    }
  }

  const jam = setInterval(() => {
    const kini = Date.now();
    for (const L of semua.values()) langkah(L, kini);
  }, TICK_MS);
  jam.unref?.();

  // Tamu benar-benar meninggalkan lomba (✕, pindah dunia).
  function keluar(socket) {
    const k = socket.data.kunci;
    for (const L of semua.values()) {
      const P = k && L.peserta.get(k);
      if (!P || P.sid !== socket.id) continue;
      if (L.fase === 'selesai') continue;
      if (L.fase === 'daftar') {
        L.peserta.delete(k);
        if (!L.peserta.size) tutup(L);
        else siarkan(L);
        continue;
      }
      if (L.pemegang === P.pid) {
        const s = pos(P);
        lepaskanBola(L, s.x, s.z);
      }
      P.keluar = true;
      P.putus = P.putus || Date.now();
      siarkan(L);
    }
  }

  function pasang(socket, data, ruangKini) {
    const bolehDaftar = pembatas(4, 10000);
    const bolehAksi = pembatas(30, 3000);
    const saya = () => {
      const L = semua.get(ruangKini());
      const P = L && socket.data.kunci && L.peserta.get(socket.data.kunci);
      return P && P.sid === socket.id && !P.keluar ? { L, P } : null;
    };
    const dalamLaga = () => {
      const a = saya();
      return a && a.L.fase === 'main' && bolehAksi() ? a : null;
    };

    socket.on('basket:daftar', (_m, balas) => {
      if (typeof balas !== 'function') return;
      const ruang = ruangKini();
      const kunci = socket.data.kunci;
      if (typeof ruang !== 'number' || !kunci) return balas({ ok: false, alasan: 'Lomba basket hanya ada di lapangan Taman Warga' });
      if (!bolehDaftar()) return balas({ ok: false, alasan: 'Coba lagi sebentar lagi' });
      let L = semua.get(ruang);
      if (L?.peserta.has(kunci) && L.fase !== 'selesai') {
        const P = L.peserta.get(kunci);
        Object.assign(P, { sid: socket.id, data, putus: null, keluar: false });
        return balas({ ok: true, id: L.id, pid: P.pid, lama: true });
      }
      if (L && L.fase !== 'daftar' && L.fase !== 'selesai') return balas({ ok: false, alasan: 'Lapangan sedang dipakai lomba — tunggu selesai' });
      if (!L || L.fase === 'selesai') {
        L = {
          id: crypto.randomBytes(6).toString('hex'),
          ruang,
          fase: 'daftar',
          t: Date.now(),
          tutup: Date.now() + daftarMs,
          peserta: new Map(),
          skor: [0, 0],
          sisaMs: LAGA_MS,
          jamMs: JAM_SERANG_MS,
          pemegang: null,
          sisi: 1,
          bidik: null,
          bola: null,
          tembakan: null,
          kebalSampai: 0,
          denyut: 0,
          menang: null,
          wo: false,
          mvp: null,
        };
        semua.set(ruang, L);
      }
      if (L.peserta.size >= MAKS_PESERTA) return balas({ ok: false, alasan: 'Peserta lomba basket sudah penuh' });
      const pid = crypto.randomBytes(4).toString('hex');
      L.peserta.set(kunci, { pid, sid: socket.id, data, nama: data.nama, tim: 0, poin: 0, reb: 0, ast: 0, stl: 0, blk: 0, beruntun: 0, putus: null, keluar: false, awal: { x: -58, z: 19, rot: 0 }, jedaRebut: 0, jedaKecoh: 0 });
      balas({ ok: true, id: L.id, pid });
      if (L.peserta.size >= MAKS_PESERTA) mulaiLaga(L, Date.now());
      siarkan(L);
    });

    socket.on('basket:keluar', () => keluar(socket));

    socket.on('basket:bidik', (m) => {
      const a = dalamLaga();
      if (!a || a.L.pemegang !== a.P.pid) return;
      a.L.bidik = m?.on ? a.P.pid : null;
      siarkan(a.L);
    });

    socket.on('basket:kecoh', () => {
      const a = dalamLaga();
      const kini = Date.now();
      if (!a || a.L.pemegang !== a.P.pid || kini < a.P.jedaKecoh) return;
      a.P.jedaKecoh = kini + 1400;
      a.L.sisi = -a.L.sisi;
      a.L.kebalSampai = Math.max(a.L.kebalSampai, kini + 800);
      siarkan(a.L, { k: 'kecoh', pid: a.P.pid });
    });

    socket.on('basket:rebut', () => {
      const a = dalamLaga();
      const kini = Date.now();
      if (!a || !a.L.pemegang || kini < a.P.jedaRebut) return;
      const { L, P } = a;
      const pegang = [...L.peserta.values()].find((q) => q.pid === L.pemegang);
      if (!pegang || pegang.tim === P.tim) return;
      P.jedaRebut = kini + 1000;
      if (kini < L.kebalSampai) return;
      const sP = pos(P);
      const sL = pos(pegang);
      const d = Math.hypot(sP.x - sL.x, sP.z - sL.z);
      if (d > 1.6) return;
      const peluang = (d < 1 ? 0.33 : 0.18) + (L.bidik === pegang.pid ? 0.2 : 0);
      if (Math.random() < peluang) {
        P.stl += 1;
        berikan(L, P, { kebalMs: 900 });
        siarkan(L, { k: 'rebut', pid: P.pid, dari: pegang.pid });
      }
    });

    socket.on('basket:oper', (m) => {
      const a = dalamLaga();
      if (!a || a.L.pemegang !== a.P.pid) return;
      const { L, P } = a;
      const ke = [...L.peserta.values()].find((q) => q.pid === m?.ke);
      if (!ke || ke === P || ke.tim !== P.tim || ke.putus) return;
      const s = pos(P);
      const t = pos(ke);
      const titik = [[s.x, 1.35, s.z], [t.x, 1.25, t.z]];
      const T = [0.22 + Math.hypot(t.x - s.x, t.z - s.z) * 0.035];
      L.pemegang = null;
      L.bidik = null;
      L.tembakan = { jenis: 'oper', pid: P.pid, ke: ke.pid, tim: P.tim, titik, T, lama: T[0], t: -0.05, dicoba: new Set() };
      siarkan(L, { k: 'oper', pid: P.pid, ke: ke.pid, titik, T });
    });

    socket.on('basket:tembak', (m) => {
      const a = dalamLaga();
      if (!a || a.L.pemegang !== a.P.pid) return;
      const { L, P } = a;
      const isi = typeof m?.isi === 'number' && Number.isFinite(m.isi) ? jepit(m.isi, 0, 1.5) : 0;
      const s = pos(P);
      // titik lepas dari klien lebih segar dari kiriman "gerak", asalkan masih masuk akal
      const sah = typeof m?.x === 'number' && typeof m?.z === 'number' && Math.hypot(m.x - s.x, m.z - s.z) < 3;
      const p = sah ? { x: m.x, z: m.z } : { x: s.x, z: s.z };
      const rim = RIM[P.tim];
      const d = Math.hypot(rim.x - p.x, rim.z - p.z);
      const dJaga = terdekat(L, (q) => q.tim !== P.tim, p.x, p.z).d;
      const kontes = kontesDari(dJaga);
      const dekat = d < JARAK_DEKAT;
      const perfect = !dekat && perfectDari(isi);
      const panas = P.beruntun >= 3 ? 1.1 : 1;
      const masuk = Math.random() < Math.min(0.98, (dekat ? peluangDekat(kontes) : peluangTembak(isi, d, kontes)) * panas);
      const dunk = dekat && masuk && !!P.data?.s?.lari && dJaga > 1.2;
      const r = rencanaTembakan(p, rim, { masuk, perfect, dekat, dunk, jauh: !dekat && !perfect && isi < 0.35 });
      const lama = r.T.reduce((x, y) => x + y, 0);
      L.pemegang = null;
      L.bidik = null;
      L.tembakan = { jenis: 'tembak', pid: P.pid, tim: P.tim, ...r, lama, t: -TUNDA_LEPAS, masuk, poin: d > JARAK_TIGA ? 3 : 2 };
      siarkan(L, { k: 'tembak', pid: P.pid, tim: P.tim, ...r, masuk, perfect });
    });

    // jaringan putus: kursi ditahan selama tenggang, bola dilepas supaya laga tetap jalan
    socket.on('disconnect', () => {
      const a = saya();
      if (!a || a.L.fase === 'selesai') return;
      const { L, P } = a;
      if (L.fase === 'daftar') return keluar(socket);
      P.putus = Date.now();
      if (L.pemegang === P.pid) {
        const s = pos(P);
        lepaskanBola(L, s.x, s.z);
      }
      siarkan(L);
    });
  }

  // Tersambung ulang (socket baru, kunci sama): kembali ke kursinya.
  function sambung(socket, data, ruang) {
    const L = semua.get(ruang);
    const P = L && socket.data.kunci && L.peserta.get(socket.data.kunci);
    if (!P || P.keluar || L.fase === 'selesai') return;
    Object.assign(P, { sid: socket.id, data, putus: null });
    siarkan(L);
  }

  // Ruang laga milik tamu ini, supaya sambung ulang kembali ke lapangan yang sama.
  function ruangUntuk(kunci) {
    if (!kunci) return null;
    for (const L of semua.values()) {
      const P = L.peserta.get(kunci);
      if (P && !P.keluar && L.fase !== 'selesai') return L.ruang;
    }
    return null;
  }

  return { pasang, keluar, sambung, ruangUntuk, publikRuang: (ruang) => publik(semua.get(ruang)), hentikan: () => clearInterval(jam) };
}

module.exports = { pasangBasket, rencanaTembakan, langkahBola, RIM };
