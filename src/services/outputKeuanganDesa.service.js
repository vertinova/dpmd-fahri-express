// src/services/outputKeuanganDesa.service.js
// Prolap — rekap OUTPUT penyaluran keuangan desa, diolah dari SIPANDA.
//
// SIPANDA mengirim baris granular per desa per tahap/bulan. Di sini tiap
// SUMBER DANA (ADD, DD Reguler, BHPRD, Bankeu, BP) diolah menjadi satu output
// tersendiri: berapa yang cair, di desa mana, sampai tahap berapa, dan
// secepat apa prosesnya.
//
// Empat sifat sumber data yang WAJIB ikut dilaporkan ke pemakai, bukan
// disembunyikan:
//  1. Daftar sumber dana TIDAK di-hardcode. Nama sumber berganti antar tahun
//     ("BANKEU INFRAS DESA" 2025 -> "BANKEU AKSELERASI PEDESAAN" 2026); daftar
//     yang dipatok mati membuat satu item diam-diam bernilai nol.
//  2. `tanggal_pencairan` kosong pada sebagian baris yang sudah cair (±16% di
//     2026), sedangkan `tanggal_sp2d` selalu terisi. Sumbu waktu karena itu
//     memakai tanggal SP2D; jumlah baris yang tanggal cairnya kosong tetap
//     dilaporkan.
//  3. `approved_at` kosong pada sebagian baris, jadi lama proses hanya bisa
//     dihitung untuk sebagian — jumlah yang terhitung ikut disebut.
//  4. `id_desa` SIPANDA (`3201022001`) sama dengan `desas.kode` lokal
//     (`32.01.02.2001`) HANYA setelah titiknya dibuang. Pencocokan lewat nama
//     desa salah: 416 desa hanya punya 369 nama unik, dan 5 di antaranya beda
//     ejaan dengan data lokal (CILEUBUT BARAT vs Cilebut Barat).
const prisma = require('../config/prisma');
const sipandaService = require('./sipanda.service');
const logger = require('../utils/logger');

// ============================================================
// Sumber dana
// ============================================================
// Slot warna dipatok per sumber supaya warnanya menempel ke entitasnya, bukan
// ke urutan tampil — memfilter satu sumber tidak boleh mengecat ulang sisanya.
// Kunci dicocokkan longgar (mengandung kata), sehingga penggantian nama resmi
// tidak memutus pemetaan. Sumber yang tidak dikenal tetap tampil dengan slot
// sisa dan ditandai `dikenali: false`, bukan dibuang.
const PROFIL_SUMBER = [
  { key: 'add', cocok: /^ADD/, label: 'Alokasi Dana Desa', singkat: 'ADD', slot: 1 },
  { key: 'dd', cocok: /^DD/, label: 'Dana Desa Reguler', singkat: 'DD', slot: 2 },
  { key: 'bhprd', cocok: /^BHPRD/, label: 'Bagi Hasil Pajak & Retribusi Daerah', singkat: 'BHPRD', slot: 3 },
  { key: 'bankeu', cocok: /^BANKEU/, label: 'Bantuan Keuangan Infrastruktur', singkat: 'Bankeu', slot: 4 },
  { key: 'bp', cocok: /^BP/, label: 'Bantuan Provinsi', singkat: 'BP', slot: 5 },
];

const kenaliSumber = (namaSumber) => {
  const nama = String(namaSumber || '').toUpperCase().trim();
  const profil = PROFIL_SUMBER.find((item) => item.cocok.test(nama));
  if (profil) {
    return { key: profil.key, label: profil.label, singkat: profil.singkat, slot: profil.slot, dikenali: true };
  }
  // Sumber baru yang belum pernah ada di SIPANDA — tampilkan apa adanya.
  return {
    key: nama.toLowerCase().replace(/[^a-z0-9]+/g, '_') || 'lainnya',
    label: namaSumber || 'Tidak Diketahui',
    singkat: namaSumber || 'Lainnya',
    slot: 8,
    dikenali: false,
  };
};

// Status SIPANDA yang berarti dana sudah keluar. `sudah_cair` adalah penanda
// resminya; `sts` hanya dipakai untuk menjelaskan yang BELUM cair ada di mana.
const isCair = (row) => String(row.sudah_cair || '').toUpperCase() === 'Y';

// ============================================================
// Utilitas
// ============================================================
/**
 * `anggaran` SIPANDA berformat "220190608.00" — berdesimal. Membuang titiknya
 * (seperti parser rupiah) membuat nilainya 100x lipat.
 */
