/**
 * Controller Asta Desa — sumbernya API super admin ASTA DESA.
 *
 * Bentuk endpointnya sengaja TIDAK meniru API asalnya satu-per-satu. API di sana
 * berpaginasi 200 baris; halaman Core Dashboard butuh angka se-kabupaten. Kalau
 * frontend disuruh menyusuri 40 halaman sendiri, satu kali buka halaman berarti
 * 40 permintaan lintas-jaringan dan peta yang menetas sepotong-sepotong. Jadi
 * penyusuran + agregasinya dilakukan di sini, di dekat cache, dan frontend cukup
 * memanggil satu endpoint per kartu.
 *
 * SOAL NAMA KOLOM. Tabel `sensuses` di ASTA DESA punya ~100 kolom dan dokumen
 * API-nya hanya menyebut sebagian. Ketimbang mematok satu nama dan pecah senyap
 * begitu mereka menamainya lain, tiap nilai dicari lewat daftar kandidat nama
 * (lihat `pilih`). Bila suatu saat ada kolom baru yang relevan, tambahkan nama
 * barunya ke daftar — jangan ganti yang lama, supaya versi lama tetap terbaca.
 */

const asta = require('../services/astadesa.service');

// ── Pembantu ─────────────────────────────────────────────────────────────────

/** Nilai pertama yang benar-benar ada dari sederet kemungkinan nama kolom. */
const pilih = (obj, kandidat) => {
  if (!obj) return null;
  for (const k of kandidat) {
    const v = obj[k];
    if (v !== undefined && v !== null && v !== '') return v;
  }
  return null;
};

/**
 * Angka, atau null bila memang tidak ada angkanya.
 *
 * Penjagaan null/''/undefined di depan itu WAJIB, bukan kehati-hatian berlebih:
 * `Number(null)` dan `Number('')` keduanya bernilai 0 dan lolos
 * `Number.isFinite`. Tanpa penjagaan ini, baris tanpa koordinat terbaca sebagai
 * koordinat 0,0 dan setiap anggota keluarga tanpa umur terhitung berusia 0 tahun
 * — piramida usia akan menumpuk seluruh data yang kosong ke kelompok 0–4.
 */
const keAngka = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const rapikan = (v) => (v === null || v === undefined ? null : String(v).trim() || null);

const KUNCI_KECAMATAN = ['kecamatan', 'nama_kecamatan', 'kecamatan_nama', 'kec'];
const KUNCI_DESA = ['desa', 'nama_desa', 'desa_nama', 'kelurahan'];
const KUNCI_STATUS = ['status', 'status_verifikasi', 'status_sensus'];
const KUNCI_PETUGAS = ['nama_petugas', 'petugas', 'surveyor', 'nama_surveyor'];

/**
 * Nama petugas pendata.
 *
 * ASTA DESA mengirim `petugas` sebagai OBJEK — `{user_id, nama, nip, no_tlp,
 * akun:{id,name,email}}` — bukan string. Tanpa penanganan ini, `String(objek)`
 * menghasilkan "[object Object]", dan seluruh daftar produktivitas petugas akan
 * berisi satu baris bernama "[object Object]" dengan jumlah = seluruh sensus.
 *
 * `akun.name` dipakai sebagai cadangan: sebagian baris lama punya akun tetapi
 * kolom `nama` petugasnya kosong.
 */
const namaPetugas = (row) => {
  const nilai = pilih(row, KUNCI_PETUGAS);
  if (nilai && typeof nilai === 'object') {
    return rapikan(nilai.nama || nilai.name || nilai.akun?.name || nilai.akun?.nama);
  }
  return rapikan(nilai);
};

/**
 * Daftar nama peran seorang pengguna.
 *
 * Rolenya dikelola Spatie dan diserialkan sebagai ARRAY — `["surveyor"]` — jadi
 * satu pengguna bisa punya lebih dari satu peran, dan `String(array)` pada kasus
 * dua peran menghasilkan "surveyor,verifikator_desa": satu ember palsu yang
 * bukan peran mana pun. Anggota array boleh berupa string atau objek `{name}`,
 * tergantung versi serialisasinya.
 */
