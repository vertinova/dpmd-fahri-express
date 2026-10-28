/**
 * Peta bidang DPMD → fitur halaman Desa yang boleh dikelolanya.
 *
 * Latar belakangnya: Admin Desa membuat akun operasional desanya sendiri lewat
 * /api/desa-admin. Tapi banyak desa yang akunnya tidak kunjung dibuat, sehingga
 * staf bidang perlu bisa membuatkannya. Yang TIDAK boleh terjadi: staf satu
 * bidang memberi akses ke fitur bidang lain — pegawai PMD tidak berkepentingan
 * membuka Bantuan Keuangan, dan sebaliknya.
 *
 * Jadi katalog hak akses yang dilihat staf bidang bukan seluruh
 * `DESA_PERMISSIONS`, melainkan irisannya dengan bidang tempat ia bekerja.
 * Daftar di bawah ini satu-satunya tempat irisan itu ditentukan.
 *
 * `id` mengikuti tabel `bidangs`, sama dengan BIDANG_ROLE_MAP di middlewares/auth.js
 * dan konstanta BIDANG di frontend src/constants/bidang.js.
 */

const { DESA_PERMISSIONS, DESA_PERMISSION_KEYS } = require('./desaPermissions');

/**
 * Fitur milik bersama: bukan wewenang satu bidang, jadi bidang mana pun boleh
 * memberikannya. `pesan` masuk sini karena tanpanya akun desa yang baru dibuat
 * tidak punya jalan untuk bertanya balik ke DPMD.
 */
const PERMISSION_LINTAS_BIDANG = ['pesan'];

/**
 * bidang_id → hak akses fitur desa yang menjadi wewenang bidang itu.
 *
 * Patokannya BUKAN nama bidang, melainkan siapa yang benar-benar memverifikasi
 * unggahan desa itu di sisi DPMD. Sumber kebenarannya dua, dan keduanya harus
 * sepakat sebelum baris di sini diubah:
 *   - penjaga rute DPMD-nya (mis. routes/dpmdBantuanProvinsiLpj.routes.js), dan
 *   - tab/menu di halaman bidang (mis. pages/bidang/SpkedPage.jsx).
 *
 * Bidang yang daftarnya kosong tidak bisa membuat akun operator desa sama
 * sekali — itu memang benar untuk bidang yang tidak menerima unggahan desa.
 */
const PERMISSION_PER_BIDANG = {
  // Sekretariat — persuratan & kepegawaian, desa tidak mengunggah apa pun ke sini.
  2: [],

  // SPKED — tab di SpkedPage.jsx persis sama dengan daftar fitur ini.
  // `bantuan-provinsi-lpj` MILIK SINI, bukan KKD: yang memverifikasinya
  // checkRole('sarana_prasarana') di routes/dpmdBantuanProvinsiLpj.routes.js,
  // dan tabnya ada di SpkedPage.jsx. `kerjasama-desa` juga di sini: yang
  // memantaunya tab Kerja Sama Desa di halaman bidang yang sama.
  3: ['bankeu', 'bankeu-perubahan', 'bumdes', 'bantuan-provinsi-lpj', 'kerjasama-desa'],

  // KKD — ADD, Dana Desa, BHPRD, penyaluran Bankeu & Bantuan Provinsi. Semuanya
  // pencatatan penyaluran di sisi DPMD; tidak satu pun berupa unggahan desa,
  // jadi tidak ada fitur halaman desa yang menjadi wewenangnya. "Bantuan
  // Provinsi" di KKDPage.jsx adalah penyalurannya, BUKAN LPJ yang diunggah desa.
  4: [],

  // PMD — kelembagaan desa dan pengurusnya.
  5: ['kelembagaan'],

  // Pemdes — profil desa, aparatur, dan produk hukum desa.
  6: ['profil-desa', 'aparatur-desa', 'produk-hukum'],
};

/**
 * bidang_id → fitur PENDUKUNG: boleh diberikan bidang itu, tapi bukan wewenang
 * intinya dan karena itu tidak ikut menjawab "desa ini sudah punya operator
 * untuk urusan saya?".
 *
 * PMD memberi `produk-hukum` karena operator kelembagaan butuh mengunggah SK
 * pengurus RT/RW/LPM/dll. ke Produk Hukum sebelum bisa menautkannya. Yang
 * memverifikasi produk hukum tetap Pemdes; kalau `produk-hukum` dimasukkan ke
 * fitur inti PMD, operator produk hukum bikinan Pemdes akan terbaca sebagai
 * operator kelembagaan dan pencegahan akun ganda PMD salah sasaran.
 */
const PERMISSION_PENDUKUNG_PER_BIDANG = {
  5: ['produk-hukum'],
};