const toNumber = (value) => {
  if (value === null || value === undefined || value === '') return 0;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
};

const persen = (bagian, total) => (total > 0 ? Math.round((bagian / total) * 1000) / 10 : 0);

/** "2026-02-24" / "2026-02-25 10:10:39" -> "2026-02". */
const bulanDari = (nilai) => {
  if (!nilai) return null;
  const teks = String(nilai);
  return /^\d{4}-\d{2}/.test(teks) ? teks.slice(0, 7) : null;
};

const hariAntara = (mulai, selesai) => {
  if (!mulai || !selesai) return null;
  const a = new Date(String(mulai).slice(0, 10));
  const b = new Date(String(selesai).slice(0, 10));
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return null;
  const selisih = Math.round((b - a) / 86400000);
  // Cair mendahului persetujuan = data tidak konsisten, bukan proses instan.
  return selisih < 0 ? null : selisih;
};

const median = (angka) => {
  if (!angka.length) return null;
  const urut = [...angka].sort((a, b) => a - b);
  const tengah = Math.floor(urut.length / 2);
  return urut.length % 2 ? urut[tengah] : Math.round((urut[tengah - 1] + urut[tengah]) / 2);
};

/** `desas.kode` lokal bertitik, `id_desa` SIPANDA tidak. Samakan dulu. */
const normalKode = (kode) => String(kode || '').replace(/\D/g, '');

// ============================================================
// Pemetaan desa lokal
// ============================================================
/** @returns {Map<string, {desa_id:number, nama_desa:string, nama_kecamatan:string}>} */
const fetchPetaDesa = async () => {
  const rows = await prisma.$queryRawUnsafe(
    `SELECT d.id, d.kode, d.nama, k.nama AS nama_kecamatan
     FROM desas d
     LEFT JOIN kecamatans k ON k.id = d.kecamatan_id
     WHERE d.status_pemerintahan = 'desa'`
  );
  const peta = new Map();
  for (const row of rows) {
    peta.set(normalKode(row.kode), {
      desa_id: Number(row.id),
      nama_desa: row.nama,
      nama_kecamatan: row.nama_kecamatan || 'Tidak Diketahui',
    });
  }
  return peta;
};

// ============================================================
// Agregasi satu sumber dana
// ============================================================
const wadahTahap = (nama, urut, persenAlokasi) => ({
  nama,
  urut,
  persen_alokasi: persenAlokasi,
  alokasi: 0,
  realisasi: 0,
  desa_total: new Set(),
  desa_cair: new Set(),
});