const namaRole = (user) => {
  const mentah = user?.roles ?? user?.role ?? user?.peran;
  const daftar = Array.isArray(mentah) ? mentah : mentah ? [mentah] : [];
  return daftar
    .map((r) => rapikan(typeof r === 'object' ? r?.name || r?.nama : r))
    .filter(Boolean);
};
const KUNCI_TANGGAL = ['tanggal_pendataan', 'tanggal', 'created_at', 'tgl_pendataan'];
const KUNCI_LAT = ['latitude', 'lat', 'lintang', 'kk_latitude', 'koordinat_lat', 'lokasi_lat', 'rumah_lat'];
// 'lon' ada di depan karena itulah nama yang benar-benar dipakai ASTA DESA
// (diperiksa langsung ke API produksi). Nilainya string, mis. "106.59887941" —
// keAngka menerimanya.
const KUNCI_LNG = ['lon', 'longitude', 'lng', 'long', 'bujur', 'kk_longitude', 'koordinat_lng', 'lokasi_lng', 'lokasi_lon', 'rumah_lon'];
const KUNCI_NAMA_KK = ['kk_nama', 'nama_kk', 'nama_kepala_keluarga', 'kepala_keluarga'];

/**
 * Wadah tempat koordinat mungkin berada: barisnya sendiri, lalu objek-objek
 * bersarang yang lazim dipakai.
 *
 * INI BUKAN KEHATI-HATIAN BERLEBIH. Pada `/sensuses`, ASTA DESA mengirim
 * koordinat sebagai objek bersarang — `"lokasi": { "lat": "-6.40…", "lon":
 * "106.59…" }` — sementara pada `/sensuses/{id}` ia rata sebagai `lokasi_lat` /
 * `lokasi_lon`. Mencari hanya di tingkat atas membuat SELURUH 2.503 baris
 * terbaca tanpa koordinat dan peta sebaran tampil kosong sama sekali, padahal
 * 95% barisnya berkoordinat. Gejalanya senyap: tidak ada galat, hanya peta
 * kosong yang terbaca sebagai "memang belum ada yang didata".
 */
const WADAH_KOORDINAT = ['lokasi', 'koordinat', 'coordinates', 'geo', 'rumah', 'lokasi_rumah'];

const wadahKoordinat = (row) => {
  const daftar = [row];
  WADAH_KOORDINAT.forEach((k) => {
    const v = row?.[k];
    if (v && typeof v === 'object' && !Array.isArray(v)) daftar.push(v);
  });
  return daftar;
};

/**
 * Koordinat sebuah baris, atau null bila tidak masuk akal.
 *
 * Penyaringan wilayah ini bukan kerewelan. Baris sensus lapangan kerap berisi
 * 0/0, koordinat tertukar (lat diisi bujur), atau sisa data uji dari kota lain.
 * Satu titik 0,0 saja sudah cukup membuat peta melompat ke Teluk Guinea dan
 * seluruh sebaran Kabupaten Bogor mengerut jadi sebutir debu.
 */
const koordinat = (row) => {
  let lat = null;
  let lng = null;

  // Wadah yang memberi KEDUA nilai sekaligus yang dipakai — supaya lintang dari
  // satu tempat tidak pernah berpasangan dengan bujur dari tempat lain.
  for (const wadah of wadahKoordinat(row)) {
    const a = keAngka(pilih(wadah, KUNCI_LAT));
    const b = keAngka(pilih(wadah, KUNCI_LNG));
    if (a !== null && b !== null) {
      lat = a;
      lng = b;
      break;
    }
  }

  // Sebagian aplikasi lapangan menyimpan koordinat sebagai satu string
  // "-6.5,106.8". Ditangani di sini supaya baris seperti itu tidak hilang.
  // Penjagaan tipe-string itu perlu: kalau `lokasi` berupa objek, `String(objek)`
  // menghasilkan "[object Object]" dan cabang ini hanya berpura-pura mencoba.
  if (lat === null || lng === null) {
    const mentah = pilih(row, ['koordinat', 'coordinates', 'latlng', 'lokasi']);
    const gabung = typeof mentah === 'string' ? rapikan(mentah) : null;
    if (gabung && gabung.includes(',')) {
      const [a, b] = gabung.split(',').map((s) => keAngka(s));
      if (a !== null && b !== null) {
        lat = a;
        lng = b;
      }
    }
  }

  if (lat === null || lng === null) return null;
  if (lat === 0 && lng === 0) return null;

  // Lat/lng tertukar. Kabupaten Bogor ada di lintang ≈ -6 (|lat| kecil) dan
  // bujur ≈ 106–107 (|lng| besar); bila polanya terbalik, nilainya memang
  // tertukar saat penyimpanan — dibetulkan ketimbang dibuang, karena baris
  // seperti ini datang per-perangkat dan bisa berjumlah ratusan.
  if (Math.abs(lat) > 12 && Math.abs(lng) <= 12) {
    const tukar = lat;
    lat = lng;
    lng = tukar;
  }

  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;

  return { lat, lng };
};

