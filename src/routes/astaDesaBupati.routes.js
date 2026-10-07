/**
 * API Asta Desa untuk pihak Bupati — dijaga API key, BUKAN login DPMD.
 * Base path: /api/eksternal/asta-desa
 *
 * Kenapa berkas rute tersendiri, bukan menambah jalur di astadesa.routes.js:
 * di sana `router.use(auth)` + `checkRole(PERAN_INTERNAL_DPMD)` berlaku untuk
 * SEMUA jalur. Menyisipkan satu jalur ber-API-key di tengahnya berarti berharap
 * orang berikutnya menyadari bahwa satu baris di daftar itu punya penjaga yang
 * berbeda — dan daftar seperti itu selalu dibaca sebagai "semuanya sama".
 *
 * HANDLER-NYA DIPAKAI ULANG, BUKAN DISALIN. Angka yang dilihat pihak Bupati
 * harus mustahil berbeda dari angka di Core Dashboard DPMD; dua jalur agregasi
 * untuk hal yang sama adalah cara paling pasti membuat dua pejabat membawa dua
 * angka berbeda ke rapat yang sama. Yang ditambahkan di sini hanya lapisan di
 * sekeliling handler: penjaga kunci, pembatas laju, penyamaran nomor identitas,
 * dan pencabutan `force`.
 *
 * ── Catatan kepemilikan data ────────────────────────────────────────────────
 * Data ini BUKAN milik DPMD. Ia dibaca dari astadesa.rmlabs.id memakai token
 * `super_admin` bernama `core-dashboard-dpmd` yang diterbitkan untuk Core
 * Dashboard DPMD. Menyalurkannya ke instansi lain — terutama baris per-keluarga
 * — adalah keputusan berbagi-pakai data, bukan sekadar menyalakan endpoint.
 * Izin pemilik data ASTA DESA perlu dipegang sebelum kuncinya diserahkan.
 * Karena itu kuncinya terpisah dari CORE_DASHBOARD_API_KEY: mencabut akses
 * pihak Bupati cukup dengan mengosongkan satu variabel, tanpa menyentuh akses
 * lain dan tanpa mencabut token ASTA DESA.
 */

const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const controller = require('../controllers/astadesa.controller');
const asta = require('../services/astadesa.service');
const { buatPenjagaApiKey } = require('../utils/apiKey');

const ENV_KUNCI = 'ASTADESA_BUPATI_API_KEY';

/**
 * Tolak dengan jelas bila sambungan ke ASTA DESA belum disetel di server ini.
 *
 * Di dalam DPMD, handler-nya sengaja toleran: halaman Core Dashboard menampilkan
 * petunjuk pemasangan, bukan tembok galat, karena yang membuka halaman tidak
 * melakukan kesalahan apa pun. Dari luar, toleransi yang sama berbahaya —
 * `/ringkasan` membalas 200 dengan `total_sensus: 0`, dan dashboard Bupati akan
 * memasang "0 keluarga terdata" sebagai angka resmi. Nol yang berarti "sumbernya
 * mati" tidak boleh terkirim dengan status 200.
 */
const wajibTersambung = (req, res, next) => {
  if (asta.terkonfigurasi()) return next();
  return res.status(503).json({
    success: false,
    message: 'Sambungan ke sumber data ASTA DESA belum disetel di server DPMD. '
      + 'Angka tidak dikirim agar tidak terbaca sebagai nol yang sebenarnya.',
  });
};

/* ─────────────────────────── Penyamaran identitas ─────────────────────────── */

/**
 * Kunci apa pun yang memuat nomor identitas. Dicocokkan dengan pola, bukan
 * daftar tetap: tabel `sensuses` di ASTA DESA punya ±104 kolom yang tidak
 * terdokumentasi, dan daftar tetap akan diam-diam melewatkan kolom identitas
 * baru begitu mereka menambah pertanyaan kuesioner.
 */
const POLA_NOMOR_IDENTITAS = /(^|_)(nik|no_kk|nomor_kk|kk_nik|kk_no_kk)$/i;

/** 6 digit pertama, sisanya bintang — sama dengan penyamaran di ASTA DESA. */
const samarkan = (v) => {
  const s = v === null || v === undefined ? null : String(v).trim();
  return s ? `${s.slice(0, 6)}**********` : null;
};