const olahSumber = (rows, petaDesa) => {
  const identitas = kenaliSumber(rows[0].sumber_dana);

  let alokasi = 0;
  let realisasi = 0;
  let barisCair = 0;
  let cairTanpaTanggalCair = 0;
  let cairTanpaApproved = 0;

  const tahap = new Map();       // nm_tahap -> wadahTahap
  const kecamatan = new Map();   // nama -> { alokasi, realisasi, desa, desaCair }
  const desa = new Map();        // kode -> { ..., baris, baris_cair }
  const tren = new Map();        // 'YYYY-MM' -> { realisasi, baris }
  const status = new Map();      // sts -> jumlah baris belum cair
  const lamaProses = [];
  const desaAsing = new Set();

  for (const row of rows) {
    const nilai = toNumber(row.anggaran);
    const cair = isCair(row);
    const kode = normalKode(row.id_desa);
    const lokal = petaDesa.get(kode);
    if (!lokal) desaAsing.add(`${row.kecamatan || '-'} / ${row.desa || '-'} (${row.id_desa})`);

    const namaDesa = lokal ? lokal.nama_desa : row.desa || 'Tidak Diketahui';
    const namaKecamatan = lokal ? lokal.nama_kecamatan : row.kecamatan || 'Tidak Diketahui';

    alokasi += nilai;
    if (cair) {
      realisasi += nilai;
      barisCair += 1;
      if (!row.tanggal_pencairan) cairTanpaTanggalCair += 1;
      if (!row.approved_at) cairTanpaApproved += 1;

      // Sumbu waktu memakai SP2D: selalu terisi, sedangkan tanggal_pencairan tidak.
      const bulan = bulanDari(row.tanggal_sp2d) || bulanDari(row.tanggal_pencairan);
      if (bulan) {
        const wadah = tren.get(bulan) || { bulan, realisasi: 0, baris: 0 };
        wadah.realisasi += nilai;
        wadah.baris += 1;
        tren.set(bulan, wadah);
      }

      const lama = hariAntara(row.approved_at, row.tanggal_pencairan || row.tanggal_sp2d);
      if (lama !== null) lamaProses.push(lama);
    } else {
      const label = row.sts || 'Belum Mengajukan';
      status.set(label, (status.get(label) || 0) + 1);
    }

    // ---- per tahap ----
    const namaTahap = row.nm_tahap || row.periode || 'Tanpa Tahap';
    if (!tahap.has(namaTahap)) {
      tahap.set(namaTahap, wadahTahap(namaTahap, toNumber(row.id_periode), toNumber(row.persen_alokasi)));
    }
    const t = tahap.get(namaTahap);
    t.alokasi += nilai;
    t.desa_total.add(kode);
    if (cair) {
      t.realisasi += nilai;
      t.desa_cair.add(kode);
    }

    // ---- per kecamatan ----
    if (!kecamatan.has(namaKecamatan)) {
      kecamatan.set(namaKecamatan, { nama: namaKecamatan, alokasi: 0, realisasi: 0, desa: new Set(), desa_cair: new Set() });
    }
    const k = kecamatan.get(namaKecamatan);
    k.alokasi += nilai;
    k.desa.add(kode);
    if (cair) {
      k.realisasi += nilai;
      k.desa_cair.add(kode);
    }

    // ---- per desa ----
    if (!desa.has(kode)) {
      desa.set(kode, {
        desa_id: lokal ? lokal.desa_id : null,
        kode,
        nama_desa: namaDesa,
        nama_kecamatan: namaKecamatan,
        dikenali: Boolean(lokal),
        alokasi: 0,
        realisasi: 0,
        baris: 0,
        baris_cair: 0,
      });
    }
    const d = desa.get(kode);
    d.alokasi += nilai;
    d.baris += 1;
    if (cair) {
      d.realisasi += nilai;
      d.baris_cair += 1;
    }
  }

  // Tahap dianggap TUNTAS bila semua desa di tahap itu sudah cair; BERJALAN bila
  // sebagian; BELUM bila tidak ada satu pun.
  const daftarTahap = [...tahap.values()]
    .sort((a, b) => a.urut - b.urut)
    .map((t) => {
      const desaTotal = t.desa_total.size;
      const desaCair = t.desa_cair.size;
      return {
        nama: t.nama,
        urut: t.urut,
        persen_alokasi: t.persen_alokasi,
        alokasi: t.alokasi,
        realisasi: t.realisasi,
        desa_total: desaTotal,
        desa_cair: desaCair,
        persen_desa: persen(desaCair, desaTotal),
        status: desaCair === 0 ? 'belum' : desaCair === desaTotal ? 'tuntas' : 'berjalan',
      };
    });

  const desaSemua = [...desa.values()];
  const desaCairPenuh = desaSemua.filter((d) => d.baris_cair === d.baris).length;
  const desaCairSebagian = desaSemua.filter((d) => d.baris_cair > 0 && d.baris_cair < d.baris).length;

  return {
    ...identitas,
    sumber_dana: rows[0].sumber_dana,
    alokasi,
    realisasi,
    sisa: alokasi - realisasi,
    persen_serapan: persen(realisasi, alokasi),
    baris: { total: rows.length, cair: barisCair, belum: rows.length - barisCair },
    desa: {
      total: desaSemua.length,
      cair_penuh: desaCairPenuh,
      cair_sebagian: desaCairSebagian,
      belum: desaSemua.length - desaCairPenuh - desaCairSebagian,
    },
    tahap: daftarTahap,
    tahap_tuntas: daftarTahap.filter((t) => t.status === 'tuntas').length,
    lama_proses: {
      terhitung: lamaProses.length,
      tidak_terhitung: barisCair - lamaProses.length,
      median_hari: median(lamaProses),
      tercepat_hari: lamaProses.length ? Math.min(...lamaProses) : null,
      terlama_hari: lamaProses.length ? Math.max(...lamaProses) : null,
    },
    tren: [...tren.values()].sort((a, b) => a.bulan.localeCompare(b.bulan)),
    status_belum_cair: [...status.entries()]
      .map(([label, jumlah]) => ({ label, jumlah }))
      .sort((a, b) => b.jumlah - a.jumlah),
    per_kecamatan: [...kecamatan.values()]
      .map((k) => ({
        nama: k.nama,
        alokasi: k.alokasi,
        realisasi: k.realisasi,
        persen_serapan: persen(k.realisasi, k.alokasi),
        desa: k.desa.size,
        desa_cair: k.desa_cair.size,
      }))
      .sort((a, b) => b.realisasi - a.realisasi),
    per_desa: desaSemua
      .map((d) => ({ ...d, persen_serapan: persen(d.realisasi, d.alokasi) }))
      .sort((a, b) => b.realisasi - a.realisasi),
    catatan: {
      cair_tanpa_tanggal_pencairan: cairTanpaTanggalCair,
      cair_tanpa_approved_at: cairTanpaApproved,
      desa_tidak_dikenal: [...desaAsing],
    },
  };
};