/**
 * Kotak wilayah Kabupaten Bogor, dilebihkan sedikit di setiap sisi.
 *
 * Kabupaten Bogor sesungguhnya berada di lintang ≈ -6,95..-6,23 dan bujur
 * ≈ 106,35..107,10; batas di bawah dilonggarkan agar desa di tepi tidak ikut
 * tersapu. Dipakai HANYA untuk memutuskan apa yang digambar di peta — barisnya
 * sendiri tidak pernah dibuang dari tabel maupun rekap.
 *
 * Alasannya konkret: data produksi memuat satu baris di Kec. Lindu, Desa Tomado
 * (Sulawesi Tengah, ≈ -1,35 / 120,20) — sisa uji coba. Peta memuat bingkainya
 * dari seluruh titik, jadi satu baris itu saja sudah cukup membentangkan peta
 * dari Bogor sampai Sulawesi dan mengerutkan 2.488 titik sungguhan menjadi
 * segumpal noda di sudut.
 */
const KOTAK_KAB_BOGOR = { latMin: -7.1, latMax: -6.0, lngMin: 106.2, lngMax: 107.4 };

const diKabupatenBogor = (lat, lng) =>
  lat >= KOTAK_KAB_BOGOR.latMin &&
  lat <= KOTAK_KAB_BOGOR.latMax &&
  lng >= KOTAK_KAB_BOGOR.lngMin &&
  lng <= KOTAK_KAB_BOGOR.lngMax;

/** Bentuk ringkas satu baris sensus — dipakai tabel, peta, dan rekap. */
const normalSensus = (row) => {
  const titik = koordinat(row);
  return {
    id: row.id ?? row.sensus_id ?? null,
    kecamatan: rapikan(pilih(row, KUNCI_KECAMATAN)) || 'Tidak diketahui',
    desa: rapikan(pilih(row, KUNCI_DESA)) || 'Tidak diketahui',
    status: rapikan(pilih(row, KUNCI_STATUS)) || 'tidak diketahui',
    petugas: namaPetugas(row),
    tanggal: rapikan(pilih(row, KUNCI_TANGGAL)),
    kk_nama: rapikan(pilih(row, KUNCI_NAMA_KK)),
    kk_nik: rapikan(pilih(row, ['kk_nik', 'nik'])),
    kk_no_kk: rapikan(pilih(row, ['kk_no_kk', 'no_kk'])),
    jumlah_anggota: keAngka(pilih(row, ['anggotas_count', 'jumlah_anggota', 'jml_anggota', 'total_anggota'])),
    lat: titik ? titik.lat : null,
    lng: titik ? titik.lng : null
  };
};

/** Hanya tanggalnya (YYYY-MM-DD) dari nilai tanggal apa pun bentuknya. */
const keHari = (nilai) => {
  if (!nilai) return null;
  const s = String(nilai);
  const cocok = s.match(/^(\d{4}-\d{2}-\d{2})/);
  if (cocok) return cocok[1];
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
};

/** Naikkan hitungan di Map, membuat entri bila belum ada. */
const tambah = (map, kunci, jumlah = 1) => {
  map.set(kunci, (map.get(kunci) || 0) + jumlah);
};

