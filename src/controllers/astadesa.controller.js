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

/**
 * Umur cache untuk angka pokok — jumlah keluarga terdata se-kabupaten.
 *
 * Satu menit, bukan sepuluh seperti sisanya. Saat pendataan sedang ramai, laju
 * masuknya baris terukur ±3 per menit; dengan TTL sepuluh menit angka "Keluarga
 * Terdata" bisa tertinggal ±30 baris di belakang panel ASTA DESA, dan selisih
 * itulah yang selama ini terbaca sebagai "datanya tidak sinkron".
 *
 * Boleh sependek ini karena yang diambil cuma `meta.total` dari SATU baris
 * (`per_page=1`) — terukur ±80 ms. Yang mahal adalah penyusuran 21 halaman, dan
 * itu tetap memakai TTL panjang: rekap kecamatan, tren harian, dan produktivitas
 * petugas tidak berubah berarti dalam sepuluh menit.
 */
const TTL_ANGKA_POKOK = 60 * 1000;

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

/**
 * NIK/no. KK yang disamarkan: 6 digit pertama, sisanya bintang.
 *
 * Bentuknya mengikuti penyamaran di ASTA DESA (`substr(0,6) . '**********'`)
 * supaya pencarian di halaman peta mengenai persis apa yang dikenai panel
 * mereka — bukan lebih banyak, bukan lebih sedikit.
 */
const samarkanNomor = (v) => {
  const s = rapikan(v);
  return s ? `${s.slice(0, 6)}**********` : null;
};

/**
 * URL foto rumah pertama sebuah baris sensus, atau null.
 *
 * MENGAPA DIAMBIL DI SINI, BUKAN DARI ENDPOINT DETAIL. Foto disimpan Spatie
 * Media Library, bukan di kolom `foto_rumah` (kolom JSON itu ada tetapi bukan
 * tempat berkasnya). Endpoint `/admin/sensuses/{id}` membalas `$sensus->toArray()`
 * tanpa memuat relasi media dan tanpa menambahkan `foto_rumah_urls`, sehingga
 * URL fotonya TIDAK PERNAH ada di sana — panel info yang menunggu foto dari
 * situ akan selamanya kosong meski fotonya ada di ASTA DESA.
 *
 * `/v1/sensuses` — yang memang sudah disusuri endpoint ini — menambahkan
 * `foto_rumah_urls` dan memuat relasi `media`. Jadi fotonya diambil di sini dan
 * ikut bersama titiknya: satu string per baris, tanpa permintaan tambahan, dan
 * langsung tampil begitu titiknya diklik.
 */