/**
 * Modul halaman bidang yang punya pintu "Akun Operator" sendiri.
 *
 * Satu bidang bisa berwenang atas beberapa fitur desa sekaligus (SPKED memegang
 * empat), tapi staf yang sedang berada di tab Bantuan Keuangan tidak sedang
 * mengurus BUMDes. Tanpa penyempitan ini, akun yang ia buat dari tab Bankeu
 * ikut membawa hak akses BUMDes, dan — yang lebih merugikan — pemeriksaan
 * "desa ini sudah punya operator?" jadi salah sasaran: desa yang sudah punya
 * operator BUMDes akan terbaca sudah punya operator Bankeu juga.
 *
 * `keys` SELALU diiriskan dengan wewenang bidang, tidak pernah menambahnya.
 * Jadi baris di sini tidak bisa dipakai memberi bidang fitur yang bukan
 * miliknya; paling jauh ia mempersempit.
 *
 * `slug_fitur` dipakai sebagai nilai token {fitur} pada template email massal.
 */
const MODUL_AKUN_DESA = {
  bankeu: {
    slug: 'bankeu',
    label: 'Bantuan Keuangan',
    slug_fitur: 'bankeu',
    keys: ['bankeu'],
  },
  bumdes: {
    slug: 'bumdes',
    label: 'BUMDes',
    slug_fitur: 'bumdes',
    keys: ['bumdes'],
  },
  'kerjasama-desa': {
    slug: 'kerjasama-desa',
    label: 'Kerja Sama Desa',
    slug_fitur: 'kerjasama',
    keys: ['kerjasama-desa'],
  },
  // Pemdes — dibuka dari halaman Perangkat Desa / BPD. Tanpa modul ini akun yang
  // dibuat dari sana ikut membawa Profil Desa dan Produk Hukum, dan "desa ini
  // sudah punya operator?" terjawab ya oleh operator produk hukum.
  'aparatur-desa': {
    slug: 'aparatur-desa',
    label: 'Perangkat Desa',
    slug_fitur: 'aparatur',
    keys: ['aparatur-desa'],
  },
  // PMD — halaman Akun Operator Desa milik PMD. Kelembagaan satu-satunya fitur
  // inti bidang itu, tapi tanpa modul halaman tersebut tidak mendapat Ekspor dan
  // Generate massal yang hanya tersedia untuk halaman terikat satu fitur.
  // `pendukung` ikut diberikan tapi tidak dihitung sebagai fitur inti modul
  // (lihat PERMISSION_PENDUKUNG_PER_BIDANG); tetap diiriskan dengan wewenang bidang.
  kelembagaan: {
    slug: 'kelembagaan',
    label: 'Kelembagaan',
    slug_fitur: 'kelembagaan',
    keys: ['kelembagaan'],
    pendukung: ['produk-hukum'],
  },
};

/** Modul dari slug yang dikirim frontend. null = halaman akun desa penuh (perilaku lama). */
const resolveModul = (slug) => {
  const kunci = String(slug || '').trim().toLowerCase();
  if (!kunci) return null;
  return MODUL_AKUN_DESA[kunci] || null;
};

/**
 * Peran yang melihat seluruh katalog tanpa memandang bidang_id.
 * Sengaja sempit: pimpinan dinas mengawasi semua bidang, sedangkan kepala_bidang
 * TIDAK di sini — ia tetap terikat bidang yang dipimpinnya.
 */
const PERAN_LINTAS_BIDANG = ['superadmin', 'kepala_dinas', 'sekretaris_dinas'];

const normalkanPeran = (peran) => String(peran || '').trim().toLowerCase();

const parseBidangId = (nilai) => {
  const angka = parseInt(nilai, 10);
  return Number.isNaN(angka) ? null : angka;
};

/**
 * Wewenang satu akun staf, dipisah menjadi fitur inti dan fitur pendukung.
 * null berarti akun itu tidak berwenang mengelola akun desa sama sekali.
 */
const hitungWewenang = (user, modulSlug = null) => {
  if (!user) return null;

  const lintasPeran = PERAN_LINTAS_BIDANG.includes(normalkanPeran(user.role));
  const bidangId = lintasPeran ? null : parseBidangId(user.bidang_id);

  const inti = lintasPeran
    ? DESA_PERMISSION_KEYS.filter((key) => !PERMISSION_LINTAS_BIDANG.includes(key))
    : bidangId === null
      ? null
      : PERMISSION_PER_BIDANG[bidangId] || null;

  // Bidang tanpa fitur desa (Sekretariat) tidak dapat pintu masuk lewat
  // permission lintas bidang maupun pendukung — kalau tidak, ia bisa membuat
  // akun desa berisi "pesan" saja, yang bukan wewenangnya.
  if (!inti || inti.length === 0) return null;

  const pendukung = lintasPeran ? [] : PERMISSION_PENDUKUNG_PER_BIDANG[bidangId] || [];

  const modul = resolveModul(modulSlug);
  if (!modul) return { inti, pendukung };

  // IRISAN, bukan penggantian: modul hanya boleh mempersempit. Bidang yang
  // tidak memegang fitur inti modul ini berakhir tanpa wewenang, dan
  // canManageDesaAccounts() menolaknya di gerbang rute.
  const intiModul = inti.filter((key) => modul.keys.includes(key));
  if (intiModul.length === 0) return null;
  const bolehDiberikan = [...inti, ...pendukung];
  const pendukungModul = (modul.pendukung || []).filter((key) => bolehDiberikan.includes(key));
  return { inti: intiModul, pendukung: pendukungModul };
};