const keDaftar = (map, namaKunci = 'label') =>
  Array.from(map.entries())
    .map(([k, v]) => ({ [namaKunci]: k, total: v }))
    .sort((a, b) => b.total - a.total);

/**
 * Bentuk `meta` yang seragam untuk frontend.
 *
 * ASTA DESA tidak konsisten: /sensuses dan /users membalas paginator BERSARANG
 * (`meta.current_page`), sedangkan /messages membalas paginator RATA —
 * `current_page`, `last_page`, `total` langsung di akar respons (diperiksa ke
 * API produksi: 36 pesan, 18 halaman). Tanpa perataan ini `meta` untuk pesan
 * selalu null, dan tombol "berikutnya" di halaman mati sejak awal karena
 * frontend mengira hanya ada satu halaman.
 */
const metaDari = (body) => {
  if (body?.meta && typeof body.meta === 'object') return body.meta;
  if (body?.current_page === undefined || body?.current_page === null) return null;
  return {
    current_page: Number(body.current_page) || 1,
    last_page: Number(body.last_page) || 1,
    per_page: Number(body.per_page) || null,
    total: Number(body.total) || 0,
    from: body.from ?? null,
    to: body.to ?? null
  };
};

/** Balut galat AstaDesaError menjadi respons JSON yang sopan. */
const jalankan = (handler) => async (req, res) => {
  try {
    await handler(req, res);
  } catch (err) {
    const status = err.status || 500;
    if (status >= 500 && status !== 503) {
      console.error('[asta-desa]', err.message);
    }
    res.status(status).json({
      success: false,
      message: err.message || 'Gagal mengambil data Asta Desa',
      ...(err.detail ? { detail: err.detail } : {})
    });
  }
};

const paksa = (req) => req.query.force === '1' || req.query.force === 'true';

// ── Endpoint ────────────────────────────────────────────────────────────────

/**
 * GET /api/asta-desa/status
 * Apakah integrasinya siap dipakai. Dipanggil lebih dulu oleh halaman supaya
 * server yang belum diisi kredensial memunculkan petunjuk pemasangan, bukan
 * tembok galat merah yang tidak memberi tahu apa yang harus dilakukan.
 */
exports.getStatus = jalankan(async (req, res) => {
  res.json({
    success: true,
    data: {
      terkonfigurasi: asta.terkonfigurasi(),
      base_url: asta.BASE_URL,
      ttl_ms: asta.TTL_MS
    }
  });
});

/**
 * GET /api/asta-desa/ringkasan
 * Satu panggilan untuk seluruh bagian atas halaman: angka ringkasan resmi dari
 * /summary, ditambah rekap yang hanya bisa dihitung dari seluruh baris sensus.
 */