const fotoRumahPertama = (row) => {
  const daftar = row?.foto_rumah_urls;
  if (Array.isArray(daftar)) {
    const url = daftar.find((v) => typeof v === 'string' && /^https?:\/\//.test(v));
    if (url) return url;
  }

  // Cadangan: baca langsung dari relasi media bila bentuk _urls berubah.
  const media = Array.isArray(row?.media) ? row.media : [];
  const berkas = media.find((m) => m?.collection_name === 'foto_rumah');
  const url = berkas?.original_url || berkas?.url;
  return typeof url === 'string' && /^https?:\/\//.test(url) ? url : null;
};

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

/**
 * Profil penyusuran `/admin/sensuses`: baris disimpan dalam bentuk ringkas
 * (normalSensus), bukan mentah. Aman dinormalkan ulang di endpoint karena
 * normalSensus membaca kembali kunci keluarannya sendiri (kecamatan, lat, lng, …).
 */
const PROFIL_ADMIN = { nama: 'ringkas', ringkas: (row) => normalSensus(row) };

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

/**
 * Berapa halaman paling banyak ditarik saat menyusul baris terbaru.
 *
 * Sepuluh halaman = 2.000 baris. Laju masuknya pendataan terukur ±3 baris per
 * menit, jadi dalam satu TTL penyusuran (30 menit) yang tertinggal paling
 * banyak ratusan baris — sepuluh halaman memberi kelonggaran berkali-kali di
 * atasnya. Bila pagar ini sampai tersentuh, ekspor TIDAK dilanjutkan: artinya
 * ada lonjakan yang membuat potretnya memang harus disusun ulang dari awal,
 * bukan ditambal.
 */
const MAX_HALAMAN_SUSULAN = Number(process.env.ASTADESA_MAX_HALAMAN_SUSULAN || 10);

/** Isi satu halaman paginator, apa pun dari tiga bentuk amplop yang dipakai ASTA DESA. */
const bacaHalaman = (body) => {
  const amplop = body?.data && !Array.isArray(body.data) ? body.data : body;
  const rows = Array.isArray(amplop?.data) ? amplop.data : Array.isArray(body?.data) ? body.data : [];
  const halamanAkhir =
    Number(amplop?.last_page ?? amplop?.meta?.last_page ?? body?.meta?.last_page ?? body?.last_page ?? 1) || 1;
  const total = Number(amplop?.total ?? body?.meta?.total ?? body?.total);
  return { rows, halamanAkhir, total: Number.isFinite(total) ? total : null };
};

const idBaris = (r) => {
  const v = r?.id ?? r?.sensus_id;
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/**
 * Tarik baris yang MASUK SETELAH potret disusun.
 *
 * INILAH yang membuat ekspor benar-benar sepadan dengan ASTA DESA, bukan
 * sekadar penolakan saat potretnya basi. Penyusuran penuh memakan menit dan
 * tidak mungkin ditunggu oleh satu permintaan HTTP; tetapi yang berubah sejak
 * potret disusun hampir seluruhnya BARIS BARU, dan baris baru selalu berada di
 * ujung urutan id. Jadi yang ditarik hanya ujungnya — beberapa halaman — lalu
 * disatukan dengan potret.
 *
 * ARAH URUTAN DIDETEKSI, TIDAK DIASUMSIKAN. `/admin/sensuses` mengurut
 * `orderByDesc('id')` sehingga yang terbaru ada di halaman 1, tetapi
 * `/sensus-anggotas` belum pernah diperiksa dan paginator Laravel tanpa
 * `orderBy` eksplisit mengurut naik — di situ yang terbaru ada di halaman
 * TERAKHIR. Menebaknya salah berarti menarik 200 baris tertua berulang kali
 * dan menyimpulkan "tidak ada yang baru", persis saat ada ribuan yang baru.
 *
 * Penarikan berhenti pada halaman pertama yang TIDAK seluruhnya berisi baris
 * baru: di situlah potret dan data terkini bertemu.
 *
 * @param {number|null} idTerbesar id tertinggi yang sudah ada di potret
 * @returns {{rows: array, halaman: number, total: number|null, tuntas: boolean}}
 */
const susulBaris = async (jalur, { pengguna = false } = {}, idTerbesar) => {
  const minta = (params) =>
    pengguna
      ? asta.ambilPengguna(jalur, params, { force: true })
      : asta.ambil(jalur, params, { force: true });

  const pertama = bacaHalaman(await minta({ page: 1, per_page: asta.MAX_PER_PAGE }));
  if (idTerbesar === null || idTerbesar === undefined) {
    return { rows: [], halaman: 1, total: pertama.total, tuntas: false };
  }

  // Dua baris pertama sudah cukup menentukan arahnya. Bila halamannya hanya
  // berisi satu baris, diperlakukan sebagai urut TURUN — itulah yang dipakai
  // endpoint admin, dan satu halaman berarti seluruh datanya memang di situ.
  const idAwal = idBaris(pertama.rows[0]);
  const idAkhir = idBaris(pertama.rows[pertama.rows.length - 1]);
  const turun = pertama.rows.length < 2 || idAwal === null || idAkhir === null || idAwal >= idAkhir;

  const urutan = [];
  if (turun) for (let h = 1; h <= pertama.halamanAkhir; h += 1) urutan.push(h);
  else for (let h = pertama.halamanAkhir; h >= 1; h -= 1) urutan.push(h);

  const baru = [];
  let halaman = 0;
  let tuntas = false;

  for (const nomor of urutan) {
    if (halaman >= MAX_HALAMAN_SUSULAN) break;
    const isi = nomor === 1 && turun ? pertama : bacaHalaman(await minta({ page: nomor, per_page: asta.MAX_PER_PAGE }));
    halaman += 1;
    if (!isi.rows.length) {
      tuntas = true;
      break;
    }
    let jumlahBaru = 0;
    isi.rows.forEach((r) => {
      const id = idBaris(r);
      if (id !== null && id > idTerbesar) {
        baru.push(r);
        jumlahBaru += 1;
      }
    });
    // Halaman yang tidak seluruhnya baru berarti kita sudah menyentuh baris
    // yang ada di potret — tidak ada lagi yang perlu disusul.
    if (jumlahBaru < isi.rows.length) {
      tuntas = true;
      break;
    }
  }

  return { rows: baru, halaman, total: pertama.total, tuntas };
};

/** id tertinggi di antara baris potret (yang barisnya memang disimpan). */
const idTerbesarBaris = (rows) => {
  let maks = null;
  for (const r of rows || []) {
    const id = idBaris(r);
    if (id !== null && (maks === null || id > maks)) maks = id;
  }
  return maks;
};

/**
 * Hitungan keluarga terdata DETIK INI menurut ASTA DESA.
 *
 * `per_page=1` sengaja: yang dibutuhkan hanya `meta.total`, dan itulah
 * `Sensus::count()` apa adanya — angka yang sama dengan yang ditampilkan panel
 * mereka. Terukur ±160 ms, jadi boleh ditanya setiap kali ekspor diminta.
 */
const hitungTerkini = async (force = false) => {
  const body = await asta
    .ambil('/sensuses', { per_page: 1 }, { force, ttlMs: TTL_ANGKA_POKOK })
    .catch(() => null);
  const t = metaDari(body)?.total;
  return Number.isFinite(Number(t)) ? Number(t) : null;
};

/**
 * Seberapa realtime sebuah hasil penyusuran, dalam bentuk yang diteruskan apa
 * adanya ke frontend supaya tombol ekspor bisa menjelaskan dirinya sendiri.
 *
 * Selisih `total_hidup` dengan `total_snapshot` BUKAN galat — pendataan di
 * lapangan tidak berhenti selama penyusuran berlangsung. Tetapi di atas
 * toleransi ia berarti potretnya sudah ketinggalan terlalu jauh untuk dicetak,
 * dan itulah satu-satunya hal yang membedakan "boleh diekspor" dari "segarkan
 * dulu". Toleransinya sama dengan yang dipakai service saat memutuskan apakah
 * sebuah penyusuran layak disebut sebagian: 1% dari total, minimal 25 baris.
 */
const kesiapanSusur = (semua, totalHidup = null, susulan = null) => {
  const disusunPada = semua?.disusun_pada || null;
  const umurMs = disusunPada ? Math.max(0, Date.now() - new Date(disusunPada).getTime()) : null;
  const totalSnapshot = semua?.total ?? null;

  // Hitungan terkini diambil dari meta halaman yang ditarik PENYUSULAN bila
  // ada: itu permintaan paling belakangan, jadi angkanya paling sepadan dengan
  // baris yang benar-benar sedang dipegang.
  const hidup = susulan?.total ?? totalHidup;
  const barisSusulan = susulan?.rows?.length || 0;

  // Yang dibandingkan BARIS YANG DIPEGANG, bukan `meta.total` saat penyusuran.
  // `terbaca` adalah jumlah baris unik yang sungguh terkumpul; memakai
  // `total_snapshot` akan menutupi baris yang tergeser keluar paginasi di
  // tengah penyusuran — persis hal yang ingin diketahui di sini.
  const tercakup = semua?.terbaca !== undefined && semua?.terbaca !== null ? semua.terbaca + barisSusulan : null;
  const selisih = hidup !== null && tercakup !== null ? Math.max(0, hidup - tercakup) : null;
  const toleransi = Math.max(25, Math.round((hidup || totalSnapshot || 0) * 0.005));

  const siap = Boolean(semua && semua.belum_siap !== true && disusunPada);
  const selaras = selisih === null || selisih <= toleransi;
  // Penyusulan dianggap tuntas bila ia memang menyentuh baris yang sudah ada di
  // potret. Bila pagar halaman tersentuh lebih dulu, masih ada baris baru yang
  // belum ikut — dan ekspor tidak boleh berpura-pura lengkap.
  const susulanTuntas = susulan ? susulan.tuntas === true : true;

  return {
    siap,
    // UMURNYA SENGAJA BUKAN SYARAT. Penyusuran 1.650 halaman anggota memakan
    // menit dan hanya diulang tiap TTL, jadi menuntut potret berumur di bawah
    // lima menit akan memblokir ekspor selamanya — bukan membuatnya lebih
    // benar. Yang betul-betul menentukan ada tiga, dan ketiganya di bawah:
    // potretnya belum kedaluwarsa, seluruh baris baru sudah disusul, dan
    // jumlah baris yang dipegang sepadan dengan hitungan ASTA DESA detik ini.
    realtime: siap && semua.basi !== true && susulanTuntas && selaras,
    basi: semua?.basi === true,
    sebagian: semua?.truncated === true,
    disusun_pada: disusunPada,
    umur_ms: umurMs,
    batas_umur_ms: asta.TTL_SUSUR_MS,
    total_snapshot: totalSnapshot,
    total_hidup: hidup,
    baris_potret: semua?.terbaca ?? null,
    baris_susulan: barisSusulan,
    halaman_susulan: susulan?.halaman ?? 0,
    susulan_tuntas: susulanTuntas,
    baris_tercakup: tercakup,
    selisih,
    toleransi_selisih: toleransi
  };
};

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

  // Tiga pengambilan sekaligus, masing-masing dengan alasannya sendiri.
  //
  // `/summary` dulu selalu membalas 500 di sisi ASTA DESA, sehingga halaman ini
  // sepenuhnya bergantung pada penyusuran di bawah. Endpoint itu sudah pulih
  // (perbaikan di repo ASTA DESA, 21 September 2026) dan sekarang menjadi
  // sumber utama: satu permintaan, ~0,37 detik, agregat dihitung di SQL.
  //
  // `hitunganLangsung` tetap dipertahankan sebagai angka pokok yang paling
  // hidup. Satu permintaan `per_page=1` tidak membawa baris yang berguna,
  // tetapi `meta.total`-nya adalah `Sensus::count()` apa adanya — hitungan yang
  // sama persis dengan yang dipakai panel ASTA DESA tiap kali dibuka.
  //
  // Penyusuran penuh kini DILEPAS KE LATAR kecuali diminta paksa. Ia memakan
  // menit — 72 halaman per September 2026 — sementara axios di frontend
  // menyerah pada detik ke-30, sehingga menunggunya berarti halaman tidak
  // pernah terbit sama sekali. Rincian yang hanya bisa didapat dari baris
  // mentah (per desa, tren harian, jumlah berkoordinat) menyusul pada siklus
  // pembaruan berikutnya, persis seperti yang sudah dijanjikan teks di kaki
  // halaman.
  const [ringkasanApi, hitunganLangsung, susurMentah] = await Promise.all([
    asta.ambil('/summary', {}, { force }).catch(() => null),
    asta.ambil('/sensuses', { per_page: 1 }, { force, ttlMs: TTL_ANGKA_POKOK }).catch(() => null),
    asta.ambilSemua('/sensuses', {}, { force, latar: true, profil: PROFIL_ADMIN }).catch(() => null)
  ]);

  // Disamakan sekali di sini supaya sisa fungsi tidak perlu memeriksa null di
  // setiap tempat: penyusuran bisa gagal (null) atau belum siap (mode latar).
  const semua = susurMentah ?? {
    rows: [],
    truncated: false,
    total: null,
    kembar: 0,
    kurang: 0,
    kena_pagar: false,
    belum_siap: true
  };

  // Rincian di bawah disusun dari baris mentah. Bila penyusuran belum pernah
  // selesai, tidak ada baris untuk disusun — dan yang tersaji sebagai gantinya
  // adalah agregat dari `/summary`, yang dihitung di sisi basis data mereka.
  const rincianDariBaris = semua.rows.length > 0;

  // Angka pokok, urut dari yang paling bisa dipercaya:
  //   1. meta.total dari permintaan ringan di atas — hitungan server, hidup.
  //   2. total.sensuses dari /summary — juga hitungan server, kalau pulih.
  //   3. meta.total yang terbaca saat penyusuran — seumur penyusuran itu.
  //   4. panjang array — pilihan terakhir, dan yang paling rawan: baris bisa
  //      tergeser keluar dari paginasi saat data baru masuk (lihat catatan
  //      dedup di astadesa.service.js), sehingga angkanya cenderung KURANG.
  //
  // Inilah inti selisih yang selama ini terlihat di halaman: DPMD menyajikan
  // (4) sebagai total resmi, sementara panel ASTA DESA menyajikan (1).
  const metaLangsung = metaDari(hitunganLangsung);
  const totalResmi =
    keAngka(metaLangsung?.total) ??
    keAngka(ringkasanApi?.data?.total?.sensuses) ??
    keAngka(semua.total) ??
    semua.rows.length;

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

  // Bentuk pengganti dari `/summary`, dipakai selama penyusuran belum pernah
  // selesai. Lapangan yang tidak bisa diketahui dari agregat — berapa desa di
  // satu kecamatan, berapa yang berkoordinat, rincian status per kecamatan —
  // sengaja dibiarkan null/kosong alih-alih ditebak: halaman lebih baik tidak
  // menampilkan angka daripada menampilkan angka yang salah.
  const isiRingkasan = ringkasanApi?.data ?? {};

  const kecamatanRingkasan = (isiRingkasan.sensus_per_kecamatan ?? [])
    .map((r) => ({
      kecamatan: rapikan(r.kecamatan),
      total: keAngka(r.jumlah) ?? 0,
      total_desa: null,
      berkoordinat: null,
      per_status: []
    }))
    .sort((a, b) => b.total - a.total);

  const statusRingkasan = (isiRingkasan.sensus_per_status ?? [])
    .map((r) => ({ status: rapikan(r.status), total: keAngka(r.jumlah) ?? 0 }))
    .sort((a, b) => b.total - a.total);

  // Hanya sepuluh teratas — itulah yang dibawa endpoint ringkasan. Cukup untuk
  // papan peringkat di halaman, dan itu memang satu-satunya tempat ia dipakai.
  const petugasRingkasan = (isiRingkasan.petugas_teraktif ?? [])
    .map((r) => ({
      nama: rapikan(r.name) ?? rapikan(r.nama),
      total: keAngka(r.jumlah_sensus) ?? 0,
      kecamatan: rapikan(r.kecamatan) ? [rapikan(r.kecamatan)] : []
    }))
    .sort((a, b) => b.total - a.total);

  res.json({
    success: true,
    data: {
      // Apa adanya dari ASTA DESA. Angka resmi mereka tetap ditampilkan
      // berdampingan dengan hitungan kita supaya selisih apa pun terlihat,
      // bukan tersembunyi di balik satu angka pilihan.
      summary: ringkasanApi?.data ?? ringkasanApi ?? null,

      // Hitungan server yang hidup, bukan panjang array. Lihat catatan di
      // tempat `totalResmi` disusun.
      total_sensus: totalResmi,

      // Berapa baris yang benar-benar terbaca dan ikut menyusun rekap di bawah.
      // Dipisahkan dari `total_sensus` supaya selisih keduanya bisa dilihat,
      // bukan disamarkan — dan supaya persentase yang dihitung dari hasil
      // pembacaan (berapa persen berkoordinat) dibagi dengan populasi yang
      // memang diukur, bukan dengan angka se-kabupaten.
      total_terbaca: baris.length,
      kembar_terbuang: semua.kembar || 0,

      total_kecamatan: rincianDariBaris ? perKecamatan.size : kecamatanRingkasan.length || null,
      total_desa: rincianDariBaris ? perDesa.size : null,

      // Sengaja null, bukan panjang `petugas_teraktif`. Endpoint ringkasan
      // hanya memuat sepuluh petugas teratas; menyajikan 10 sebagai jumlah
      // petugas se-kabupaten akan salah besar, dan halaman lebih baik tidak
      // menampilkan angka daripada menampilkan angka yang keliru.
      total_petugas: rincianDariBaris ? perPetugas.size : null,

      total_anggota_tercatat: rincianDariBaris
        ? totalAnggota || null
        : keAngka(ringkasanApi?.data?.total?.sensus_anggotas),

      // Hanya bisa dihitung dari baris mentah: ringkasan tidak membawa
      // koordinat sama sekali.
      berkoordinat: rincianDariBaris ? berkoordinat : null,

      per_kecamatan: rincianDariBaris
        ? Array.from(perKecamatan.entries())
            .map(([kecamatan, v]) => ({
              kecamatan,
              total: v.total,
              total_desa: v.desa.size,
              berkoordinat: v.berkoordinat,
              per_status: keDaftar(v.status, 'status')
            }))
            .sort((a, b) => b.total - a.total)
        : kecamatanRingkasan,

      // Rincian per desa tidak ada di ringkasan; ia hanya lahir dari baris.
      per_desa: rincianDariBaris ? Array.from(perDesa.values()).sort((a, b) => b.total - a.total) : [],

      per_status: rincianDariBaris ? keDaftar(perStatus, 'status') : statusRingkasan,

      petugas: rincianDariBaris
        ? Array.from(perPetugas.entries())
            .map(([nama, v]) => ({ nama, total: v.total, kecamatan: Array.from(v.kecamatan) }))
            .sort((a, b) => b.total - a.total)
        : petugasRingkasan,

      // Tren HARIAN hanya bisa disusun dari baris. Ringkasan membawa tren
      // bulanan, dan menaruhnya di lapangan yang sama akan membuat halaman
      // membaca dua belas bulan sebagai dua belas hari.
      tren: rincianDariBaris
        ? Array.from(perHari.entries())
            .map(([tanggal, total]) => ({ tanggal, total }))
            .sort((a, b) => a.tanggal.localeCompare(b.tanggal))
        : [],

      // Dari mana rincian di atas berasal, supaya halaman bisa mengatakannya
      // apa adanya dan tidak menyajikan angka sebagian sebagai angka penuh.
      rincian_dari: rincianDariBaris ? 'penyusuran' : 'ringkasan',
      rincian_siap: rincianDariBaris,
      rincian_basi: semua.basi === true,

      // Kejujuran soal kelengkapan. Bila penyusuran terhenti di pagar batas
      // baris, angka di atas adalah angka sebagian — dan halaman harus bisa
      // mengatakannya, bukan menyajikannya sebagai total resmi.
      sebagian: semua.truncated,
      // Sebab `sebagian`, supaya halaman tidak menuduh pagar batas baris saat
      // yang terjadi sebenarnya lain.
      kena_pagar: semua.kena_pagar || false,
      kurang_terbaca: semua.kurang || 0,
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

  // Dilepas ke latar dengan alasan yang sama seperti /ringkasan: penyusuran
  // `/sensuses` terukur 80 detik untuk 73 halaman, sementara axios di frontend
  // menyerah pada detik ke-30. Menunggunya berarti peta tidak pernah tampil
  // sama sekali — dan memang itu yang terjadi: dua `upstream timed out` pada
  // jalur ini tercatat hanya dalam satu hari.
  //
  // Bedanya dengan /ringkasan, di sini tidak ada agregat pengganti: titik peta
  // hanya bisa lahir dari baris mentah. Jadi muatan pertama memang kosong, dan
  // `rincian_siap` di bawah ada supaya halaman bisa mengatakan "sedang
  // disiapkan" alih-alih menyajikan nol titik seolah itu kenyataannya.
  const semua = await asta.ambilSemua('/sensuses', {}, { force, latar: true, profil: PROFIL_ADMIN });
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
      tanggal: r.tanggal,
      // NIK TERSAMAR, bukan NIK utuh. Halaman peta penuh mencari berdasarkan
      // NIK persis seperti panel super admin — dan panel itu pun menyamarkannya
      // lebih dulu, sehingga pencariannya hanya pernah mengenai 6 digit pertama.
      // Mengirim NIK lengkap ke browser untuk hasil pencarian yang sama adalah
      // risiko tanpa imbalan.
      nik: samarkanNomor(r.kk_nik)
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
      sebagian: semua.truncated,

      // Pembeda "belum siap" dari "memang nol". Tanpa ini halaman akan
      // menyajikan peta kosong sebagai hasil pembacaan yang sah.
      rincian_siap: semua.rows.length > 0,
      rincian_basi: semua.basi === true
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

  // `halaman` tetap ditunggu — itu satu permintaan biasa dan justru isi tabel
  // yang sedang dilihat orang. Yang dilepas ke latar hanya rekapitulasinya:
  // penyusuran `/users` terukur 21 detik untuk 40 halaman, cukup dekat dengan
  // batas 30 detik untuk gagal begitu server sedang sibuk.
  const [halaman, semua] = await Promise.all([
    asta.ambil('/users', params, { force }),
    asta.ambilSemua('/users', {}, { force, latar: true })
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
      sebagian: semua.truncated,

      // Hanya menyangkut rekapitulasi di atas. Tabel akun per halaman tetap
      // diambil langsung dan selalu terisi.
      rincian_siap: semua.rows.length > 0,
      rincian_basi: semua.basi === true
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
  const fKec = rapikan(req.query.kecamatan);
  const fDesa = rapikan(req.query.desa);
  const adaFilter = Boolean(fKec || fDesa);

  // Peta id keluarga -> wilayah lebih dulu, lalu penyusuran anggota memakainya.
  // Urutan ini yang membuat angka anggota bisa dipecah per kecamatan/desa —
  // lihat `wilayahAnggota`.
  const lookup = await lookupWilayah(force);

  // ±330 ribu anggota keluarga (±1.650 halaman) per September 2026. Barisnya
  // TIDAK disimpan: setiap anggota langsung dihitung ke agregat saat disusuri,
  // sehingga memori tidak ikut membengkak dan pagar batas baris tidak lagi
  // memotong data menjadi seperempatnya.
  const semua = await asta.ambilSemua('/sensus-anggotas', {}, { force, latar: true, profil: profilAnggota(lookup) });
  const o = semua.olahan;
  const perWilayahSiap = Boolean(o?.per_wilayah?.size);

  // Penyaring hanya dilayani bila rincian wilayahnya memang sudah ada. Kalau
  // tidak, yang dikirim tetap angka SE-KABUPATEN dan `per_wilayah_siap: false`
  // ikut terkirim — halaman mengatakannya terang-terangan alih-alih menampilkan
  // angka kabupaten di bawah judul satu desa.
  const isi = adaFilter && perWilayahSiap ? emberWilayah(o, fKec, fDesa) : o;

  res.json({
    success: true,
    data: {
      total_anggota: isi ? isi.total : 0,
      per_jenis_kelamin: isi ? isi.per_jenis_kelamin : [],
      piramida: isi ? isi.piramida : KELOMPOK_USIA.map((k) => ({ label: k.label, L: 0, P: 0, lain: 0, total: 0 })),
      tanpa_usia: isi ? isi.tanpa_usia : 0,
      per_pendidikan: isi ? isi.per_pendidikan : [],
      per_pekerjaan: isi ? isi.per_pekerjaan : [],
      per_hubungan: isi ? isi.per_hubungan : [],
      per_disabilitas: isi ? isi.per_disabilitas : [],
      filter: { kecamatan: fKec, desa: fDesa },
      per_wilayah_siap: perWilayahSiap,
      anggota_terpeta: o ? o.terpeta : 0,
      anggota_tanpa_wilayah: o ? o.tanpa_wilayah : 0,
      sebagian: semua.truncated,
      rincian_siap: Boolean(o),
      rincian_basi: semua.basi === true,
      disusun_pada: semua.disusun_pada || null
    }
  });
});

/**
 * Satu ember agregat anggota keluarga — dipakai untuk se-kabupaten MAUPUN untuk
 * tiap desa. Bentuknya sengaja satu dan hanya satu: angka per desa tidak boleh
 * pernah dihitung dengan aturan yang berbeda dari angka kabupaten yang tampil
 * di halaman yang sama, karena keduanya dibandingkan orang.
 */
const emberAnggota = () => ({
  total: 0,
  perJk: new Map(),
  perPendidikan: new Map(),
  perPekerjaan: new Map(),
  perHubungan: new Map(),
  perDisabilitas: new Map(),
  piramida: KELOMPOK_USIA.map((k) => ({ label: k.label, L: 0, P: 0, lain: 0, total: 0 })),
  tanpaUsia: 0
});

/**
 * Baris anggota mentah -> nilai yang sudah diseragamkan.
 *
 * Dibaca SEKALI per baris lalu dipakai dua kali (ember kabupaten dan ember
 * desanya). Tanpa pemisahan ini setiap baris melewati belasan `pilih` dua kali
 * — dan barisnya ada ±330 ribu.
 */
const bacaAnggota = (a) => {
  const jkMentah = (rapikan(pilih(a, ['jenis_kelamin', 'jk', 'gender'])) || '').toUpperCase();
  return {
    // Sumbernya tidak seragam: ada "L"/"P", ada "LAKI-LAKI"/"PEREMPUAN",
    // ada "1"/"2". Ketiganya harus jatuh ke ember yang sama.
    jk: /^(L|1|LAKI)/.test(jkMentah) ? 'L' : /^(P|2|PEREM|WANITA)/.test(jkMentah) ? 'P' : 'lain',
    pendidikan: rapikan(pilih(a, ['pendidikan', 'pendidikan_terakhir', 'tingkat_pendidikan'])),
    // Kolom pekerjaan TIDAK ada di `sensus_anggotas` per hari ini. Pembacaannya
    // dibiarkan supaya angkanya langsung muncul bila mereka menambahkannya.
    pekerjaan: rapikan(pilih(a, ['pekerjaan', 'jenis_pekerjaan', 'mata_pencaharian'])),
    // Disabilitas berisi JENIS ("Tidak", "Mental", …), bukan sakelar ya/tidak.
    disabilitas: rapikan(pilih(a, ['disabilitas', 'jenis_disabilitas'])),
    hubungan: rapikan(pilih(a, ['hubungan_kk', 'hubungan_keluarga', 'hubungan', 'status_hubungan', 'shdk'])),
    usia: usiaDari(a)
  };
};

const isiEmber = (e, n) => {
  e.total += 1;
  tambah(e.perJk, n.jk === 'L' ? 'Laki-laki' : n.jk === 'P' ? 'Perempuan' : 'Tidak diketahui');
  if (n.pendidikan) tambah(e.perPendidikan, n.pendidikan);
  if (n.pekerjaan) tambah(e.perPekerjaan, n.pekerjaan);
  if (n.disabilitas) tambah(e.perDisabilitas, n.disabilitas);
  if (n.hubungan) tambah(e.perHubungan, n.hubungan);

  if (n.usia === null) {
    e.tanpaUsia += 1;
    return;
  }
  const idx = KELOMPOK_USIA.findIndex((k) => n.usia >= k.min && n.usia <= k.max);
  if (idx >= 0) {
    e.piramida[idx][n.jk] += 1;
    e.piramida[idx].total += 1;
  }
};

const bentukEmber = (e) => ({
  total: e.total,
  per_jenis_kelamin: keDaftar(e.perJk, 'label'),
  piramida: e.piramida,
  tanpa_usia: e.tanpaUsia,
  per_pendidikan: keDaftar(e.perPendidikan, 'label'),
  per_pekerjaan: keDaftar(e.perPekerjaan, 'label').slice(0, 20),
  per_hubungan: keDaftar(e.perHubungan, 'label'),
  per_disabilitas: keDaftar(e.perDisabilitas, 'label')
});

/**
 * Jumlahkan beberapa ember mentah menjadi satu.
 *
 * Dipakai saat penyaring wilayah mengenai banyak desa (satu kecamatan =
 * belasan desa). Menjumlahkan ember MENTAH, bukan hasil `bentukEmber`, karena
 * yang sudah dibentuk sudah diurutkan dan dipangkas 20 teratas — menjumlahkan
 * dua daftar seperti itu akan kehilangan nilai yang kebetulan peringkat 21 di
 * satu desa tetapi peringkat 3 di kecamatannya.
 */
const gabungEmber = (daftar) => {
  const g = emberAnggota();
  const peta = ['perJk', 'perPendidikan', 'perPekerjaan', 'perHubungan', 'perDisabilitas'];
  daftar.forEach((e) => {
    g.total += e.total;
    g.tanpaUsia += e.tanpaUsia;
    peta.forEach((k) => e[k].forEach((v, label) => tambah(g[k], label, v)));
    e.piramida.forEach((b, i) => {
      g.piramida[i].L += b.L;
      g.piramida[i].P += b.P;
      g.piramida[i].lain += b.lain;
      g.piramida[i].total += b.total;
    });
  });
  return g;
};

/** Ember anggota untuk satu kecamatan/desa, sudah dalam bentuk siap kirim. */
const emberWilayah = (o, kec, desa) => {
  const k = kec ? kec.toLowerCase() : null;
  const d = desa ? desa.toLowerCase() : null;
  const cocok = [];
  o.per_wilayah.forEach((e, kunci) => {
    const pisah = kunci.split('\u0000');
    if (k && (pisah[0] || '').toLowerCase() !== k) return;
    if (d && (pisah[1] || '').toLowerCase() !== d) return;
    cocok.push(e);
  });
  return bentukEmber(gabungEmber(cocok));
};

/** Kolom yang mungkin merujuk keluarga induk sebuah baris anggota. */
const KUNCI_ID_SENSUS = ['sensus_id', 'id_sensus', 'sensuses_id', 'kk_id', 'keluarga_id'];
/** Objek keluarga yang mungkin ikut tersemat pada baris anggota. */
const WADAH_SENSUS = ['sensus', 'sensuses', 'keluarga', 'kk'];

/**
 * Wilayah sebuah baris anggota: "kecamatan\0desa", atau null bila tak terlacak.
 *
 * Dua jalan dicoba, dan urutannya disengaja. Pertama kolom wilayah pada barisnya
 * sendiri atau pada objek keluarga yang ikut tersemat — bila suatu saat ASTA
 * DESA menambahkannya, itulah sumber paling tepat dan tidak perlu perubahan
 * kode. Baru setelah itu lewat rujukan `sensus_id` dan peta dari penyusuran
 * `/sensuses`.
 *
 * Mengembalikan null, BUKAN "Tidak diketahui": baris yang tak terlacak dihitung
 * terpisah (`tanpa_wilayah`) supaya ekspor bisa mengatakan terus terang berapa
 * anggota yang tidak bisa ditempatkan, alih-alih menumpuknya di satu desa palsu
 * yang akan dibaca sebagai temuan.
 */
const wilayahAnggota = (a, lookup) => {
  for (const w of [a, ...WADAH_SENSUS.map((k) => a?.[k])]) {
    if (!w || typeof w !== 'object') continue;
    const kec = rapikan(pilih(w, KUNCI_KECAMATAN));
    const desa = rapikan(pilih(w, KUNCI_DESA));
    if (kec && desa) return `${kec}\u0000${desa}`;
  }

  if (!lookup || !lookup.size) return null;
  let id = pilih(a, KUNCI_ID_SENSUS);
  if (id !== null && typeof id === 'object') id = id.id ?? null;
  if (id === null || id === undefined) {
    for (const k of WADAH_SENSUS) {
      const v = a?.[k];
      if (v && typeof v === 'object' && v.id !== undefined && v.id !== null) {
        id = v.id;
        break;
      }
    }
  }
  if (id === null || id === undefined) return null;
  return lookup.get(String(id)) || null;
};

/**
 * Agregat anggota keluarga, dihitung per baris saat penyusuran.
 *
 * Peta wilayah masuk sebagai PENUTUP, bukan keadaan global, supaya satu
 * penyusuran tidak pernah setengah-setengah: entah ia memegang petanya sejak
 * baris pertama, entah ia memang penyusuran tanpa rincian wilayah — dan nama
 * profilnya ikut mengatakan yang mana (lihat `profilAnggota`).
 */
const olahDemografi = (lookup) => ({
  buat: () => ({ kab: emberAnggota(), perWilayah: new Map(), terpeta: 0, tanpaWilayah: 0, idTerbesar: null }),
  tambah: (s, a) => {
    // id tertinggi dicatat di sini karena barisnya TIDAK disimpan (ringkas ->
    // null). Tanpa angka ini, penyusulan baris terbaru saat ekspor tidak punya
    // patokan "sampai mana potret ini sudah membaca".
    const id = idBaris(a);
    if (id !== null && (s.idTerbesar === null || id > s.idTerbesar)) s.idTerbesar = id;

    const n = bacaAnggota(a);
    isiEmber(s.kab, n);

    const wilayah = wilayahAnggota(a, lookup);
    if (!wilayah) {
      s.tanpaWilayah += 1;
      return;
    }
    s.terpeta += 1;
    let e = s.perWilayah.get(wilayah);
    if (!e) {
      e = emberAnggota();
      s.perWilayah.set(wilayah, e);
    }
    isiEmber(e, n);
  },
  selesai: (s) => ({
    ...bentukEmber(s.kab),
    // Ember kabupaten MENTAH ikut dibawa, bukan hanya bentuk jadinya: hasil
    // `bentukEmber` sudah diurutkan dan dipangkas 20 teratas, sehingga
    // menambahkan baris susulan ke atasnya akan kehilangan nilai yang
    // kebetulan peringkat 21 sebelum susulan masuk.
    mentah: s.kab,
    per_wilayah: s.perWilayah,
    terpeta: s.terpeta,
    tanpa_wilayah: s.tanpaWilayah,
    id_terbesar: s.idTerbesar
  })
});

/**
 * Profil penyusuran `/sensus-anggotas`.
 *
 * NAMANYA IKUT BERUBAH saat peta wilayah belum siap, dan itu bukan kerewelan:
 * nama profil adalah bagian dari kunci cache. Kalau keduanya memakai satu nama,
 * penyusuran yang kebetulan berjalan sebelum `/sensuses` selesai akan mengisi
 * cache selama 30 menit dengan rincian wilayah kosong — dan ekspor per desa
 * tampak "belum tersedia" tanpa sebab yang kelihatan dari mana pun.
 */
const profilAnggota = (lookup) => ({
  nama: lookup && lookup.size ? 'demografi-wilayah' : 'demografi',
  ringkas: () => null,
  olah: olahDemografi(lookup || null)
});

/**
 * Peta id keluarga -> "kecamatan\0desa", dari penyusuran `/sensuses` yang sudah
 * dipakai Peta Sebaran dan profil kategori. Null bila penyusuran itu belum
 * pernah selesai — dan null di sini berarti "rincian wilayah belum bisa",
 * bukan "tidak ada datanya".
 */
const lookupWilayah = async (force = false) => {
  const peta = await asta
    .ambilSemua('/sensuses', {}, { force, pengguna: true, latar: true, profil: PROFIL_PENGGUNA })
    .catch(() => null);
  const m = peta?.olahan?.wilayahPerId;
  return m && m.size ? m : null;
};


// ── Profil keluarga per kategori sensus ─────────────────────────────────────

/**
 * Nama kategori dari awalan kolom. Tabel `sensuses` punya ±104 kolom yang
 * dikelompokkan lewat awalannya (`spp_*` sarana & prasarana permukiman,
 * `sosial_*` bantuan sosial, …). Awalan yang belum dikenal TIDAK dibuang —
 * ia tetap tampil dengan awalannya sendiri, supaya kolom baru di ASTA DESA
 * langsung terbaca tanpa perubahan kode.
 */
const KATEGORI_SENSUS = {
  spp: 'Rumah & Prasarana',
  sosial: 'Sosial & Bantuan',
  eko: 'Ekonomi',
  ekonomi: 'Ekonomi',
  usaha: 'Usaha',
  kes: 'Kesehatan',
  kesehatan: 'Kesehatan',
  pdk: 'Pendidikan',
  pendidikan: 'Pendidikan',
  aset: 'Kepemilikan Aset',
  lingkungan: 'Lingkungan',
  lh: 'Lingkungan',
  kk: 'Kepala Keluarga',
  pangan: 'Ketahanan Pangan',
  kb: 'Keluarga Berencana'
};

/**
 * Kolom yang TIDAK PERNAH diagregasi: identitas warga, koordinat, berkas, dan
 * kolom teknis. Endpoint ini hanya mengirim hitungan per nilai, tetapi kolom
 * seperti nama/NIK tetap dikecualikan di sini — kalau suatu kolom identitas
 * kebetulan hanya berisi sedikit nilai di satu desa, daftar "nilai" itu sudah
 * sama dengan membocorkan identitasnya.
 */
const KOLOM_TERLARANG = /(^id$|_id$|^uuid|nik|no_kk|nomor_kk|nama|alamat|telp|tlp|_hp$|^hp|whatsapp|^wa$|email|lat$|lon$|lng$|koordinat|lokasi|foto|gambar|media|_urls?$|tanggal_lahir|tgl_lahir|tempat_lahir|catatan|keterangan|ttd|tanda_tangan|signature|token|password|_at$|^tanggal|^tgl|user|petugas|surveyor|^status$|^kecamatan$|^desa$|^kelurahan$|^rt$|^rw$|dusun|kode_pos|anggotas?)/i;

/** Nilai yang tampak seperti nomor identitas (NIK/KK/telepon). */
const MIRIP_NOMOR = /^\+?\d{9,}$/;

/** Lebih dari ini nilai berbeda (se-kabupaten) berarti teks bebas, bukan kategori. */
const BATAS_KATEGORI = 40;

const labelKolom = (kunci, awalan) => {
  const tanpaAwalan = awalan && kunci.startsWith(`${awalan}_`) ? kunci.slice(awalan.length + 1) : kunci;
  const s = tanpaAwalan.replace(/_/g, ' ').trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
};

/** Nilai mentah → daftar label. Array (pilihan ganda) dan JSON-array dipecah. */
const nilaiKe = (v) => {
  if (v === null || v === undefined || v === '') return [];
  if (Array.isArray(v)) return v.flatMap((x) => (x !== null && typeof x === 'object' ? [] : [String(x).trim()])).filter(Boolean);
  if (typeof v === 'object') return null; // objek bersarang: bukan kategori
  if (typeof v === 'boolean') return [v ? 'Ya' : 'Tidak'];
  const s = String(v).trim();
  if (!s) return [];
  if (s.startsWith('[') && s.endsWith(']')) {
    try {
      const arr = JSON.parse(s);
      if (Array.isArray(arr)) return arr.map((x) => String(x).trim()).filter(Boolean);
    } catch {
      /* bukan JSON — perlakukan sebagai teks biasa */
    }
  }
  return [s];
};

/**
 * Agregat kategori sensus PER DESA, dihitung saat penyusuran.
 *
 * Dikelompokkan per desa (bukan per kabupaten) supaya penyaring kecamatan/desa
 * cukup menjumlahkan kelompok yang cocok — tanpa menyimpan 82 ribu baris ×
 * ±80 kolom di memori hanya untuk bisa menyaringnya ulang.
 *
 * Status kolom (teks bebas? angka? pilihan ganda?) dicatat SEKALI se-kabupaten
 * di `kolom`, sehingga satu kolom tidak dinilai "kategori" di satu desa dan
 * "teks bebas" di desa sebelah.
 */
const OLAH_KATEGORI = {
  buat: () => ({ kolom: new Map(), grup: new Map(), wilayahPerId: new Map() }),
  tambah: (s, row) => {
    const kec = rapikan(pilih(row, KUNCI_KECAMATAN)) || 'Tidak diketahui';
    const desa = rapikan(pilih(row, KUNCI_DESA)) || 'Tidak diketahui';
    const kunciGrup = `${kec}\u0000${desa}`;
    let g = s.grup.get(kunciGrup);
    if (!g) {
      // `kunci` disimpan di kelompoknya supaya `wilayahPerId` di bawah menunjuk
      // SATU string yang sama untuk seluruh keluarga di desa itu. Menyimpan
      // hasil penggabungan per baris berarti 191 ribu string baru di memori
      // untuk 400-an nilai yang berbeda.
      g = { kunci: kunciGrup, kecamatan: kec, desa, n: 0, kolom: new Map() };
      s.grup.set(kunciGrup, g);
    }
    g.n += 1;

    // Peta id keluarga -> wilayahnya. Ini satu-satunya jembatan yang membuat
    // demografi ANGGOTA bisa dipecah per kecamatan/desa: `/sensus-anggotas`
    // tidak membawa kecamatan/desa sama sekali, hanya rujukan ke keluarganya.
    // Dibangun di sini — pada penyusuran yang memang sudah berjalan — bukan
    // dengan menyusuri ulang 191 ribu baris setiap kali ekspor diminta.
    const idSensus = row?.id ?? row?.sensus_id;
    if (idSensus !== undefined && idSensus !== null) s.wilayahPerId.set(String(idSensus), g.kunci);

    Object.entries(row).forEach(([kunci, v]) => {
      if (KOLOM_TERLARANG.test(kunci)) return;
      let meta = s.kolom.get(kunci);
      if (!meta) {
        meta = { buang: false, teks: false, multi: false, semuaAngka: true, beda: new Set() };
        s.kolom.set(kunci, meta);
      }
      if (meta.buang) return;
      const nilai = nilaiKe(v);
      if (nilai === null) {
        meta.buang = true;
        return;
      }
      if (!nilai.length) return;
      if (Array.isArray(v) || (typeof v === 'string' && v.trim().startsWith('['))) meta.multi = true;

      let k = g.kolom.get(kunci);
      if (!k) {
        k = { terisi: 0, hitung: new Map(), angka: [] };
        g.kolom.set(kunci, k);
      }
      k.terisi += 1;

      nilai.forEach((n) => {
        if (MIRIP_NOMOR.test(n.replace(/[\s-]/g, ''))) {
          meta.buang = true;
          return;
        }
        const num = keAngka(n);
        if (num === null) meta.semuaAngka = false;
        else k.angka.push(num);

        const normal = n.toLowerCase();
        if (!meta.teks) {
          meta.beda.add(normal);
          // Terlalu banyak nilai berbeda: teks bebas (bila bukan angka) —
          // berhenti menghitung per nilai supaya memori tidak ikut membengkak.
          if (meta.beda.size > BATAS_KATEGORI) {
            meta.teks = true;
            meta.beda = new Set();
          }
        }
        if (meta.teks) return;
        const ada = k.hitung.get(normal);
        if (ada) ada.total += 1;
        else k.hitung.set(normal, { label: n, total: 1 });
      });
    });
  },
  // `daftarGrup` dibekukan sekali di sini: endpoint ekspor membacanya berulang
  // kali per permintaan, dan Map.values() tiap kali hanya membuang waktu.
  selesai: (s) => {
    s.daftarGrup = Array.from(s.grup.values());
    return s;
  }
};

/**
 * Baris `/v1/sensuses` yang disimpan untuk peta: hanya kolom yang digambar
 * atau dicari di Peta Sebaran. NIK disamarkan sejak di sini.
 */
const barisPeta = (row) => {
  const foto = fotoRumahPertama(row);
  return {
    id: row.id ?? null,
    rumah_lat: row.rumah_lat ?? null,
    rumah_lon: row.rumah_lon ?? null,
    lokasi_lat: row.lokasi_lat ?? null,
    lokasi_lon: row.lokasi_lon ?? null,
    kecamatan: row.kecamatan ?? null,
    desa: row.desa ?? null,
    status: row.status ?? null,
    kk_nama: row.kk_nama ?? null,
    kk_nik: samarkanNomor(row.kk_nik),
    petugas: namaPetugas(row) || rapikan(row.user?.name),
    tanggal_pendataan: row.tanggal_pendataan ?? null,
    foto_rumah_urls: foto ? [foto] : null
  };
};

// Satu penyusuran `/v1/sensuses` melayani Peta Sebaran DAN profil kategori —
// kedua endpoint wajib memakai profil yang sama supaya berbagi cache.
const PROFIL_PENGGUNA = { nama: 'peta+kategori', ringkas: barisPeta, olah: OLAH_KATEGORI };

/**
 * Gabungkan beberapa kelompok desa menjadi satu agregat per kolom.
 *
 * Dipakai dua kali: oleh endpoint kategori (kelompok yang tersaring penyaring
 * wilayah) dan oleh endpoint ekspor (seluruh kelompok, untuk menetapkan daftar
 * nilai se-kabupaten). Satu fungsi, supaya "berapa keluarga memilih Keramik"
 * mustahil dihitung berbeda di layar dan di berkas Excel.
 */
const gabungKolom = (grup) => {
  const gabung = new Map();
  grup.forEach((g) => {
    g.kolom.forEach((k, kunci) => {
      let t = gabung.get(kunci);
      if (!t) {
        t = { terisi: 0, hitung: new Map(), angka: [] };
        gabung.set(kunci, t);
      }
      t.terisi += k.terisi;
      k.hitung.forEach((v, normal) => {
        const ada = t.hitung.get(normal);
        if (ada) ada.total += v.total;
        else t.hitung.set(normal, { label: v.label, total: v.total });
      });
      for (const n of k.angka) t.angka.push(n);
    });
  });
  return gabung;
};

/**
 * Satukan dua catatan sifat kolom (potret + susulan).
 *
 * Sifat kolom — teks bebas? angka? pilihan ganda? — ditetapkan se-kabupaten,
 * jadi penilaian dari baris susulan harus bergabung dengan penilaian potret,
 * bukan menggantikannya. Yang menular SELALU yang lebih membatasi: sekali
 * sebuah kolom dinilai teks bebas atau wajib dibuang di salah satu sisi, ia
 * tetap begitu — kalau tidak, satu kolom bisa terbaca kategori di angka
 * kabupaten dan teks bebas di angka desa pada berkas yang sama.
 */
const gabungMetaKolom = (a, b) => {
  if (!a) return b;
  if (!b) return a;
  const teksAwal = a.teks || b.teks;
  const beda = teksAwal ? new Set() : new Set([...a.beda, ...b.beda]);
  const teks = teksAwal || beda.size > BATAS_KATEGORI;
  return {
    buang: a.buang || b.buang,
    teks,
    multi: a.multi || b.multi,
    semuaAngka: a.semuaAngka && b.semuaAngka,
    beda: teks ? new Set() : beda
  };
};

/**
 * Satukan kelompok desa yang muncul dua kali (dari potret dan dari susulan)
 * menjadi satu kelompok per desa.
 *
 * Tanpa ini, satu desa yang kebetulan menerima pendataan baru akan tampil
 * sebagai DUA baris di lembar "Rekap Desa" — satu berisi angka potret, satu
 * berisi angka susulan — dan keduanya salah.
 */
const gabungGrupWilayah = (daftar) => {
  const peta = new Map();
  daftar.forEach((g) => {
    const ada = peta.get(g.kunci);
    if (!ada) {
      peta.set(g.kunci, g);
      return;
    }
    peta.set(g.kunci, {
      kunci: g.kunci,
      kecamatan: g.kecamatan,
      desa: g.desa,
      n: ada.n + g.n,
      kolom: gabungKolom([ada, g])
    });
  });
  return Array.from(peta.values());
};

/** Ringkasan statistik satu kolom angka, atau null bila tak ada angkanya. */
const statistikAngka = (angkaArr) => {
  if (!angkaArr.length) return null;
  const urut = [...angkaArr].sort((a, b) => a - b);
  const jumlah = urut.reduce((a, b) => a + b, 0);
  return {
    rata_rata: Math.round((jumlah / urut.length) * 100) / 100,
    median: urut[Math.floor(urut.length / 2)],
    min: urut[0],
    maks: urut[urut.length - 1]
  };
};

/**
 * Satu kolom agregat -> bentuk yang dikirim, atau null bila kolomnya tidak bisa
 * dibaca sebagai kategori (teks bebas, atau angka tanpa satu pun nilai).
 */
const bentukItemKolom = (meta, t) => {
  if (!meta || meta.buang || !t.terisi) return null;

  if (meta.semuaAngka && !meta.multi && (meta.teks || t.hitung.size > 12)) {
    // Angka sungguhan (luas lantai, jumlah ternak, …): ringkasan statistik,
    // bukan ratusan batang berisi masing-masing satu keluarga.
    const statistik = statistikAngka(t.angka);
    return statistik ? { jenis: 'angka', statistik } : null;
  }
  if (meta.teks) return null; // teks bebas — tidak bisa dibaca sebagai kategori

  return {
    jenis: meta.multi ? 'pilihan_ganda' : 'kategori',
    nilai: Array.from(t.hitung.values()).sort((a, b) => b.total - a.total)
  };
};

/**
 * Agregat per kolom -> daftar kategori sensus siap kirim.
 *
 * Pengelompokannya dari awalan nama kolom (`spp_*`, `sosial_*`, …); awalan yang
 * belum dikenal tetap tampil dengan namanya sendiri supaya pertanyaan kuesioner
 * baru di ASTA DESA langsung muncul tanpa perubahan kode di sini.
 */
const susunKategori = (gabung, metaKolom) => {
  const perKategori = new Map();

  gabung.forEach((t, kunci) => {
    const item = bentukItemKolom(metaKolom.get(kunci), t);
    if (!item) return;
    const kode = kunci.includes('_') ? kunci.split('_')[0].toLowerCase() : 'lainnya';
    if (!perKategori.has(kode)) perKategori.set(kode, []);
    perKategori.get(kode).push({
      kunci,
      label: labelKolom(kunci, kode === 'lainnya' ? null : kode),
      terisi: t.terisi,
      ...item
    });
  });

  // Awalan tak dikenal yang hanya dipakai satu kolom (mis. `jumlah_kamar`)
  // bukan kategori — ia digabung ke "Lainnya" dengan nama kolom utuh.
  perKategori.forEach((daftar, kode) => {
    if (kode === 'lainnya' || KATEGORI_SENSUS[kode] || daftar.length >= 2) return;
    perKategori.delete(kode);
    if (!perKategori.has('lainnya')) perKategori.set('lainnya', []);
    daftar.forEach((d) => perKategori.get('lainnya').push({ ...d, label: labelKolom(d.kunci, null) }));
  });

  return Array.from(perKategori.entries())
    .map(([kode, daftar]) => ({
      kode,
      label: KATEGORI_SENSUS[kode] || (kode === 'lainnya' ? 'Lainnya' : kode.toUpperCase()),
      kolom: daftar.sort((a, b) => b.terisi - a.terisi)
    }))
    // Kategori yang dikenal lebih dulu, "Lainnya" selalu terakhir.
    .sort(
      (a, b) =>
        (a.kode === 'lainnya') - (b.kode === 'lainnya') ||
        !KATEGORI_SENSUS[a.kode] - !KATEGORI_SENSUS[b.kode] ||
        b.kolom.length - a.kolom.length
    );
};

/**
 * Rekap wilayah dari kelompok desa: daftar kecamatan, dan daftar desa pada
 * kecamatan yang sedang dipilih. Keduanya dari SELURUH kelompok, bukan yang
 * tersaring — kalau tidak, memilih satu kecamatan menghapus pilihan yang lain.
 */
const rekapWilayah = (grupSemua, fKec) => {
  const perKec = new Map();
  const perDesa = new Map();
  grupSemua.forEach((g) => {
    tambah(perKec, g.kecamatan, g.n);
    if (fKec && g.kecamatan.toLowerCase() === fKec) tambah(perDesa, g.desa, g.n);
  });
  return {
    kecamatan: keDaftar(perKec, 'nama').sort((a, b) => a.nama.localeCompare(b.nama, 'id')),
    desa: keDaftar(perDesa, 'nama').sort((a, b) => a.nama.localeCompare(b.nama, 'id'))
  };
};

/**
 * GET /api/asta-desa/demografi/kategori?kecamatan=&desa=
 *
 * Profil keluarga per kategori sensus: untuk SETIAP kolom kategorikal di
 * tabel `sensuses`, berapa keluarga per nilai. Kolomnya ditemukan sendiri dari
 * data (bukan daftar tetap) karena ASTA DESA tidak mendokumentasikan ±104
 * kolomnya, dan daftar tetap akan diam-diam tertinggal begitu mereka
 * menambah pertanyaan kuesioner.
 */
exports.getKategoriSensus = jalankan(async (req, res) => {
  const force = paksa(req);
  const fKec = rapikan(req.query.kecamatan)?.toLowerCase() || null;
  const fDesa = rapikan(req.query.desa)?.toLowerCase() || null;

  const semua = await asta.ambilSemua('/sensuses', {}, { force, pengguna: true, latar: true, profil: PROFIL_PENGGUNA });
  const o = semua.olahan;
  const grupSemua = o ? o.daftarGrup : [];

  const grup = grupSemua.filter(
    (g) => (!fKec || g.kecamatan.toLowerCase() === fKec) && (!fDesa || g.desa.toLowerCase() === fDesa)
  );
  const total = grup.reduce((a, g) => a + g.n, 0);
  const kategori = o ? susunKategori(gabungKolom(grup), o.kolom) : [];

  res.json({
    success: true,
    data: {
      total_keluarga: total,
      filter: { kecamatan: rapikan(req.query.kecamatan), desa: rapikan(req.query.desa) },
      wilayah: rekapWilayah(grupSemua, fKec),
      kategori,
      sebagian: semua.truncated,
      rincian_siap: Boolean(o),
      rincian_basi: semua.basi === true,
      disusun_pada: semua.disusun_pada || null
    }
  });
});

/** Angka untuk pesan yang dibaca orang: 1204 -> "1.204". */
const angkaId = (n) => Number(n ?? 0).toLocaleString('id-ID');

/**
 * Potret keluarga + baris susulan, disatukan menjadi satu bentuk yang sama.
 *
 * Baris susulan dijalankan lewat OLAH_KATEGORI yang SAMA dengan penyusuran —
 * bukan lewat penghitung terpisah — supaya satu baris baru dihitung dengan
 * aturan yang persis sama di mana pun ia masuk.
 */
const terapkanSusulanKeluarga = (o, rowsBaru) => {
  if (!rowsBaru.length) {
    return { grup: o.daftarGrup, kolom: o.kolom, wilayahPerId: o.wilayahPerId };
  }

  const delta = OLAH_KATEGORI.buat();
  rowsBaru.forEach((r) => OLAH_KATEGORI.tambah(delta, r));
  OLAH_KATEGORI.selesai(delta);

  // Salinan, BUKAN penimpaan. Objek potret tinggal di cache dan dibaca
  // permintaan lain; menambahkan susulan ke dalamnya berarti setiap ekspor
  // menggandakan baris yang sama di cache bersama.
  const kolom = new Map(o.kolom);
  delta.kolom.forEach((m, k) => kolom.set(k, gabungMetaKolom(kolom.get(k), m)));

  const wilayahPerId = new Map(o.wilayahPerId);
  delta.wilayahPerId.forEach((v, k) => wilayahPerId.set(k, v));

  return {
    grup: gabungGrupWilayah([...o.daftarGrup, ...delta.daftarGrup]),
    kolom,
    wilayahPerId
  };
};

/** Agregat anggota dari baris susulan, siap digabung ke potret. */
const olahSusulanAnggota = (rowsBaru, lookup) => {
  const kab = emberAnggota();
  const perWilayah = new Map();
  let terpeta = 0;
  let tanpaWilayah = 0;

  rowsBaru.forEach((a) => {
    const n = bacaAnggota(a);
    isiEmber(kab, n);
    const wilayah = wilayahAnggota(a, lookup);
    if (!wilayah) {
      tanpaWilayah += 1;
      return;
    }
    terpeta += 1;
    let e = perWilayah.get(wilayah);
    if (!e) {
      e = emberAnggota();
      perWilayah.set(wilayah, e);
    }
    isiEmber(e, n);
  });

  return { kab, perWilayah, terpeta, tanpaWilayah };
};

/** Potret anggota + susulannya, dalam bentuk yang sama dengan potret. */
const terapkanSusulanAnggota = (o, rowsBaru, lookup) => {
  if (!o || !rowsBaru.length) return o;
  const delta = olahSusulanAnggota(rowsBaru, lookup);

  const perWilayah = new Map(o.per_wilayah);
  delta.perWilayah.forEach((e, kunci) => {
    const ada = perWilayah.get(kunci);
    perWilayah.set(kunci, ada ? gabungEmber([ada, e]) : e);
  });

  return {
    ...bentukEmber(gabungEmber([o.mentah, delta.kab])),
    mentah: null,
    per_wilayah: perWilayah,
    terpeta: o.terpeta + delta.terpeta,
    tanpa_wilayah: o.tanpa_wilayah + delta.tanpaWilayah,
    id_terbesar: o.id_terbesar
  };
};

/** Berapa baris sensus paling banyak boleh ikut satu berkas ekspor. */
const MAX_BARIS_EKSPOR = Number(process.env.ASTADESA_MAX_BARIS_EKSPOR || 100000);

/**
 * Mulai menyusun ulang di latar, lalu balas "belum realtime".
 *
 * Dipanggil saat ekspor diminta tetapi potretnya sudah kedaluwarsa. Penyusuran
 * TIDAK ditunggu: ia memakan menit, sementara axios di frontend menyerah pada
 * detik ke-30. Yang dikirim adalah alasannya beserta angka-angka yang membuat
 * alasan itu bisa diperiksa sendiri oleh pembaca — bukan "coba lagi nanti".
 */
const tolakBelumRealtime = (res, kesiapan, mulaiUlang) => {
  mulaiUlang();
  const pesan = !kesiapan.siap
    ? 'Rincian per kecamatan/desa belum selesai disusun di server. Penyusunannya sudah berjalan — coba ekspor lagi beberapa menit.'
    : kesiapan.basi
      ? 'Data di server sudah kedaluwarsa dan sedang disusun ulang. Ekspor dibuka begitu potret terbarunya selesai.'
      : !kesiapan.susulan_tuntas
        ? `Baris baru di ASTA DESA terlalu banyak untuk disusul sekaligus (lebih dari ${angkaId(MAX_HALAMAN_SUSULAN * asta.MAX_PER_PAGE)} baris). Penyusunan ulang dari awal sudah berjalan — coba ekspor lagi beberapa menit.`
        : `Jumlah baris yang dipegang server masih berselisih ${angkaId(kesiapan.selisih)} dari hitungan ASTA DESA saat ini (toleransi ${angkaId(kesiapan.toleransi_selisih)}). Penyusunan ulang sudah berjalan — coba ekspor lagi beberapa menit.`;
  return res.status(409).json({ success: false, kode: 'belum_realtime', message: pesan, kesiapan });
};

/**
 * GET /api/asta-desa/demografi/wilayah
 *
 * SELURUH rincian demografi per kecamatan DAN per desa dalam satu muatan —
 * bahan ekspor Excel/PDF halaman Demografi.
 *
 * MENGAPA SATU MUATAN, BUKAN SATU PERMINTAAN PER DESA. Kabupaten Bogor punya
 * 40 kecamatan dan 400-an desa; memanggil endpoint kategori sekali per desa
 * berarti 400+ permintaan untuk satu klik "Ekspor", dan tiap permintaan
 * menyusun ulang agregat yang sama dari kelompok yang sama.
 *
 * BENTUKNYA SEJAJAR, BUKAN BERSARANG. Definisi kolom dan daftar nilainya
 * dikirim SEKALI di `kolom`; tiap wilayah hanya membawa deret angka yang
 * sejajar dengan daftar itu. Dengan 400-an desa x ~80 kolom, mengulang label
 * nilai di setiap desa berarti muatan belasan megabyte berisi teks yang sama
 * berulang-ulang.
 *
 * Demografi ANGGOTA ikut per wilayah lewat peta `id keluarga -> wilayah`
 * (lihat `wilayahAnggota`). Bila peta itu belum ada, bagian anggota tetap
 * terkirim se-kabupaten dan `anggota.per_wilayah_siap` bernilai false — ekspor
 * menuliskannya sebagai keterangan, bukan menyajikan angka kabupaten di bawah
 * nama desa.
 */
exports.getDemografiWilayah = jalankan(async (req, res) => {
  const force = paksa(req);
  const abaikan = req.query.abaikan_kesegaran === '1';

  const [peta, hidup] = await Promise.all([
    asta.ambilSemua('/sensuses', {}, { force, pengguna: true, latar: true, profil: PROFIL_PENGGUNA }),
    hitungTerkini(force)
  ]);
  const o = peta.olahan;

  // Baris keluarga terbaru disusul LEBIH DULU, dan kesiapan dinilai SETELAHNYA.
  // Urutan ini yang membuat ekspor sepadan dengan ASTA DESA: menilai lebih dulu
  // berarti menolak potret yang sebenarnya hanya tertinggal beberapa ratus
  // baris — baris yang bisa ditarik dalam satu dua permintaan.
  const susulanKeluarga = o ? await susulBaris('/sensuses', { pengguna: true }, idTerbesarBaris(peta.rows)) : null;
  const kesiapanKeluarga = kesiapanSusur(peta, hidup, susulanKeluarga);

  if (!o || (!kesiapanKeluarga.realtime && !abaikan)) {
    return tolakBelumRealtime(res, kesiapanKeluarga, () => {
      asta
        .ambilSemua('/sensuses', {}, { force: true, latar: true, pengguna: true, profil: PROFIL_PENGGUNA })
        .catch(() => {});
    });
  }

  const gabungan = terapkanSusulanKeluarga(o, susulanKeluarga.rows);
  const grupSemua = gabungan.grup;
  const lookup = gabungan.wilayahPerId?.size ? gabungan.wilayahPerId : null;

  const potretAnggota = await asta.ambilSemua('/sensus-anggotas', {}, {
    force,
    latar: true,
    profil: profilAnggota(lookup)
  });
  // Anggota keluarga baru ikut disusul dengan cara yang sama. Tanpa ini,
  // keluarga yang baru masuk akan tampil di rekap keluarga tetapi anggotanya
  // tidak terhitung — selisih yang justru paling mudah dikira kesalahan hitung.
  const susulanAnggota = potretAnggota.olahan
    ? await susulBaris('/sensus-anggotas', {}, potretAnggota.olahan.id_terbesar)
    : null;
  const kesiapanAnggota = kesiapanSusur(potretAnggota, null, susulanAnggota);

  if (potretAnggota.olahan && !kesiapanAnggota.realtime && !abaikan) {
    return tolakBelumRealtime(res, kesiapanAnggota, () => {
      asta
        .ambilSemua('/sensus-anggotas', {}, { force: true, latar: true, profil: profilAnggota(lookup) })
        .catch(() => {});
    });
  }

  const anggota = terapkanSusulanAnggota(potretAnggota.olahan, susulanAnggota?.rows || [], lookup);
  const anggotaPerWilayahSiap = Boolean(anggota?.per_wilayah?.size);

  const kategori = susunKategori(gabungKolom(grupSemua), gabungan.kolom);

  // Definisi kolom diratakan menjadi satu deret. `penyelaras` menyimpan kunci
  // normal tiap nilai — itulah yang dipakai mencocokkan hitungan per desa
  // dengan urutan label di atas. Kuncinya memang huruf kecil dari labelnya
  // (lihat OLAH_KATEGORI, yang memakai `n.toLowerCase()` sebagai kunci peta),
  // jadi pencocokan ini persis, bukan perkiraan.
  const kolom = [];
  const penyelaras = [];
  kategori.forEach((kat) => {
    kat.kolom.forEach((k) => {
      kolom.push({
        kunci: k.kunci,
        label: k.label,
        kategori: kat.kode,
        kategori_label: kat.label,
        jenis: k.jenis,
        terisi: k.terisi,
        nilai: k.jenis === 'angka' ? null : k.nilai.map((v) => v.label),
        statistik: k.jenis === 'angka' ? k.statistik : null
      });
      penyelaras.push(k.jenis === 'angka' ? null : k.nilai.map((v) => v.label.toLowerCase()));
    });
  });

  /** Deret hitungan satu wilayah, sejajar dengan `kolom` di atas. */
  const isiKolom = (petaKolom) =>
    kolom.map((def, i) => {
      const k = petaKolom.get(def.kunci);
      if (!k || !k.terisi) return null;
      if (def.jenis === 'angka') return { t: k.terisi, s: statistikAngka(k.angka) };
      return { t: k.terisi, n: penyelaras[i].map((normal) => k.hitung.get(normal)?.total || 0) };
    });

  // Label anggota juga ditetapkan sekali, se-kabupaten, lalu tiap wilayah
  // mengirim deret angka yang sejajar dengannya.
  const labelJk = ['Laki-laki', 'Perempuan', 'Tidak diketahui'];
  const labelDari = (daftar) => (daftar || []).map((x) => x.label);
  const labelPendidikan = labelDari(anggota?.per_pendidikan);
  const labelHubungan = labelDari(anggota?.per_hubungan);
  const labelDisabilitas = labelDari(anggota?.per_disabilitas);
  // `per_pekerjaan` dipangkas 20 teratas se-kabupaten, jadi deret per desa pun
  // hanya memuat ke-20 itu. Kolom pekerjaan belum ada di `sensus_anggotas`
  // sehingga daftar ini biasanya kosong; bila mereka menambahkannya nanti,
  // batas 20 itulah satu-satunya yang perlu ditinjau ulang.
  const labelPekerjaan = labelDari(anggota?.per_pekerjaan);

  const anggotaRingkas = (e) => ({
    total: e.total,
    tanpa_usia: e.tanpaUsia,
    jk: labelJk.map((l) => e.perJk.get(l) || 0),
    usia: e.piramida.map((b) => [b.L, b.P, b.lain, b.total]),
    pendidikan: labelPendidikan.map((l) => e.perPendidikan.get(l) || 0),
    hubungan: labelHubungan.map((l) => e.perHubungan.get(l) || 0),
    disabilitas: labelDisabilitas.map((l) => e.perDisabilitas.get(l) || 0),
    pekerjaan: labelPekerjaan.map((l) => e.perPekerjaan.get(l) || 0)
  });

  const emberDesa = (g) => (anggotaPerWilayahSiap ? anggota.per_wilayah.get(g.kunci) || null : null);

  const perDesa = grupSemua
    .map((g) => {
      const e = emberDesa(g);
      return {
        kecamatan: g.kecamatan,
        desa: g.desa,
        total_keluarga: g.n,
        kolom: isiKolom(g.kolom),
        anggota: e ? anggotaRingkas(e) : null
      };
    })
    .sort((a, b) => a.kecamatan.localeCompare(b.kecamatan, 'id') || a.desa.localeCompare(b.desa, 'id'));

  const perKec = new Map();
  grupSemua.forEach((g) => {
    if (!perKec.has(g.kecamatan)) perKec.set(g.kecamatan, []);
    perKec.get(g.kecamatan).push(g);
  });

  const perKecamatan = Array.from(perKec.entries())
    .map(([nama, daftar]) => {
      const ember = daftar.map(emberDesa).filter(Boolean);
      return {
        kecamatan: nama,
        total_keluarga: daftar.reduce((a, g) => a + g.n, 0),
        total_desa: daftar.length,
        kolom: isiKolom(gabungKolom(daftar)),
        anggota: ember.length ? anggotaRingkas(gabungEmber(ember)) : null
      };
    })
    .sort((a, b) => a.kecamatan.localeCompare(b.kecamatan, 'id'));

  res.json({
    success: true,
    data: {
      total_keluarga: grupSemua.reduce((a, g) => a + g.n, 0),
      total_kecamatan: perKecamatan.length,
      total_desa: perDesa.length,
      kolom,
      per_kecamatan: perKecamatan,
      per_desa: perDesa,
      anggota: {
        per_wilayah_siap: anggotaPerWilayahSiap,
        terpeta: anggota?.terpeta || 0,
        tanpa_wilayah: anggota?.tanpa_wilayah || 0,
        total: anggota?.total || 0,
        tanpa_usia: anggota?.tanpa_usia || 0,
        kelompok_usia: KELOMPOK_USIA.map((k) => k.label),
        label: {
          jk: labelJk,
          pendidikan: labelPendidikan,
          hubungan: labelHubungan,
          disabilitas: labelDisabilitas,
          pekerjaan: labelPekerjaan
        },
        piramida: anggota?.piramida || [],
        per_jenis_kelamin: anggota?.per_jenis_kelamin || [],
        per_pendidikan: anggota?.per_pendidikan || [],
        per_hubungan: anggota?.per_hubungan || [],
        per_disabilitas: anggota?.per_disabilitas || [],
        per_pekerjaan: anggota?.per_pekerjaan || []
      },
      kesiapan: {
        realtime: kesiapanKeluarga.realtime && kesiapanAnggota.realtime,
        dipaksa: abaikan,
        keluarga: kesiapanKeluarga,
        anggota: kesiapanAnggota
      }
    }
  });
});

/**
 * GET /api/asta-desa/sensus/ekspor
 *
 * Seluruh baris yang cocok dengan penyaring tabel Data Sensus — bukan satu
 * halaman 25 baris — untuk diekspor ke Excel/PDF.
 *
 * MENGAPA DISARING DI SINI, BUKAN DITERUSKAN KE ASTA DESA seperti `/sensus`.
 * Tabel di layar meminta 25 baris sekali jalan, jadi menyerahkan pencarian ke
 * sisi yang punya indeksnya memang paling benar. Ekspor meminta SEMUANYA:
 * tanpa penyaring itu berarti menyusuri ~960 halaman saat tombol ditekan, dan
 * tidak ada permintaan HTTP yang bertahan selama itu. Penyusuran penuh sudah
 * tersedia di memori — diperbarui tiap TTL dan dipanaskan di latar — jadi
 * penyaringnya dikerjakan di atas potret itu.
 *
 * Konsekuensinya jujur: yang keluar adalah potret, bukan kueri hidup. Karena
 * itu endpoint ini menolak bekerja selama potretnya belum selaras dengan
 * hitungan ASTA DESA saat ini (lihat `kesiapanSusur`).
 *
 * NIK DAN NOMOR KK DISAMARKAN KECUALI DIMINTA TEGAS (`lengkap=1`). Berkas
 * ekspor beredar lewat surel dan grup pesan, jauh dari halaman yang
 * melahirkannya; nomor utuh hanya ikut bila yang mengunduh memang memintanya.
 */
exports.getSensusEkspor = jalankan(async (req, res) => {
  const force = paksa(req);
  const abaikan = req.query.abaikan_kesegaran === '1';
  const lengkap = req.query.lengkap === '1';

  const fKec = rapikan(req.query.kecamatan)?.toLowerCase() || null;
  const fDesa = rapikan(req.query.desa)?.toLowerCase() || null;
  const fStatus = rapikan(req.query.status)?.toLowerCase() || null;
  const cari = rapikan(req.query.search)?.toLowerCase() || null;
  const dari = keHari(rapikan(req.query.dari));
  const sampai = keHari(rapikan(req.query.sampai));

  const [semua, hidup] = await Promise.all([
    asta.ambilSemua('/sensuses', {}, { force, latar: true, profil: PROFIL_ADMIN }),
    hitungTerkini(force)
  ]);

  // Baris yang masuk setelah potret disusun ditarik dan IKUT diekspor — bukan
  // sekadar dijadikan alasan menolak. Inilah yang membuat berkasnya memuat
  // pendataan yang baru masuk pagi ini, bukan hanya yang terbaca setengah jam
  // lalu. Hanya dicoba bila potretnya memang sudah ada: tanpa potret, tidak
  // ada patokan "sampai mana sudah terbaca".
  const adaPotret = semua.belum_siap !== true && Boolean(semua.disusun_pada);
  const susulan = adaPotret ? await susulBaris('/sensuses', {}, idTerbesarBaris(semua.rows)) : null;
  const kesiapan = kesiapanSusur(semua, hidup, susulan);

  if (!kesiapan.siap || (!kesiapan.realtime && !abaikan)) {
    return tolakBelumRealtime(res, kesiapan, () => {
      asta.ambilSemua('/sensuses', {}, { force: true, latar: true, profil: PROFIL_ADMIN }).catch(() => {});
    });
  }

  const cocokCari = (r) => {
    if (!cari) return true;
    // Kolom yang dicari sama dengan yang dijanjikan kotak pencarian di tabel:
    // nama KK, NIK, nomor KK, nama petugas. Dicocokkan pada nomor UTUH walau
    // yang keluar nanti tersamar — kalau tidak, mencari NIK lengkap tidak akan
    // pernah menemukan apa pun.
    return [r.kk_nama, r.kk_nik, r.kk_no_kk, r.petugas].some(
      (v) => v && String(v).toLowerCase().includes(cari)
    );
  };

  const terpakai = [];
  let cocok = 0;
  // `normalSensus` boleh dijalankan pada keduanya: baris potret sudah berbentuk
  // ringkas dan fungsi itu membaca kembali kunci keluarannya sendiri, sementara
  // baris susulan masih mentah. Baris susulan tidak mungkin kembar dengan
  // potret — yang ditarik hanya yang id-nya DI ATAS id tertinggi potret.
  const sumber = susulan?.rows?.length ? [...semua.rows, ...susulan.rows] : semua.rows;
  for (const mentah of sumber) {
    const r = normalSensus(mentah);
    if (fKec && r.kecamatan.toLowerCase() !== fKec) continue;
    if (fDesa && r.desa.toLowerCase() !== fDesa) continue;
    if (fStatus && r.status.toLowerCase() !== fStatus) continue;
    const hari = keHari(r.tanggal);
    if (dari && (!hari || hari < dari)) continue;
    if (sampai && (!hari || hari > sampai)) continue;
    if (!cocokCari(r)) continue;

    cocok += 1;
    if (terpakai.length >= MAX_BARIS_EKSPOR) continue;
    terpakai.push({
      id: r.id,
      kecamatan: r.kecamatan,
      desa: r.desa,
      status: r.status,
      petugas: r.petugas,
      tanggal: r.tanggal,
      kk_nama: r.kk_nama,
      kk_nik: lengkap ? r.kk_nik : samarkanNomor(r.kk_nik),
      kk_no_kk: lengkap ? r.kk_no_kk : samarkanNomor(r.kk_no_kk),
      jumlah_anggota: r.jumlah_anggota,
      lat: r.lat,
      lng: r.lng
    });
  }

  // Rekap dihitung dari SELURUH baris yang cocok, bukan dari yang lolos pagar
  // batas — kalau tidak, angka ringkasan di berkas akan bertentangan dengan
  // jumlah baris yang tertulis di lembar yang sama.
  const perKec = new Map();
  const perDesa = new Map();
  const perStatus = new Map();
  const perHari = new Map();
  terpakai.forEach((r) => {
    tambah(perKec, r.kecamatan);
    tambah(perDesa, `${r.kecamatan} / ${r.desa}`);
    tambah(perStatus, r.status);
    const h = keHari(r.tanggal);
    if (h) tambah(perHari, h);
  });

  res.json({
    success: true,
    data: {
      baris: terpakai,
      total_cocok: cocok,
      total_terkirim: terpakai.length,
      dibatasi: cocok > terpakai.length,
      batas: MAX_BARIS_EKSPOR,
      nomor_lengkap: lengkap,
      filter: {
        kecamatan: rapikan(req.query.kecamatan),
        desa: rapikan(req.query.desa),
        status: rapikan(req.query.status),
        search: rapikan(req.query.search),
        dari,
        sampai
      },
      rekap: {
        per_kecamatan: keDaftar(perKec, 'nama'),
        per_desa: keDaftar(perDesa, 'nama'),
        per_status: keDaftar(perStatus, 'nama'),
        per_hari: Array.from(perHari.entries())
          .map(([hari, total]) => ({ hari, total }))
          .sort((a, b) => a.hari.localeCompare(b.hari))
      },
      kesiapan: { ...kesiapan, dipaksa: abaikan }
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

// ── Peta sebaran penuh (WebGIS) ──────────────────────────────────────────────
//
// Endpoint di bawah melayani halaman Peta Sebaran yang meniru panel super admin
// ASTA DESA. Yang wilayah & cuaca meneruskan endpoint PUBLIK di sana — bukan grup
// admin — lewat `asta.ambilPublik`.

/**
 * GET /api/asta-desa/sebaran-peta
 * Titik sebaran dengan koordinat RUMAH — sumber peta penuh.
 *
 * BEDANYA DENGAN `/sebaran`. Yang itu menyusuri `/admin/sensuses`, yang resource-
 * nya hanya membawa `lokasi: {lat, lon}`; cukup untuk gelembung agregat per
 * kecamatan. Peta Sebaran super admin ASTA DESA menggambar `rumah_lat`/
 * `rumah_lon`, dan kolom itu tidak pernah ikut di resource admin. Jadi endpoint
 * ini menyusuri `/sensuses` (jalur pengguna, `opts.pengguna`) yang membalas model
 * apa adanya — satu-satunya jalan mencapai posisi titik yang sama tanpa meminta
 * perubahan di sisi ASTA DESA. Lihat `requestPengguna` di service.
 *
 * `/sebaran` dibiarkan utuh: tab ringkas sudah memakainya, barisnya lebih murah,
 * dan tidak ada gunanya membuat tab itu membayar muatan 104 kolom.
 *
 * Keduanya melaporkan `sumber_koordinat` supaya selisih jumlah titik antara
 * halaman ini dan panel bisa dijelaskan, bukan ditebak.
 */
exports.getSebaranPeta = jalankan(async (req, res) => {
  const force = paksa(req);

  // Sama seperti /sebaran: 73 halaman, 80 detik, batas frontend 30 detik.
  // Cache-nya berbagi kunci dengan /sebaran hanya bila `pengguna` sama — di
  // sini `pengguna: true`, jadi keduanya punya slot sendiri dan masing-masing
  // memanaskan cache-nya sendiri.
  const semua = await asta.ambilSemua('/sensuses', {}, { force, pengguna: true, latar: true, profil: PROFIL_PENGGUNA });

  let pakaiRumah = 0;
  let pakaiLokasi = 0;
  let tanpaKoordinat = 0;
  let diLuarWilayah = 0;

  const titik = [];

  semua.rows.forEach((row) => {
    // Koordinat rumah lebih dulu — itulah yang digambar panel. `lokasi_*` hanya
    // cadangan, supaya baris yang koordinat rumahnya belum diisi tetap terpeta
    // alih-alih hilang diam-diam.
    let lat = keAngka(row.rumah_lat);
    let lng = keAngka(row.rumah_lon);
    let sumber = 'rumah';

    if (lat === null || lng === null) {
      lat = keAngka(row.lokasi_lat);
      lng = keAngka(row.lokasi_lon);
      sumber = 'lokasi';
    }

    if (lat === null || lng === null) {
      tanpaKoordinat += 1;
      return;
    }
    if (!diKabupatenBogor(lat, lng)) {
      diLuarWilayah += 1;
      return;
    }

    if (sumber === 'rumah') pakaiRumah += 1;
    else pakaiLokasi += 1;

    titik.push({
      id: row.id ?? null,
      lat,
      lng,
      sumber_koordinat: sumber,
      kecamatan: rapikan(row.kecamatan) || 'Tidak diketahui',
      desa: rapikan(row.desa) || 'Tidak diketahui',
      status: rapikan(row.status) || 'tidak diketahui',
      kk_nama: rapikan(row.kk_nama),
      // NIK di endpoint ini SUDAH disamarkan ASTA DESA (maskPrivacy). Disamarkan
      // ulang di sini agar tetap aman bila suatu saat penyamaran di sana dicabut.
      nik: samarkanNomor(row.kk_nik),
      petugas: namaPetugas(row) || rapikan(row.user?.name),
      tanggal: keHari(row.tanggal_pendataan),
      foto: fotoRumahPertama(row)
    });
  });

  res.json({
    success: true,
    data: {
      titik,
      total_baris: semua.rows.length,
      tanpa_koordinat: tanpaKoordinat,
      di_luar_wilayah: diLuarWilayah,
      // Dilaporkan supaya halaman bisa menyebutkan berapa titik yang TIDAK
      // memakai koordinat rumah — satu-satunya sisa selisih dengan panel.
      pakai_koordinat_rumah: pakaiRumah,
      pakai_koordinat_lokasi: pakaiLokasi,
      sebagian: semua.truncated,
      rincian_siap: semua.rows.length > 0,
      rincian_basi: semua.basi === true
    }
  });
});

/**
 * GET /api/asta-desa/wilayah/kecamatan
 * Daftar nama kecamatan untuk penyaring. Balasan aslinya array string polos.
 *
 * Batas wilayah disimpan jauh lebih lama daripada TTL bawaan: tabel
 * `adm_kecamatan` di sana praktis tidak pernah berubah, sementara setiap
 * pembukaan halaman peta memanggil endpoint ini.
 */
const TTL_WILAYAH = 24 * 60 * 60 * 1000;

exports.getWilayahKecamatan = jalankan(async (req, res) => {
  const body = await asta.ambilPublik('/public/wilayah/kecamatans', {}, {
    force: paksa(req),
    ttlMs: TTL_WILAYAH
  });
  res.json({ success: true, data: Array.isArray(body) ? body : [] });
});

/** GET /api/asta-desa/wilayah/desa?kecamatan= — daftar desa satu kecamatan. */
exports.getWilayahDesa = jalankan(async (req, res) => {
  const kecamatan = rapikan(req.query.kecamatan);
  if (!kecamatan) {
    return res.status(400).json({ success: false, message: 'Parameter kecamatan wajib diisi.' });
  }
  // Jalurnya `desas` (jamak) di sisi ASTA DESA, sedangkan rute kita `desa`.
  const body = await asta.ambilPublik('/public/wilayah/desas', { kecamatan }, {
    force: paksa(req),
    ttlMs: TTL_WILAYAH
  });
  res.json({ success: true, data: Array.isArray(body) ? body : [] });
});

/**
 * GET /api/asta-desa/wilayah/geojson?kecamatan=&desa=
 * Geometri batas wilayah untuk disorot di peta.
 *
 * ASTA DESA membalas GEOMETRI polos (hasil ST_AsGeoJSON), bukan Feature — mis.
 * `{"type":"MultiPolygon","coordinates":[…]}`. Dibungkus di sini ke dalam
 * `data` agar seragam dengan endpoint lain halaman ini; frontend yang
 * membacanya kembali ke `ol.format.GeoJSON`.
 */
exports.getWilayahGeojson = jalankan(async (req, res) => {
  const kecamatan = rapikan(req.query.kecamatan);
  const desa = rapikan(req.query.desa);
  if (!kecamatan) {
    return res.status(400).json({ success: false, message: 'Parameter kecamatan wajib diisi.' });
  }

  const params = desa ? { kecamatan, desa } : { kecamatan };
  const body = await asta.ambilPublik('/public/wilayah/geojson', params, {
    force: paksa(req),
    ttlMs: TTL_WILAYAH
  });

  // Balasan bisa berupa `{error: "..."}` dengan status 200 pada kasus tertentu.
  if (!body || body.error) {
    return res.status(404).json({ success: false, message: 'Geometri wilayah tidak ditemukan.' });
  }

  res.json({ success: true, data: body });
});

/**
 * GET /api/asta-desa/cuaca?lat=&lon=
 * Prakiraan BMKG pada satu koordinat, seperti kartu cuaca di panel super admin.
 *
 * TTL-nya satu jam, sama dengan cache di sisi ASTA DESA: menyimpannya lebih lama
 * berarti menampilkan cuaca yang sudah lewat, lebih pendek tidak menambah
 * kesegaran apa pun karena server mereka tetap membalas dari cache-nya sendiri.
 *
 * Koordinatnya dibulatkan ke 3 desimal (±110 m) sebelum diteruskan. Tanpa itu
 * tiap klik di peta menjadi kunci cache yang berbeda, dan cache cuaca tumbuh
 * tanpa batas sambil tidak pernah sekali pun terpakai ulang.
 */
exports.getCuaca = jalankan(async (req, res) => {
  const lat = keAngka(req.query.lat);
  const lon = keAngka(req.query.lon);
  if (lat === null || lon === null) {
    return res.status(400).json({ success: false, message: 'Parameter lat dan lon wajib berupa angka.' });
  }

  const body = await asta.ambilPublik(
    '/public/weather',
    { lat: lat.toFixed(3), lon: lon.toFixed(3) },
    { force: paksa(req), ttlMs: 60 * 60 * 1000 }
  );

  // Kartu cuaca hanya digambar bila ada isinya; galat dari BMKG bukan alasan
  // menjatuhkan seluruh panel info yang dibuka pengguna.
  res.json({ success: true, data: body && !body.error ? body : null });
});

/**
 * POST /api/asta-desa/segarkan
 * Buang cache supaya permintaan berikutnya menarik data segar. Tombol "muat
 * ulang" di halaman memanggil ini; tanpa itu, data tertahan sampai TTL habis
 * dan pengguna yang tahu ada sensus baru masuk tidak punya cara melihatnya.
 */
exports.segarkan = jalankan(async (req, res) => {
  asta.bersihkanCache();
  // Langsung mulai menyusun ulang di latar — halaman tetap menyajikan angka
  // terakhir (bersihkanCache hanya menandainya kedaluwarsa) sampai yang baru siap.
  panaskan(true);
  res.json({ success: true, message: 'Data Asta Desa sedang disegarkan di latar' });
});

/**
 * Penyusuran penuh yang dipakai halaman, disiapkan di latar.
 *
 * Tanpa ini, pengunjung pertama setelah backend menyala (atau setelah cache
 * kedaluwarsa) selalu mendapati "data sedang disiapkan" — dan untuk ±1.650
 * halaman anggota keluarga, "sebentar" berarti beberapa menit. Dengan pemanasan,
 * penyusuran sudah berjalan sebelum ada yang membuka halaman, dan diulang tiap
 * TTL_SUSUR_MS sehingga hasilnya tidak pernah jauh tertinggal.
 *
 * Berurutan, bukan serentak: tiga penyusuran × enam permintaan bersamaan akan
 * membebani server ASTA DESA tiga kali lipat untuk selisih waktu yang tidak
 * dirasakan siapa pun.
 */
let sedangMemanaskan = false;

/**
 * Satu penyusuran pemanasan, dengan catatan waktunya di log.
 *
 * Kegagalan TIDAK dilempar ke atas: pemanasan adalah pekerjaan latar, dan satu
 * penyusuran yang gagal tidak boleh menghentikan dua lainnya.
 */
const susurPemanasan = async (jalur, opsi, catatan, force) => {
  try {
    const mulai = Date.now();
    const hasil = await asta.ambilSemua(jalur, {}, { ...opsi, force });
    console.log(
      `[asta-desa] ${jalur}${catatan ? ` (${catatan})` : ''}: ${hasil.terbaca} baris, ${hasil.pages} halaman, ` +
        `${Math.round((Date.now() - mulai) / 1000)} dtk${hasil.halaman_gagal ? `, ${hasil.halaman_gagal} halaman gagal` : ''}`
    );
    return hasil;
  } catch (err) {
    console.error(`[asta-desa] pemanasan ${jalur} gagal:`, err.message);
    return null;
  }
};

/**
 * Penyusuran penuh yang dipakai halaman, disiapkan di latar.
 *
 * Tanpa ini, pengunjung pertama setelah backend menyala (atau setelah cache
 * kedaluwarsa) selalu mendapati "data sedang disiapkan" — dan untuk ±1.650
 * halaman anggota keluarga, "sebentar" berarti beberapa menit. Dengan pemanasan,
 * penyusuran sudah berjalan sebelum ada yang membuka halaman, dan diulang tiap
 * TTL_SUSUR_MS sehingga hasilnya tidak pernah jauh tertinggal.
 *
 * Berurutan, bukan serentak: tiga penyusuran x enam permintaan bersamaan akan
 * membebani server ASTA DESA tiga kali lipat untuk selisih waktu yang tidak
 * dirasakan siapa pun.
 *
 * URUTANNYA SEKARANG MENGIKAT, bukan sekadar hemat. Penyusuran `/sensuses`
 * versi pengguna melahirkan peta `id keluarga -> wilayah`, dan penyusuran
 * anggota di langkah berikutnya memakainya untuk memecah demografi per
 * kecamatan/desa. Dibalik urutannya, hasil anggota akan tersimpan tanpa
 * rincian wilayah selama satu TTL penuh.
 */
const panaskan = async (force = false) => {
  if (!asta.terkonfigurasi() || sedangMemanaskan) return;
  sedangMemanaskan = true;
  try {
    await susurPemanasan('/sensuses', { profil: PROFIL_ADMIN }, 'admin', force);

    const peta = await susurPemanasan('/sensuses', { pengguna: true, profil: PROFIL_PENGGUNA }, 'pengguna', force);
    const lookup = peta?.olahan?.wilayahPerId?.size ? peta.olahan.wilayahPerId : null;
    if (!lookup) {
      console.warn(
        '[asta-desa] peta id keluarga -> wilayah kosong; demografi anggota akan tersaji se-kabupaten saja'
      );
    }

    await susurPemanasan(
      '/sensus-anggotas',
      { profil: profilAnggota(lookup) },
      lookup ? 'dengan wilayah' : 'tanpa wilayah',
      force
    );
  } finally {
    sedangMemanaskan = false;
  }
};

let pemanasanAktif = false;
exports.mulaiPemanasan = () => {
  if (pemanasanAktif || !asta.terkonfigurasi()) return;
  pemanasanAktif = true;
  // Jeda awal supaya tidak berebut dengan pekerjaan menyala lainnya.
  setTimeout(() => panaskan(false), 20 * 1000).unref();
  // Sedikit sebelum TTL habis, supaya pengunjung hampir tidak pernah menjumpai
  // hasil yang kedaluwarsa.
  setInterval(() => panaskan(true), Math.max(5 * 60 * 1000, asta.TTL_SUSUR_MS - 2 * 60 * 1000)).unref();
};