/**
 * Samarkan setiap nomor identitas di dalam struktur respons, sedalam apa pun.
 *
 * Dikerjakan di sini, pada respons yang sudah jadi, BUKAN dengan mempercayai
 * penyamaran di hulu. `normalSensus` di controller meneruskan `kk_nik` apa
 * adanya karena di dalam DPMD memang NIK utuh yang dibutuhkan, dan penyamaran
 * di sisi ASTA DESA bisa dicabut kapan pun tanpa memberi tahu kita. Dua-duanya
 * berarti NIK utuh akan ikut keluar tanpa ada satu pun galat yang muncul —
 * kebocoran yang tidak berbunyi.
 */
const samarkanDalam = (nilai, kedalaman = 0) => {
  if (kedalaman > 12 || nilai === null || typeof nilai !== 'object') return nilai;

  if (Array.isArray(nilai)) {
    for (let i = 0; i < nilai.length; i += 1) nilai[i] = samarkanDalam(nilai[i], kedalaman + 1);
    return nilai;
  }

  for (const kunci of Object.keys(nilai)) {
    if (POLA_NOMOR_IDENTITAS.test(kunci)) nilai[kunci] = samarkan(nilai[kunci]);
    else nilai[kunci] = samarkanDalam(nilai[kunci], kedalaman + 1);
  }
  return nilai;
};

/**
 * Bungkus res.json supaya setiap respons di bawah rute ini melewati penyamaran.
 * Dipasang sebagai middleware, bukan dipanggil di tiap handler: handler-nya
 * milik controller internal yang tidak boleh tahu ia sedang dipakai dari luar,
 * dan "jangan lupa panggil samarkan()" adalah syarat yang pasti terlupa saat
 * endpoint baru ditambahkan di bawah.
 */
const penyamarRespons = (req, res, next) => {
  const asli = res.json.bind(res);
  res.json = (body) => asli(samarkanDalam(body));
  next();
};

/* ────────────────────────────── Pagar pengaman ────────────────────────────── */

/**
 * Cabut `force`. Di jalur internal, `?force=1` melewati cache untuk sekali
 * tarik — murah karena dipakai satu-dua petugas yang menekan "Muat ulang".
 * Dari luar, satu permintaan ber-`force` memicu penyusuran sampai 20.000 baris
 * ke ASTA DESA; aplikasi pihak ketiga yang memasangnya di auto-refresh tiap
 * menit akan menjatuhkan server ORANG LAIN, bukan server kita.
 */
const cabutForce = (req, res, next) => {
  delete req.query.force;
  next();
};

/**
 * Pembatas laju. Angkanya longgar untuk dashboard yang menyegarkan diri, tapi
 * cukup rendah untuk mencegah penarikan massal baris per-keluarga.
 */
const batas = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: 'Terlalu banyak permintaan. Batasnya 60 permintaan per menit per alamat IP.',
  },
});

/* ──────────────────────────── Halaman petunjuk ───────────────────────────── */

/**
 * Dibuka di peramban tanpa kunci → halaman petunjuk, bukan 401 JSON.
 *
 * Yang pertama membuka URL ini hampir pasti orang yang baru menerima tautannya
 * dan belum tahu harus mengirim header apa. Membalasnya dengan {"message":"API
 * key tidak valid"} membuat ia menyimpulkan kuncinya salah lalu menagih kunci
 * baru, padahal yang kurang cuma header.
 */