/**
 * Hak akses yang boleh diberikan/dicabut oleh satu akun staf.
 * Array kosong berarti akun itu tidak berwenang mengelola akun desa sama sekali.
 */
const getAllowedPermissionKeys = (user, modulSlug = null) => {
  const wewenang = hitungWewenang(user, modulSlug);
  if (!wewenang) return [];
  return [...new Set([...wewenang.inti, ...wewenang.pendukung, ...PERMISSION_LINTAS_BIDANG])];
};

/**
 * Benar bila akun staf ini berwenang mengelola akun operasional desa.
 * Dengan `modulSlug`, pertanyaannya menyempit: "berwenang untuk modul ini?" —
 * staf PMD yang membuka pintu akun operator Bankeu dijawab tidak.
 */
const canManageDesaAccounts = (user, modulSlug = null) =>
  getAllowedPermissionKeys(user, modulSlug).length > 0;

/**
 * Fitur INTI bidang — yang menjadi wewenangnya sendiri, tanpa fitur bersama.
 *
 * Dipakai untuk menjawab satu pertanyaan: "desa ini sudah punya operator untuk
 * urusan bidang saya atau belum?" Fitur bersama harus dikeluarkan, kalau tidak
 * setiap akun desa yang kebetulan punya `pesan` akan terbaca sebagai operator
 * kelembagaan — dan seluruh pencegahan akun ganda jadi salah sasaran.
 *
 * Fitur pendukung (Produk Hukum untuk PMD) dikeluarkan dengan alasan yang
 * sama: operator produk hukum bikinan Pemdes bukan operator kelembagaan.
 *
 * Untuk peran lintas bidang (superadmin, pimpinan dinas) hasilnya seluruh
 * katalog minus fitur bersama: mereka memang tidak mewakili satu bidang.
 */
const getCorePermissionKeys = (user, modulSlug = null) => {
  const wewenang = hitungWewenang(user, modulSlug);
  return wewenang ? [...wewenang.inti] : [];
};

/** Katalog (key + label + deskripsi) yang ditampilkan ke staf, sudah tersaring. */
const getPermissionCatalog = (user, modulSlug = null) => {
  const diizinkan = getAllowedPermissionKeys(user, modulSlug);
  return DESA_PERMISSIONS.filter((p) => diizinkan.includes(p.key));
};

/** Saring input sembarang menjadi key valid YANG JUGA menjadi wewenang staf ini. */
const sanitizeForActor = (input, user, modulSlug = null) => {
  const diizinkan = getAllowedPermissionKeys(user, modulSlug);
  const mentah = Array.isArray(input) ? input : [];
  const bersih = mentah
    .map((key) => String(key || '').trim())
    .filter((key) => diizinkan.includes(key));
  return [...new Set(bersih)];
};

/**
 * Gabungkan hak akses lama dengan yang dikirim staf bidang.
 *
 * Ini bagian terpenting berkas ini. Satu akun desa bisa memegang fitur dari
 * beberapa bidang sekaligus — misal `kelembagaan` dari PMD dan `bankeu` dari
 * Admin Desa. Kalau penyimpanan dilakukan dengan "hapus semua lalu tulis ulang"
 * seperti di desaAdmin.controller.js, staf PMD yang sekadar menyimpan form akan
 * MENGHAPUS `bankeu` tanpa pernah melihatnya. Maka: yang di luar wewenang staf
 * dipertahankan apa adanya, yang di dalam wewenangnya diganti dengan kiriman.
 */
const mergePermissions = (existingKeys, submittedInput, user, modulSlug = null) => {
  const diizinkan = getAllowedPermissionKeys(user, modulSlug);
  const diluarWewenang = (Array.isArray(existingKeys) ? existingKeys : []).filter(
    (key) => !diizinkan.includes(key),
  );
  const didalamWewenang = sanitizeForActor(submittedInput, user, modulSlug);
  return [...new Set([...diluarWewenang, ...didalamWewenang])];
};

module.exports = {
  MODUL_AKUN_DESA,
  resolveModul,
  PERMISSION_PER_BIDANG,
  PERMISSION_PENDUKUNG_PER_BIDANG,
  PERMISSION_LINTAS_BIDANG,
  PERAN_LINTAS_BIDANG,
  getAllowedPermissionKeys,
  getCorePermissionKeys,
  canManageDesaAccounts,
  getPermissionCatalog,
  sanitizeForActor,
  mergePermissions,
};
