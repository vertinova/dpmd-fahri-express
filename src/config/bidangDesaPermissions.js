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

  // SPKED — empat tab di SpkedPage.jsx persis sama dengan empat fitur ini.
  // `bantuan-provinsi-lpj` MILIK SINI, bukan KKD: yang memverifikasinya
  // checkRole('sarana_prasarana') di routes/dpmdBantuanProvinsiLpj.routes.js,
  // dan tabnya ada di SpkedPage.jsx.
  3: ['bankeu', 'bankeu-perubahan', 'bumdes', 'bantuan-provinsi-lpj'],

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
 * Hak akses yang boleh diberikan/dicabut oleh satu akun staf.
 * Array kosong berarti akun itu tidak berwenang mengelola akun desa sama sekali.
 */
const getAllowedPermissionKeys = (user) => {
  if (!user) return [];

  if (PERAN_LINTAS_BIDANG.includes(normalkanPeran(user.role))) {
    return [...DESA_PERMISSION_KEYS];
  }

  const bidangId = parseBidangId(user.bidang_id);
  if (bidangId === null) return [];

  const milikBidang = PERMISSION_PER_BIDANG[bidangId];
  if (!milikBidang) return [];

  // Bidang tanpa fitur desa (Sekretariat) tidak dapat pintu masuk lewat
  // permission lintas bidang — kalau tidak, ia bisa membuat akun desa
  // berisi "pesan" saja, yang bukan wewenangnya.
  if (milikBidang.length === 0) return [];

  return [...new Set([...milikBidang, ...PERMISSION_LINTAS_BIDANG])];
};

/** Benar bila akun staf ini berwenang mengelola akun operasional desa. */
const canManageDesaAccounts = (user) => getAllowedPermissionKeys(user).length > 0;

/**
 * Fitur INTI bidang — yang menjadi wewenangnya sendiri, tanpa fitur bersama.
 *
 * Dipakai untuk menjawab satu pertanyaan: "desa ini sudah punya operator untuk
 * urusan bidang saya atau belum?" Fitur bersama harus dikeluarkan, kalau tidak
 * setiap akun desa yang kebetulan punya `pesan` akan terbaca sebagai operator
 * kelembagaan — dan seluruh pencegahan akun ganda jadi salah sasaran.
 *
 * Untuk peran lintas bidang (superadmin, pimpinan dinas) hasilnya seluruh
 * katalog minus fitur bersama: mereka memang tidak mewakili satu bidang.
 */
const getCorePermissionKeys = (user) =>
  getAllowedPermissionKeys(user).filter((key) => !PERMISSION_LINTAS_BIDANG.includes(key));

/** Katalog (key + label + deskripsi) yang ditampilkan ke staf, sudah tersaring. */
const getPermissionCatalog = (user) => {
  const diizinkan = getAllowedPermissionKeys(user);
  return DESA_PERMISSIONS.filter((p) => diizinkan.includes(p.key));
};

/** Saring input sembarang menjadi key valid YANG JUGA menjadi wewenang staf ini. */
const sanitizeForActor = (input, user) => {
  const diizinkan = getAllowedPermissionKeys(user);
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
const mergePermissions = (existingKeys, submittedInput, user) => {
  const diizinkan = getAllowedPermissionKeys(user);
  const diluarWewenang = (Array.isArray(existingKeys) ? existingKeys : []).filter(
    (key) => !diizinkan.includes(key),
  );
  const didalamWewenang = sanitizeForActor(submittedInput, user);
  return [...new Set([...diluarWewenang, ...didalamWewenang])];
};

module.exports = {
  PERMISSION_PER_BIDANG,
  PERMISSION_LINTAS_BIDANG,
  PERAN_LINTAS_BIDANG,
  getAllowedPermissionKeys,
  getCorePermissionKeys,
  canManageDesaAccounts,
  getPermissionCatalog,
  sanitizeForActor,
  mergePermissions,
};