const halamanPetunjuk = (req, res) => {
  const asal = `${req.protocol}://${req.get('host')}/api/eksternal/asta-desa`;
  res.status(200).type('html').send(`<!doctype html>
<html lang="id">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>API Asta Desa — DPMD Kabupaten Bogor</title>
<style>
  :root{color-scheme:light;--bg:#f6f8fb;--panel:#fff;--ink:#152033;--muted:#667085;--line:#d9e2ef;--brand:#0f766e}
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.6 "Segoe UI",system-ui,-apple-system,Arial,sans-serif;padding:clamp(16px,4vw,48px)}
  main{max-width:860px;margin:0 auto}
  h1{font-size:clamp(20px,3vw,26px);margin:0 0 6px}
  h2{font-size:15px;margin:28px 0 10px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted)}
  .panel{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:clamp(16px,3vw,24px)}
  p{margin:0 0 10px}
  code,pre{font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:13px}
  pre{background:#0f172a;color:#e2e8f0;padding:14px 16px;border-radius:10px;overflow:auto}
  table{width:100%;border-collapse:collapse;font-size:14px}
  th,td{text-align:left;padding:8px 10px;border-bottom:1px solid var(--line);vertical-align:top}
  th{color:var(--muted);font-weight:600;font-size:12px;text-transform:uppercase;letter-spacing:.04em}
  td code{color:var(--brand)}
  .nb{background:#fff8e6;border:1px solid #f0d89a;border-radius:10px;padding:12px 14px;margin-top:18px;font-size:14px}
  footer{color:var(--muted);font-size:13px;margin-top:22px}
</style>
</head>
<body><main>
  <div class="panel">
    <h1>API Asta Desa</h1>
    <p>Dinas Pemberdayaan Masyarakat dan Desa Kabupaten Bogor. Data pendataan keluarga ASTA DESA, sudah diagregasi. Seluruh endpoint <strong>hanya baca</strong>.</p>

    <h2>Autentikasi</h2>
    <p>Sertakan API key di salah satu header berikut pada setiap permintaan:</p>
    <pre>curl -H "X-API-Key: &lt;kunci-anda&gt;" \\
  "${asal}/ringkasan"

# atau
curl -H "Authorization: Bearer &lt;kunci-anda&gt;" "${asal}/ringkasan"</pre>

    <h2>Endpoint</h2>
    <table>
      <tr><th>Path</th><th>Isi</th></tr>
      <tr><td><code>GET /ringkasan</code></td><td>Total keluarga terdata, rekap per kecamatan &amp; desa, per status, petugas teraktif, tren harian</td></tr>
      <tr><td><code>GET /demografi</code></td><td>Agregat anggota keluarga: jenis kelamin, piramida usia, pendidikan, hubungan keluarga, disabilitas</td></tr>
      <tr><td><code>GET /sebaran</code></td><td>Titik koordinat untuk peta + rekap per kecamatan</td></tr>
      <tr><td><code>GET /sensus</code></td><td>Baris per keluarga. Penyaring: <code>kecamatan</code>, <code>desa</code>, <code>status</code>, <code>dari</code>, <code>sampai</code>, <code>search</code>, <code>page</code>, <code>per_page</code></td></tr>
      <tr><td><code>GET /wilayah/kecamatan</code></td><td>Daftar nama kecamatan (untuk penyaring)</td></tr>
      <tr><td><code>GET /wilayah/desa?kecamatan=</code></td><td>Daftar nama desa satu kecamatan</td></tr>
    </table>

    <h2>Yang perlu diperhatikan saat membaca angkanya</h2>
    <table>
      <tr><th>Field</th><th>Artinya</th></tr>
      <tr><td><code>total_sensus</code></td><td>Angka resmi, hitungan hidup dari server ASTA DESA. <strong>Pakai ini</strong> untuk menyebut jumlah keluarga terdata — jangan menghitung panjang array.</td></tr>
      <tr><td><code>total_terbaca</code></td><td>Berapa baris yang benar-benar terbaca dan menyusun rekap di bawahnya. Bisa lebih kecil dari <code>total_sensus</code>.</td></tr>
      <tr><td><code>rincian_siap</code></td><td><strong>Periksa ini lebih dulu.</strong> Bila <code>false</code>, rincian yang dihitung dari seluruh baris belum tersedia — <code>/sebaran</code> membalas <code>titik: []</code> dan beberapa angka bernilai <code>null</code>. Itu berarti "belum terbaca", <strong>bukan</strong> "tidak ada data". Jangan menggambar peta kosong atau angka 0; tampilkan keadaan memuat. Terjadi beberapa menit setelah backend DPMD di-restart, karena rinciannya disusun dari penyusuran ±190.000 baris yang perlu waktu.</td></tr>
      <tr><td><code>rincian_dari</code></td><td><code>"baris"</code> = rincian dihitung dari seluruh baris sensus (lengkap). <code>"ringkasan"</code> = masih memakai rekap ringkas dari ASTA DESA, jadi rincian seperti jumlah desa dan berapa yang berkoordinat belum bisa diketahui dan dikirim sebagai <code>null</code>.</td></tr>
      <tr><td><code>rincian_basi</code></td><td>Rincian yang dikirim berasal dari pembacaan sebelumnya yang sudah kedaluwarsa, sementara pembacaan baru masih berjalan. Angkanya tetap layak dipakai, hanya tidak paling baru.</td></tr>
      <tr><td><code>sebagian</code> / <code>kena_pagar</code></td><td>Bila <code>true</code>: pembacaan berhenti di pagar pengaman, jadi rekapnya angka sebagian — bukan total resmi.</td></tr>
      <tr><td><code>tanpa_koordinat</code></td><td>Baris yang tidak bisa dipetakan. Lubang di peta berarti "koordinat belum diisi", bukan "tidak ada keluarga di sana" — tampilkan angka ini di samping petanya.</td></tr>
      <tr><td><code>di_luar_wilayah</code></td><td>Baris berkoordinat tetapi koordinatnya jatuh di luar Kabupaten Bogor (koordinat salah).</td></tr>
      <tr><td><code>diambil_pada</code></td><td>Waktu data ini dibaca dari ASTA DESA (ISO 8601). Pakai ini untuk label "terakhir diperbarui", bukan waktu permintaan Anda sendiri.</td></tr>
    </table>

    <p><strong>Pola pembacaan yang disarankan:</strong> <code>total_sensus</code> dan <code>total_anggota_tercatat</code> selalu terisi dan selalu angka resmi — pakai keduanya untuk kartu angka utama, sehingga papan utama tidak pernah kosong. Grafik dan peta yang bergantung pada rincian ditampilkan hanya bila <code>rincian_siap === true</code>.</p>

    <div class="nb">
      <strong>NIK dan nomor KK selalu tersamar</strong> — hanya 6 digit pertama yang dikirim, sisanya bintang. Tidak ada cara memperoleh nomor utuh lewat API ini.
      Batas laju <strong>60 permintaan per menit</strong> per alamat IP. Respons di-cache ±10 menit di sisi kami, kecuali angka pokok yang disegarkan tiap menit —
      menyegarkan lebih cepat dari itu tidak menghasilkan angka yang lebih baru, dan <code>?force=1</code> tidak berlaku di sini.
    </div>

    <footer>Butuh kunci, kenaikan batas laju, atau endpoint lain? Hubungi Bidang SPKED DPMD Kabupaten Bogor.</footer>
  </div>
</main></body>
</html>`);
};