// ============================================================
// Entry point
// ============================================================
/**
 * @param {{ tahun?: number|string, sumber?: string, force?: boolean }} options
 * @returns {Promise<object>} rekap output penyaluran per sumber dana
 */
const getOutputKeuanganDesa = async (options = {}) => {
  const tahun = String(options.tahun || sipandaService.SIPANDA_TAHUN);

  const [rows, petaDesa] = await Promise.all([
    sipandaService.fetchSipandaRows({ tahun, force: Boolean(options.force) }),
    fetchPetaDesa(),
  ]);

  if (!Array.isArray(rows) || rows.length === 0) {
    return {
      filter: { tahun, sumber: 'semua' },
      sumber_dana: [],
      ringkasan: { alokasi: 0, realisasi: 0, persen_serapan: 0, desa: 0, desa_sistem: petaDesa.size },
      kosong: true,
      pesan: `SIPANDA tidak mengembalikan baris untuk tahun ${tahun}.`,
      sumber_data: { nama: 'SIPANDA', url: sipandaService.SIPANDA_BASE_URL, tahun },
      generated_at: new Date().toISOString(),
    };
  }

  // Kelompokkan per sumber dana APA ADANYA dari data, bukan dari daftar tetap.
  const perSumber = new Map();
  for (const row of rows) {
    const nama = row.sumber_dana || 'TIDAK DIKETAHUI';
    if (!perSumber.has(nama)) perSumber.set(nama, []);
    perSumber.get(nama).push(row);
  }

  let daftar = [...perSumber.values()].map((baris) => olahSumber(baris, petaDesa));
  daftar.sort((a, b) => a.slot - b.slot);

  const sumberFilter = options.sumber && options.sumber !== 'semua' ? options.sumber : null;
  const tampil = sumberFilter ? daftar.filter((item) => item.key === sumberFilter) : daftar;

  // Ringkasan selalu dari SELURUH sumber, supaya angka induk tidak ikut berubah
  // saat pemakai menyaring satu item.
  const alokasi = daftar.reduce((total, item) => total + item.alokasi, 0);
  const realisasi = daftar.reduce((total, item) => total + item.realisasi, 0);
  const desaTersentuh = new Set();
  daftar.forEach((item) => item.per_desa.forEach((d) => desaTersentuh.add(d.kode)));

  return {
    filter: { tahun, sumber: sumberFilter || 'semua' },
    opsi: {
      sumber: daftar.map((item) => ({
        key: item.key,
        label: item.label,
        singkat: item.singkat,
        slot: item.slot,
        dikenali: item.dikenali,
      })),
    },
    ringkasan: {
      alokasi,
      realisasi,
      sisa: alokasi - realisasi,
      persen_serapan: persen(realisasi, alokasi),
      desa: desaTersentuh.size,
      desa_sistem: petaDesa.size,
      sumber_dana: daftar.length,
    },
    sumber_dana: tampil,
    catatan_data: {
      // Dikumpulkan lintas sumber supaya pemakai melihat keterbatasannya sekali,
      // tidak terpencar di tiap kartu.
      cair_tanpa_tanggal_pencairan: daftar.reduce((t, i) => t + i.catatan.cair_tanpa_tanggal_pencairan, 0),
      cair_tanpa_approved_at: daftar.reduce((t, i) => t + i.catatan.cair_tanpa_approved_at, 0),
      desa_tidak_dikenal: [...new Set(daftar.flatMap((i) => i.catatan.desa_tidak_dikenal))],
      sumber_belum_dikenali: daftar.filter((i) => !i.dikenali).map((i) => i.sumber_dana),
    },
    sumber_data: { nama: 'SIPANDA', url: sipandaService.SIPANDA_BASE_URL, tahun },
    generated_at: new Date().toISOString(),
  };
};

module.exports = { getOutputKeuanganDesa, kenaliSumber, normalKode };
