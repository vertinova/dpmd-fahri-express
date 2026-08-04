// src/services/outputInfrastruktur.service.js
// Prolap — rekap OUTPUT pembangunan hasil Bantuan Keuangan (Bankeu).
//
// Menggabungkan Bankeu reguler + Bankeu perubahan menjadi satu daftar output
// per desa: berapa ruas jalan, berapa panjangnya, dan di desa mana saja.
//
// Dua keterbatasan sumber data yang WAJIB ikut dilaporkan ke pemakai, bukan
// disembunyikan:
//  1. Kolom `volume` berupa teks bebas ("470 M x 3 M x 0.15 M", "P = 1219 M",
//     "1 PAKET"). Panjangnya diurai heuristik; yang tidak terbaca dihitung
//     terpisah, tidak dianggap nol.
//  2. Kolom `lokasi` juga teks bebas ("Kp. Sirnasari RW 06") tanpa koordinat.
//     Titik peta karena itu memakai koordinat DESA dari Profil Desa, dan
//     hanya sebagian desa yang sudah mengisinya.
const prisma = require('../config/prisma');
const logger = require('../utils/logger');

// ============================================================
// Kategori output
// ============================================================
// `satuan: 'meter'` = panjangnya bermakna dan ikut dijumlahkan.
// `satuan: 'unit'`  = dihitung per unit saja (panjang tidak relevan).
const KATEGORI = {
  jalan: { label: 'Jalan Desa', satuan: 'meter', slot: 1 },
  jembatan: { label: 'Jembatan Desa', satuan: 'unit', slot: 2 },
  tpt: { label: 'Tembok Penahan Tanah', satuan: 'meter', slot: 3 },
  drainase: { label: 'Drainase & Gorong-gorong', satuan: 'meter', slot: 4 },
  air_bersih: { label: 'Sarana Air Bersih', satuan: 'unit', slot: 5 },
  sanitasi: { label: 'Sanitasi Lingkungan', satuan: 'unit', slot: 6 },
  bangunan: { label: 'Kantor Desa & Bangunan', satuan: 'unit', slot: 7 },
  lainnya: { label: 'Infrastruktur Lainnya', satuan: 'unit', slot: 8 },
};

// Pemetaan id master kegiatan -> kategori output.
// Catatan: pada Bankeu reguler, id 1 menggabungkan jalan DAN jembatan dalam
// satu item master, jadi tidak bisa dipisah — masuk ke `jalan`.
const KEGIATAN_REGULER = {
  1: 'jalan',
  2: 'tpt',
  27: 'tpt',
  3: 'bangunan',
  4: 'sanitasi',
  5: 'air_bersih',
  6: 'lainnya',
  8: 'lainnya',
};

const KEGIATAN_PERUBAHAN = {
  4: 'jalan',
  5: 'jalan',
  6: 'jembatan',
  7: 'tpt',
  8: 'bangunan',
  9: 'drainase',
  10: 'air_bersih',
  11: 'lainnya',
};

// Batas wajar Kabupaten Bogor — dipakai membuang koordinat ngawur
// (lat = lng hasil salah tempel, tanda minus hilang, nilai 0).
const BOGOR_BOUNDS = { latMin: -6.99, latMax: -6.05, lngMin: 106.25, lngMax: 107.2 };

// Panjang ruas di luar rentang ini hampir pasti salah baca, bukan data asli.
const PANJANG_MIN_M = 10;
const PANJANG_MAX_M = 20000;

const STATUS = {
  usulan: 'Semua usulan masuk',
  disetujui: 'Disetujui DPMD',
  selesai: 'Sudah ada LPJ',
};

// ============================================================
// Pembaca volume
// ============================================================
const NON_PANJANG = /\b(ORANG|PAKET|KEGIATAN|UNIT|TITIK|BUAH|SET|BIDANG|LEMBAR|JIWA)\b/;
const KUBIK_ATAU_LUAS = /M\s*[23²³]/;

/** Rapikan teks volume: satuan ribuan, koma desimal, spasi ganda. */
const normalizeVolume = (raw) =>
  String(raw)
    .toUpperCase()
    .replace(/\s+/g, ' ')
    .trim()
    // 1.090 -> 1090 (titik sebagai pemisah ribuan, bukan desimal)
    .replace(/\b(\d{1,3})\.(\d{3})\b/g, '$1$2')
    // 2,5 -> 2.5
    .replace(/(\d),(\d)/g, '$1.$2');