/* ──────────────────────────────── Rute ──────────────────────────────────── */

router.use(batas);
router.use(buatPenjagaApiKey({ env: ENV_KUNCI, realm: 'AstaDesaBupati', halaman: halamanPetunjuk }));
router.use(cabutForce);
router.use(wajibTersambung);
router.use(penyamarRespons);

router.get('/ringkasan', controller.getRingkasan);
router.get('/demografi', controller.getDemografi);
router.get('/sebaran', controller.getSebaran);
router.get('/sensus', controller.getSensus);
router.get('/wilayah/kecamatan', controller.getWilayahKecamatan);
router.get('/wilayah/desa', controller.getWilayahDesa);

/*
 * SENGAJA TIDAK DIBUKA di sini, dan masing-masing punya alasannya sendiri:
 *
 *   /sensus/:id   — membalas ±104 kolom APA ADANYA, tanpa penyaringan: alamat
 *                   lengkap, tanggal & tempat lahir, nomor telepon, foto rumah,
 *                   dan seluruh anggota keluarga. Yang disetujui untuk keluar
 *                   adalah BARIS per keluarga, bukan berkas keluarganya.
 *   /pengguna     — akun pegawai ASTA DESA beserta email dan NIP. Bukan data
 *                   pendataan, dan bukan milik DPMD untuk dibagikan.
 *   /pesan        — isi percakapan antar petugas.
 *   /segarkan     — membuang cache; dari luar ini tombol untuk membebani server
 *                   ASTA DESA, bukan fitur.
 *   /demografi/kategori, /layer, /wilayah/geojson, /cuaca, /sebaran-peta —
 *                   belum ada yang memintanya. Menambah endpoint nanti mudah;
 *                   menarik kembali endpoint yang sudah dipakai pihak lain
 *                   tidak.
 */

module.exports = router;