exports.getRingkasan = jalankan(async (req, res) => {
  const force = paksa(req);

  // /summary boleh gagal tanpa menjatuhkan halaman: rekap di bawah dihitung
  // dari baris sensus dan tetap berguna sendiri.
  const [ringkasanApi, semua] = await Promise.all([
    asta.ambil('/summary', {}, { force }).catch(() => null),
    asta.ambilSemua('/sensuses', {}, { force })
  ]);

  const baris = semua.rows.map(normalSensus);

  const perKecamatan = new Map(); // kecamatan -> { total, desa:Set, status:Map, berkoordinat }
  const perStatus = new Map();
  const perPetugas = new Map(); // petugas -> { total, kecamatan:Set }
  const perHari = new Map();
  const perDesa = new Map(); // "kec|desa" -> { kecamatan, desa, total }
  let berkoordinat = 0;
  let totalAnggota = 0;

  baris.forEach((r) => {
    const kec = perKecamatan.get(r.kecamatan) || {
      total: 0,
      desa: new Set(),
      status: new Map(),
      berkoordinat: 0
    };
    kec.total += 1;
    kec.desa.add(r.desa);
    tambah(kec.status, r.status);
    if (r.lat !== null) kec.berkoordinat += 1;
    perKecamatan.set(r.kecamatan, kec);

    tambah(perStatus, r.status);

    if (r.petugas) {
      const p = perPetugas.get(r.petugas) || { total: 0, kecamatan: new Set() };
      p.total += 1;
      p.kecamatan.add(r.kecamatan);
      perPetugas.set(r.petugas, p);
    }

    const hari = keHari(r.tanggal);
    if (hari) tambah(perHari, hari);

    const kunciDesa = `${r.kecamatan}|${r.desa}`;
    const d = perDesa.get(kunciDesa) || { kecamatan: r.kecamatan, desa: r.desa, total: 0 };
    d.total += 1;
    perDesa.set(kunciDesa, d);

    if (r.lat !== null) berkoordinat += 1;
    if (r.jumlah_anggota) totalAnggota += r.jumlah_anggota;
  });

  res.json({
    success: true,
    data: {
      // Apa adanya dari ASTA DESA. Angka resmi mereka tetap ditampilkan
      // berdampingan dengan hitungan kita supaya selisih apa pun terlihat,
      // bukan tersembunyi di balik satu angka pilihan.
      summary: ringkasanApi?.data ?? ringkasanApi ?? null,

      total_sensus: baris.length,
      total_kecamatan: perKecamatan.size,
      total_desa: perDesa.size,
      total_petugas: perPetugas.size,
      total_anggota_tercatat: totalAnggota || null,
      berkoordinat,

      per_kecamatan: Array.from(perKecamatan.entries())
        .map(([kecamatan, v]) => ({
          kecamatan,
          total: v.total,
          total_desa: v.desa.size,
          berkoordinat: v.berkoordinat,
          per_status: keDaftar(v.status, 'status')
        }))
        .sort((a, b) => b.total - a.total),

      per_desa: Array.from(perDesa.values()).sort((a, b) => b.total - a.total),
      per_status: keDaftar(perStatus, 'status'),

      petugas: Array.from(perPetugas.entries())
        .map(([nama, v]) => ({ nama, total: v.total, kecamatan: Array.from(v.kecamatan) }))
        .sort((a, b) => b.total - a.total),

      tren: Array.from(perHari.entries())
        .map(([tanggal, total]) => ({ tanggal, total }))
        .sort((a, b) => a.tanggal.localeCompare(b.tanggal)),

      // Kejujuran soal kelengkapan. Bila penyusuran terhenti di pagar batas
      // baris, angka di atas adalah angka sebagian — dan halaman harus bisa
      // mengatakannya, bukan menyajikannya sebagai total resmi.
      sebagian: semua.truncated,
      diambil_pada: new Date().toISOString()
    }
  });
});

/**
 * GET /api/asta-desa/sebaran
 * Titik-titik untuk peta. Baris tanpa koordinat sah dibuang di sini — peta tidak
 * bisa menggambarnya — tetapi jumlahnya dilaporkan supaya pembaca tahu peta ini
 * mewakili berapa persen data.
 */
exports.getSebaran = jalankan(async (req, res) => {
  const force = paksa(req);
  const semua = await asta.ambilSemua('/sensuses', {}, { force });
  const baris = semua.rows.map(normalSensus);

  const berkoordinat = baris.filter((r) => r.lat !== null);
  const diDalamWilayah = berkoordinat.filter((r) => diKabupatenBogor(r.lat, r.lng));

  const titik = diDalamWilayah
    .map((r) => ({
      id: r.id,
      lat: r.lat,
      lng: r.lng,
      kecamatan: r.kecamatan,
      desa: r.desa,
      status: r.status,
      kk_nama: r.kk_nama,
      petugas: r.petugas,
      tanggal: r.tanggal
    }));

  // Rekap per kecamatan dengan titik tengah dari rata-rata koordinat anggotanya.
  // Proyek ini tidak punya berkas GeoJSON batas kecamatan, jadi sebaran tingkat
  // kecamatan digambar sebagai gelembung berukuran jumlah — bukan choropleth.
  const perKecamatan = new Map();
  titik.forEach((t) => {
    const k = perKecamatan.get(t.kecamatan) || { total: 0, sumLat: 0, sumLng: 0, desa: new Set() };
    k.total += 1;
    k.sumLat += t.lat;
    k.sumLng += t.lng;
    k.desa.add(t.desa);
    perKecamatan.set(t.kecamatan, k);
  });

  res.json({
    success: true,
    data: {
      titik,
      per_kecamatan: Array.from(perKecamatan.entries())
        .map(([kecamatan, v]) => ({
          kecamatan,
          total: v.total,
          total_desa: v.desa.size,
          lat: v.sumLat / v.total,
          lng: v.sumLng / v.total
        }))
        .sort((a, b) => b.total - a.total),
      total_baris: baris.length,
      tanpa_koordinat: baris.length - berkoordinat.length,
      // Dilaporkan terpisah dari `tanpa_koordinat`: keduanya sama-sama tidak
      // muncul di peta, tetapi artinya berbeda. Yang satu "koordinatnya belum
      // diisi", yang satu lagi "koordinatnya salah" — dan hanya yang kedua yang
      // bisa diperbaiki dengan mendatangi barisnya di ASTA DESA.
      di_luar_wilayah: berkoordinat.length - diDalamWilayah.length,
      sebagian: semua.truncated
    }
  });
});