/** Ambil panjang dari satu ruas teks. */
const segmentPanjang = (segment) => {
  const toNumber = (text) => {
    const value = parseFloat(text);
    return Number.isFinite(value) ? value : null;
  };

  // 1) Penanda eksplisit — "P = 1219 M", "PANJANG 650 M", "P. 400"
  let match = segment.match(/\b(?:P|PANJANG|PJG)\s*[.:=]?\s*(\d+(?:\.\d+)?)\s*(KM)?/);
  if (match) {
    const value = toNumber(match[1]);
    if (value !== null) return match[2] ? value * 1000 : value;
  }

  // 2) Pola dimensi "A x B x C" — A adalah panjang. Ini kasus tersering, dan
  //    satuannya sering hanya ditulis di dimensi TERAKHIR ("875 X 3 X 0,15 M"),
  //    jadi aturan ini harus didahulukan daripada aturan "angka + satuan".
  match = segment.match(/(\d+(?:\.\d+)?)\s*(KM|M(?:TR|ETER)?)?\s*[X*]\s*\(?\s*\d/);
  if (match) {
    const value = toNumber(match[1]);
    if (value !== null) return match[2] === 'KM' ? value * 1000 : value;
  }

  // 3) Angka diikuti satuan meter — tapi bukan m2/m3
  match = segment.match(/(\d+(?:\.\d+)?)\s*(KM|M(?:TR|ETER)?)\b(?!\s*[23²³])/);
  if (match) {
    const value = toNumber(match[1]);
    if (value !== null) return match[2] === 'KM' ? value * 1000 : value;
  }

  // 4) Angka telanjang
  match = segment.match(/^(\d+(?:\.\d+)?)$/);
  if (match) return toNumber(match[1]);

  return null;
};

/**
 * Urai panjang (meter) dari teks volume bebas.
 * @returns {number|null} null bila tidak bisa dibaca sebagai panjang.
 */
const parsePanjangMeter = (raw) => {
  if (!raw) return null;
  const text = normalizeVolume(raw);

  // "250 ORANG", "1 PAKET" — bukan ukuran panjang sama sekali.
  if (NON_PANJANG.test(text) && !/\bM\b|METER|\bKM\b/.test(text)) return null;
  // "216,08 M3", "2004 m2" — volume/luas, bukan panjang.
  if (KUBIK_ATAU_LUAS.test(text) && !/[X*]/.test(text) && !/\bP\b|PANJANG/.test(text)) return null;

  // "(700 X 2.5 X 0.03)+(360 X 3 X 0.03)" — beberapa ruas, dijumlahkan.
  const total = text.split('+').reduce((sum, segment) => {
    const value = segmentPanjang(segment);
    return value === null ? sum : sum + value;
  }, 0);

  if (!total) return null;
  if (total < PANJANG_MIN_M || total > PANJANG_MAX_M) return null;
  return Math.round(total * 100) / 100;
};

// ============================================================
// Utilitas
// ============================================================
const toNumber = (value) => {
  if (value === null || value === undefined) return 0;
  const numeric = typeof value === 'bigint' ? Number(value) : Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
};

/**
 * Bersihkan koordinat desa. Lintang positif di Kabupaten Bogor pasti tanda
 * minusnya hilang — itu bisa diperbaiki. Sisanya (lat = lng, nol, di luar
 * wilayah) dibuang karena tidak bisa ditebak.
 */
const cleanKoordinat = (rawLat, rawLng) => {
  let lat = Number(rawLat);
  let lng = Number(rawLng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat === 0 || lng === 0) return null;
  if (lat === lng) return null; // salah tempel: kolom bujur diisi nilai lintang
  if (lat > 0 && lat < 7) lat = -lat; // tanda minus hilang
  if (lat < BOGOR_BOUNDS.latMin || lat > BOGOR_BOUNDS.latMax) return null;
  if (lng < BOGOR_BOUNDS.lngMin || lng > BOGOR_BOUNDS.lngMax) return null;
  return { lat, lng };
};

const emptyBucket = () => ({ ruas: 0, panjang_m: 0, anggaran: 0, terbaca: 0, tidak_terbaca: 0 });

const addToBucket = (bucket, item) => {
  bucket.ruas += 1;
  bucket.anggaran += item.anggaran;
  // terbaca/tidak_terbaca hanya bermakna untuk kategori yang diukur panjang.
  // Kantor desa atau sarana air bersih memang tidak punya panjang — itu bukan
  // kegagalan membaca, jadi jangan ikut dihitung sebagai data bermasalah.
  if (item.satuan !== 'meter') return;
  if (item.panjang_m === null) {
    bucket.tidak_terbaca += 1;
    return;
  }
  bucket.terbaca += 1;
  bucket.panjang_m += item.panjang_m;
};

// ============================================================
// Pengambilan data
// ============================================================
const fetchReguler = async (tahun) => {
  const rows = await prisma.$queryRawUnsafe(
    `SELECT bp.id, bp.desa_id, bp.kegiatan_id, bp.tahun_anggaran,
            bp.nama_kegiatan_spesifik, bp.volume, bp.lokasi, bp.anggaran_usulan,
            bp.dpmd_status, bp.judul_proposal,
            d.nama AS nama_desa, d.kecamatan_id, k.nama AS nama_kecamatan,
            mk.nama_kegiatan,
            EXISTS (
              SELECT 1 FROM bankeu_lpj l
              WHERE l.desa_id = bp.desa_id
                AND l.tahun_anggaran = bp.tahun_anggaran
                AND l.status = 'approved'
            ) AS ada_lpj
     FROM bankeu_proposals bp
     JOIN desas d ON d.id = bp.desa_id
     LEFT JOIN kecamatans k ON k.id = d.kecamatan_id
     LEFT JOIN bankeu_master_kegiatan mk ON mk.id = bp.kegiatan_id
     WHERE bp.kegiatan_id IN (${Object.keys(KEGIATAN_REGULER).join(',')})
       ${tahun ? 'AND bp.tahun_anggaran = ?' : ''}`,
    ...(tahun ? [tahun] : [])
  );

  return rows.map((row) => ({
    id: `reg-${toNumber(row.id)}`,
    sumber: 'reguler',
    sumber_label: 'Bankeu Reguler',
    kategori: KEGIATAN_REGULER[row.kegiatan_id] || 'lainnya',
    tahun: toNumber(row.tahun_anggaran),
    desa_id: toNumber(row.desa_id),
    nama_desa: row.nama_desa,
    kecamatan_id: toNumber(row.kecamatan_id),
    nama_kecamatan: row.nama_kecamatan || 'Tidak Diketahui',
    nama_kegiatan: row.nama_kegiatan_spesifik || row.nama_kegiatan || row.judul_proposal,
    volume_teks: row.volume,
    lokasi_teks: row.lokasi,
    anggaran: toNumber(row.anggaran_usulan),
    disetujui: row.dpmd_status === 'approved',
    selesai: Boolean(toNumber(row.ada_lpj)),
  }));
};

const fetchPerubahan = async (tahun) => {
  const rows = await prisma.$queryRawUnsafe(
    `SELECT bpp.id, bpp.desa_id, bpp.kegiatan_id, bpp.tahun_anggaran,
            bpp.nama_kegiatan_spesifik, bpp.volume, bpp.lokasi, bpp.anggaran_usulan,
            bpp.dpmd_status, bpp.judul_proposal,
            d.nama AS nama_desa, d.kecamatan_id, k.nama AS nama_kecamatan,
            mk.nama_kegiatan,
            EXISTS (
              SELECT 1 FROM bankeu_perubahan_lpj l
              WHERE l.desa_id = bpp.desa_id
                AND l.tahun_anggaran = bpp.tahun_anggaran
                AND l.status = 'approved'
            ) AS ada_lpj
     FROM bankeu_perubahan_proposals bpp
     JOIN desas d ON d.id = bpp.desa_id
     LEFT JOIN kecamatans k ON k.id = d.kecamatan_id
     LEFT JOIN bankeu_perubahan_master_kegiatan mk ON mk.id = bpp.kegiatan_id
     WHERE bpp.kegiatan_id IN (${Object.keys(KEGIATAN_PERUBAHAN).join(',')})
       ${tahun ? 'AND bpp.tahun_anggaran = ?' : ''}`,
    ...(tahun ? [tahun] : [])
  );

  return rows.map((row) => ({
    id: `ubh-${toNumber(row.id)}`,
    sumber: 'perubahan',
    sumber_label: 'Bankeu Perubahan',
    kategori: KEGIATAN_PERUBAHAN[row.kegiatan_id] || 'lainnya',
    tahun: toNumber(row.tahun_anggaran),
    desa_id: toNumber(row.desa_id),
    nama_desa: row.nama_desa,
    kecamatan_id: toNumber(row.kecamatan_id),
    nama_kecamatan: row.nama_kecamatan || 'Tidak Diketahui',
    nama_kegiatan: row.nama_kegiatan_spesifik || row.nama_kegiatan || row.judul_proposal,
    volume_teks: row.volume,
    lokasi_teks: row.lokasi,
    anggaran: toNumber(row.anggaran_usulan),
    disetujui: row.dpmd_status === 'approved',
    selesai: Boolean(toNumber(row.ada_lpj)),
  }));
};

const fetchKoordinatDesa = async () => {
  const rows = await prisma.$queryRawUnsafe(
    `SELECT desa_id, latitude, longitude FROM profil_desas
     WHERE latitude IS NOT NULL AND longitude IS NOT NULL`
  );
  const map = new Map();
  for (const row of rows) {
    const koordinat = cleanKoordinat(row.latitude, row.longitude);
    if (koordinat) map.set(toNumber(row.desa_id), koordinat);
  }
  return map;
};

// ============================================================
// Entry point
// ============================================================
/**
 * @param {{ tahun?: number|string, kategori?: string, sumber?: string, status?: string }} options
 */
const getOutputInfrastruktur = async (options = {}) => {
  const tahun = options.tahun && options.tahun !== 'semua' ? parseInt(options.tahun, 10) : null;
  const kategoriFilter = options.kategori && options.kategori !== 'semua' ? options.kategori : null;
  const sumberFilter = options.sumber && options.sumber !== 'semua' ? options.sumber : null;
  const status = STATUS[options.status] ? options.status : 'disetujui';

  const [reguler, perubahan, koordinatDesa] = await Promise.all([
    fetchReguler(tahun),
    fetchPerubahan(tahun),
    fetchKoordinatDesa(),
  ]);

  const semua = [...reguler, ...perubahan].map((item) => {
    const meta = KATEGORI[item.kategori] || KATEGORI.lainnya;
    return {
      ...item,
      kategori_label: meta.label,
      satuan: meta.satuan,
      panjang_m: meta.satuan === 'meter' ? parsePanjangMeter(item.volume_teks) : null,
    };
  });

  // Hitungan per status selalu dari kumpulan penuh, supaya pemakai bisa
  // melihat konsekuensi tiap pilihan sebelum menggantinya.
  const perStatus = {
    usulan: semua.length,
    disetujui: semua.filter((item) => item.disetujui).length,
    selesai: semua.filter((item) => item.selesai).length,
  };

  const lolosStatus = (item) => {
    if (status === 'disetujui') return item.disetujui;
    if (status === 'selesai') return item.selesai;
    return true;
  };

  const items = semua.filter(
    (item) =>
      lolosStatus(item) &&
      (!kategoriFilter || item.kategori === kategoriFilter) &&
      (!sumberFilter || item.sumber === sumberFilter)
  );

  // ---------- Agregasi ----------
  const ringkasan = emptyBucket();
  const perKategori = new Map();
  const perKecamatan = new Map();
  const perDesa = new Map();
  const perTahun = new Map();

  for (const item of items) {
    addToBucket(ringkasan, item);

    if (!perKategori.has(item.kategori)) perKategori.set(item.kategori, emptyBucket());
    addToBucket(perKategori.get(item.kategori), item);

    if (!perKecamatan.has(item.kecamatan_id)) {
      perKecamatan.set(item.kecamatan_id, { ...emptyBucket(), nama: item.nama_kecamatan, desa: new Set() });
    }
    const kecamatan = perKecamatan.get(item.kecamatan_id);
    addToBucket(kecamatan, item);
    kecamatan.desa.add(item.desa_id);

    if (!perDesa.has(item.desa_id)) {
      perDesa.set(item.desa_id, {
        ...emptyBucket(),
        desa_id: item.desa_id,
        nama_desa: item.nama_desa,
        nama_kecamatan: item.nama_kecamatan,
        kategori: {},
      });
    }
    const desa = perDesa.get(item.desa_id);
    addToBucket(desa, item);
    desa.kategori[item.kategori] = (desa.kategori[item.kategori] || 0) + 1;

    if (!perTahun.has(item.tahun)) perTahun.set(item.tahun, emptyBucket());
    addToBucket(perTahun.get(item.tahun), item);
  }

  // ---------- Titik peta ----------
  const titik = [];
  let desaTanpaKoordinat = 0;
  let ruasTanpaKoordinat = 0;
  for (const desa of perDesa.values()) {
    const koordinat = koordinatDesa.get(desa.desa_id);
    if (!koordinat) {
      desaTanpaKoordinat += 1;
      ruasTanpaKoordinat += desa.ruas;
      continue;
    }
    titik.push({
      desa_id: desa.desa_id,
      nama_desa: desa.nama_desa,
      nama_kecamatan: desa.nama_kecamatan,
      lat: koordinat.lat,
      lng: koordinat.lng,
      ruas: desa.ruas,
      panjang_m: Math.round(desa.panjang_m),
      anggaran: desa.anggaran,
      kategori: desa.kategori,
    });
  }
  titik.sort((a, b) => b.panjang_m - a.panjang_m);

  const totalDesaSistem = toNumber(
    (await prisma.$queryRawUnsafe(`SELECT COUNT(*) AS total FROM desas`))[0]?.total
  );

  return {
    filter: {
      tahun: tahun || 'semua',
      kategori: kategoriFilter || 'semua',
      sumber: sumberFilter || 'semua',
      status,
    },
    opsi: {
      tahun: [...new Set(semua.map((item) => item.tahun))].sort((a, b) => b - a),
      kategori: Object.entries(KATEGORI).map(([key, meta]) => ({ key, ...meta })),
      status: Object.entries(STATUS).map(([key, label]) => ({ key, label, jumlah: perStatus[key] })),
      sumber: [
        { key: 'reguler', label: 'Bankeu Reguler' },
        { key: 'perubahan', label: 'Bankeu Perubahan' },
      ],
    },
    ringkasan: {
      ...ringkasan,
      panjang_m: Math.round(ringkasan.panjang_m),
      desa: perDesa.size,
      kecamatan: perKecamatan.size,
      total_desa_sistem: totalDesaSistem,
    },
    per_kategori: [...perKategori.entries()]
      .map(([key, bucket]) => ({
        key,
        label: KATEGORI[key].label,
        satuan: KATEGORI[key].satuan,
        slot: KATEGORI[key].slot,
        ...bucket,
        panjang_m: Math.round(bucket.panjang_m),
      }))
      .sort((a, b) => b.ruas - a.ruas),
    per_kecamatan: [...perKecamatan.entries()]
      .map(([id, bucket]) => ({
        kecamatan_id: id,
        nama: bucket.nama,
        ruas: bucket.ruas,
        panjang_m: Math.round(bucket.panjang_m),
        anggaran: bucket.anggaran,
        desa: bucket.desa.size,
        terbaca: bucket.terbaca,
        tidak_terbaca: bucket.tidak_terbaca,
      }))
      .sort((a, b) => b.panjang_m - a.panjang_m),
    per_tahun: [...perTahun.entries()]
      .map(([tahunItem, bucket]) => ({
        tahun: tahunItem,
        ...bucket,
        panjang_m: Math.round(bucket.panjang_m),
      }))
      .sort((a, b) => a.tahun - b.tahun),
    peta: {
      titik,
      desa_terpetakan: titik.length,
      desa_tanpa_koordinat: desaTanpaKoordinat,
      ruas_tanpa_koordinat: ruasTanpaKoordinat,
      desa_berkoordinat_sistem: koordinatDesa.size,
    },
    // Label kategori/sumber sengaja tidak diulang per baris — frontend
    // menyusunnya dari `opsi`, dan daftar ini bisa ribuan baris.
    daftar: items
      .map((item) => ({
        id: item.id,
        sumber: item.sumber,
        tahun: item.tahun,
        kategori: item.kategori,
        desa_id: item.desa_id,
        nama_desa: item.nama_desa,
        nama_kecamatan: item.nama_kecamatan,
        nama_kegiatan: item.nama_kegiatan,
        lokasi: item.lokasi_teks,
        volume: item.volume_teks,
        panjang_m: item.panjang_m,
        anggaran: item.anggaran,
        disetujui: item.disetujui,
        selesai: item.selesai,
      }))
      .sort((a, b) => (b.panjang_m || 0) - (a.panjang_m || 0)),
    generated_at: new Date().toISOString(),
  };
};

module.exports = { getOutputInfrastruktur, parsePanjangMeter, KATEGORI };