/**
 * GET /api/asta-desa/sensus
 * Tabel sensus. Filter & paginasinya diteruskan ke ASTA DESA apa adanya supaya
 * pencarian tetap dikerjakan di sisi yang punya indeksnya.
 */
exports.getSensus = jalankan(async (req, res) => {
  const { page, per_page, search, kecamatan, desa, status, user_id, dari, sampai } = req.query;
  const params = {
    page: page || 1,
    per_page: Math.min(Number(per_page) || 25, asta.MAX_PER_PAGE),
    search,
    kecamatan,
    desa,
    status,
    user_id,
    dari,
    sampai
  };

  const body = await asta.ambil('/sensuses', params, { force: paksa(req) });
  res.json({
    success: true,
    data: (Array.isArray(body?.data) ? body.data : []).map(normalSensus),
    meta: metaDari(body)
  });
});

/**
 * GET /api/asta-desa/sensus/:id
 * Detail satu sensus — SELURUH kolom, apa adanya, plus anggota keluarganya.
 *
 * Tidak dinormalkan. Justru di sinilah ~100 kolom itu berguna, dan menyaringnya
 * lewat daftar kandidat hanya akan membuang kolom yang belum kita kenal.
 */
exports.getSensusDetail = jalankan(async (req, res) => {
  const body = await asta.ambil(`/sensuses/${encodeURIComponent(req.params.id)}`, {}, { force: paksa(req) });
  const isi = body?.data ?? body ?? null;
  if (!isi) return res.json({ success: true, data: null });

  // BENTUK DETAIL BERBEDA DARI BENTUK DAFTAR. /sensuses membalas barisnya rata,
  // sedangkan /sensuses/{id} membalas amplop `{ sensus: {…104 kolom…}, anggotas:
  // [...], petugas: {...} }` — diperiksa langsung ke API produksi. Perbedaan itu
  // diratakan di sini menjadi satu bentuk tetap; kalau tidak, panel detail
  // membaca `data.kk_nama` pada amplop, selalu menemukan undefined, dan seluruh
  // kepala panel terisi "—" padahal datanya ada satu tingkat di bawah.
  const sensus = isi.sensus && typeof isi.sensus === 'object' ? isi.sensus : isi;

  const anggotas = Array.isArray(isi.anggotas)
    ? isi.anggotas
    : Array.isArray(sensus?.anggotas)
      ? sensus.anggotas
      : [];

  // Ketiganya dicoba berurutan: `sensus.petugas` ada tetapi bernilai null pada
  // baris yang saya periksa, sementara `data.petugas` terisi. `sensus.user` —
  // akun yang memasukkan data — dipakai paling akhir agar kolom petugas tidak
  // kosong pada baris yang tidak punya data petugas terpisah.
  const petugas = isi.petugas || sensus?.petugas || sensus?.user || null;

  res.json({ success: true, data: { sensus, anggotas, petugas } });
});

/**
 * GET /api/asta-desa/pengguna
 * Daftar pengguna + rekap peran. Rekapnya dihitung dari seluruh baris, sebab
 * "berapa surveyor aktif" tidak bisa dijawab dari satu halaman 25 baris.
 */
exports.getPengguna = jalankan(async (req, res) => {
  const force = paksa(req);
  const { role, kecamatan, desa, search, page, per_page } = req.query;

  const params = {
    page: page || 1,
    per_page: Math.min(Number(per_page) || 25, asta.MAX_PER_PAGE),
    role,
    kecamatan,
    desa,
    search
  };

  const [halaman, semua] = await Promise.all([
    asta.ambil('/users', params, { force }),
    asta.ambilSemua('/users', {}, { force })
  ]);

  const perRole = new Map();
  const perKecamatan = new Map();
  let totalSensusPerAkun = 0;
  semua.rows.forEach((u) => {
    // Pengguna berperan ganda dihitung pada SETIAP perannya, jadi jumlah seluruh
    // baris per_role bisa melebihi jumlah akun. Itu memang yang ingin dijawab —
    // "berapa akun yang boleh memverifikasi di tingkat desa" tidak berkurang
    // hanya karena orangnya juga surveyor.
    const peran = namaRole(u);
    if (peran.length === 0) tambah(perRole, 'tanpa peran');
    peran.forEach((r) => tambah(perRole, r));

    const kec = rapikan(pilih(u, KUNCI_KECAMATAN));
    if (kec) tambah(perKecamatan, kec);

    totalSensusPerAkun += keAngka(u?.sensuses_count) || 0;
  });

  res.json({
    success: true,
    data: Array.isArray(halaman?.data) ? halaman.data : [],
    meta: metaDari(halaman),
    rekap: {
      total: semua.rows.length,
      per_role: keDaftar(perRole, 'role'),
      per_kecamatan: keDaftar(perKecamatan, 'kecamatan'),
      // Jumlah sensus menurut kolom `sensuses_count` tiap akun. Berguna sebagai
      // pembanding rekap petugas di /ringkasan: yang pertama menghitung per
      // AKUN, yang kedua per NAMA petugas pada baris sensus, dan selisih di
      // antara keduanya menandakan baris yang petugasnya tidak tertaut akun.
      total_sensus_per_akun: totalSensusPerAkun,
      sebagian: semua.truncated
    }
  });
});

// Kelompok usia dipakai untuk piramida. Batasnya mengikuti kelompok yang lazim
// dipakai perencanaan desa (usia sekolah, usia produktif, lansia), bukan interval
// lima tahun BPS — halaman ini dibaca untuk mengambil keputusan program.
const KELOMPOK_USIA = [
  { label: '0–4', min: 0, max: 4 },
  { label: '5–14', min: 5, max: 14 },
  { label: '15–24', min: 15, max: 24 },
  { label: '25–39', min: 25, max: 39 },
  { label: '40–54', min: 40, max: 54 },
  { label: '55–64', min: 55, max: 64 },
  { label: '65+', min: 65, max: 200 }
];

const usiaDari = (row) => {
  const langsung = keAngka(pilih(row, ['umur', 'usia', 'age']));
  if (langsung !== null && langsung >= 0 && langsung < 130) return langsung;

  const lahir = rapikan(pilih(row, ['tanggal_lahir', 'tgl_lahir', 'birth_date']));
  if (!lahir) return null;
  const d = new Date(lahir);
  if (Number.isNaN(d.getTime())) return null;
  const tahun = (Date.now() - d.getTime()) / (365.25 * 24 * 3600 * 1000);
  return tahun >= 0 && tahun < 130 ? Math.floor(tahun) : null;
};

/**
 * GET /api/asta-desa/demografi
 * Agregat anggota keluarga: jenis kelamin, kelompok usia, pendidikan, pekerjaan.
 */
exports.getDemografi = jalankan(async (req, res) => {
  const force = paksa(req);
  const semua = await asta.ambilSemua('/sensus-anggotas', {}, { force });

  const perJk = new Map();
  const perPendidikan = new Map();
  const perPekerjaan = new Map();
  const perHubungan = new Map();
  const perDisabilitas = new Map();
  const piramida = KELOMPOK_USIA.map((k) => ({ label: k.label, L: 0, P: 0, lain: 0, total: 0 }));
  let tanpaUsia = 0;

  semua.rows.forEach((a) => {
    const jkMentah = (rapikan(pilih(a, ['jenis_kelamin', 'jk', 'gender'])) || '').toUpperCase();
    // Sumbernya tidak seragam: ada "L"/"P", ada "LAKI-LAKI"/"PEREMPUAN",
    // ada "1"/"2". Ketiganya harus jatuh ke ember yang sama.
    const jk = /^(L|1|LAKI)/.test(jkMentah) ? 'L' : /^(P|2|PEREM|WANITA)/.test(jkMentah) ? 'P' : 'lain';
    tambah(perJk, jk === 'L' ? 'Laki-laki' : jk === 'P' ? 'Perempuan' : 'Tidak diketahui');

    const pend = rapikan(pilih(a, ['pendidikan', 'pendidikan_terakhir', 'tingkat_pendidikan']));
    if (pend) tambah(perPendidikan, pend);

    // Kolom pekerjaan TIDAK ada di `sensus_anggotas` ASTA DESA per hari ini —
    // diperiksa langsung ke API produksi. Pembacaannya dibiarkan di sini supaya
    // angkanya langsung muncul bila mereka menambahkannya; frontend sudah
    // menyembunyikan panelnya selama daftarnya kosong.
    const kerja = rapikan(pilih(a, ['pekerjaan', 'jenis_pekerjaan', 'mata_pencaharian']));
    if (kerja) tambah(perPekerjaan, kerja);

    // Disabilitas justru ADA, dan nilainya berupa jenis ("Tidak", "Mental", …),
    // bukan ya/tidak — jadi dihitung sebagai kategori, bukan sebagai sakelar.
    const disabilitas = rapikan(pilih(a, ['disabilitas', 'jenis_disabilitas']));
    if (disabilitas) tambah(perDisabilitas, disabilitas);

    const hub = rapikan(pilih(a, ['hubungan_kk', 'hubungan_keluarga', 'hubungan', 'status_hubungan', 'shdk']));
    if (hub) tambah(perHubungan, hub);

    const usia = usiaDari(a);
    if (usia === null) {
      tanpaUsia += 1;
      return;
    }
    const idx = KELOMPOK_USIA.findIndex((k) => usia >= k.min && usia <= k.max);
    if (idx >= 0) {
      piramida[idx][jk] += 1;
      piramida[idx].total += 1;
    }
  });

  res.json({
    success: true,
    data: {
      total_anggota: semua.rows.length,
      per_jenis_kelamin: keDaftar(perJk, 'label'),
      piramida,
      tanpa_usia: tanpaUsia,
      per_pendidikan: keDaftar(perPendidikan, 'label'),
      per_pekerjaan: keDaftar(perPekerjaan, 'label').slice(0, 20),
      per_hubungan: keDaftar(perHubungan, 'label'),
      per_disabilitas: keDaftar(perDisabilitas, 'label'),
      sebagian: semua.truncated
    }
  });
});

/** GET /api/asta-desa/layer — daftar layer peta ASTA DESA. */
exports.getLayer = jalankan(async (req, res) => {
  const body = await asta.ambil('/layers', {}, { force: paksa(req) });
  res.json({ success: true, data: Array.isArray(body?.data) ? body.data : [] });
});

/** GET /api/asta-desa/pesan — riwayat pesan (berpaginasi). */
exports.getPesan = jalankan(async (req, res) => {
  const params = {
    page: req.query.page || 1,
    per_page: Math.min(Number(req.query.per_page) || 25, asta.MAX_PER_PAGE)
  };
  const body = await asta.ambil('/messages', params, { force: paksa(req) });
  res.json({
    success: true,
    data: Array.isArray(body?.data) ? body.data : [],
    meta: metaDari(body)
  });
});

/**
 * POST /api/asta-desa/segarkan
 * Buang cache supaya permintaan berikutnya menarik data segar. Tombol "muat
 * ulang" di halaman memanggil ini; tanpa itu, data tertahan sampai TTL habis
 * dan pengguna yang tahu ada sensus baru masuk tidak punya cara melihatnya.
 */
exports.segarkan = jalankan(async (req, res) => {
  asta.bersihkanCache();
  res.json({ success: true, message: 'Cache Asta Desa dibersihkan' });
});
