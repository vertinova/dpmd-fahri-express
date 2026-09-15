# Integrasi ASTA DESA — Core Dashboard

Halaman **Asta Desa** di Core Dashboard (`/core-dashboard/asta-desa`) menampilkan
data pendataan keluarga dari aplikasi ASTA DESA (`https://astadesa.rmlabs.id`).
Seluruh jalurnya **read-only** — tidak ada satu pun endpoint di sisi kita yang
menulis ke sana.

---

## 1. Mengapa lewat backend, bukan langsung dari browser

API super admin ASTA DESA menuntut dua hal sekaligus: token Sanctum, dan akun
pemilik token itu harus ber-role `super_admin`. Token seperti itu **tidak boleh
sampai ke browser**. Siapa pun yang membuka DevTools akan memegang akses baca
seluruh tabel sensus ASTA DESA — termasuk NIK dan nomor KK puluhan ribu warga —
jauh melampaui apa yang halaman ini tampilkan.

Jadi alurnya:

```
Browser  ──JWT DPMD──▶  /api/asta-desa (backend kita)  ──Bearer Sanctum──▶  astadesa.rmlabs.id
```

Kredensial tinggal di `.env` server, token tinggal di memori proses Node, dan
frontend tidak pernah tahu keduanya ada.

Efek samping yang menguntungkan: agregasi dikerjakan di dekat cache. API ASTA
DESA berpaginasi maksimum 200 baris, sedangkan halaman ini butuh angka
se-kabupaten. Kalau frontend disuruh menyusuri 40 halaman sendiri, satu kali buka
halaman berarti 40 permintaan lintas-jaringan dan peta yang menetas
sepotong-sepotong.

---

## 2. Konfigurasi

Di `backend/.env`:

```dotenv
# Akun WAJIB ber-role super_admin di ASTA DESA.
ASTADESA_IDENTITY=<email atau username>
ASTADESA_PASSWORD=<password>

# Alternatif bila password tidak ingin disimpan di server.
# Kalau diisi, login dilewati sama sekali.
ASTADESA_TOKEN=<token Sanctum>

ASTADESA_BASE_URL=https://astadesa.rmlabs.id/api/v1
ASTADESA_TIMEOUT_MS=20000
ASTADESA_TTL_MS=600000    # umur cache respons (10 menit)
ASTADESA_MAX_ROWS=20000   # pagar pengaman penyusuran seluruh halaman
```

Setelah diubah, **jalankan ulang proses backend** (token dan cache ada di memori).

Selama `ASTADESA_IDENTITY`/`ASTADESA_PASSWORD`/`ASTADESA_TOKEN` masih kosong,
halaman tidak memunculkan galat merah — ia memunculkan petunjuk pemasangan ini,
karena yang membuka halaman tidak melakukan kesalahan apa pun.

### Menerbitkan token Sanctum langsung di server ASTA DESA

Cara yang dipakai untuk server produksi DPMD — dipilih karena password akun
`super_admin` tidak perlu ikut tersimpan di `.env` kita:

```php
// Dijalankan di server ASTA DESA (Laravel), sebagai user web.
$u = \App\Models\User::find(<id akun super_admin>);
$u->tokens()->where('name', 'core-dashboard-dpmd')->delete();  // jangan menumpuk token yatim
echo $u->createToken('core-dashboard-dpmd')->plainTextToken;
```

Dua hal yang mudah menjebak:

- **Jangan lewat `php artisan tinker <berkas>`.** Perintah itu menyertakan
  berkasnya lalu membuka REPL; lewat SSH tanpa TTY ia menggantung tanpa batas.
  Bootstrap Laravel-nya secara manual (`require vendor/autoload.php` →
  `bootstrap/app.php` → `Kernel::bootstrap()`) supaya skripnya selesai dan
  keluar.
- **Jangan biarkan tokennya melewati terminal, argumen perintah, atau riwayat
  shell.** Token itu setara akses baca seluruh sensus. Pindahkan lewat berkas
  ber-`chmod 600` langsung ke `.env` tujuan.

Nama token sengaja tetap (`core-dashboard-dpmd`) supaya token lama dengan nama
yang sama dicabut saat diterbitkan ulang, dan token milik integrasi lain tidak
ikut tersentuh.

### Catatan soal field login

Dokumen API ASTA DESA menulis `email=...&password=...`, tetapi servernya menolak
itu dengan `422 The identity field is required`. Field yang benar adalah
**`identity`** (boleh berisi email atau username). Layanan kita mengirim keduanya
agar tetap jalan bila suatu saat mereka menyeragamkannya.

---

## 3. Endpoint kita

Semua di balik `auth` + `checkRole(PERAN_INTERNAL_DPMD)` — sama dengan halaman
Core Dashboard lain. Lihat [`src/routes/astadesa.routes.js`](../src/routes/astadesa.routes.js).

| Metode | Path | Isi |
| --- | --- | --- |
| GET | `/api/asta-desa/status` | Apakah integrasinya sudah disetel (dipanggil halaman lebih dulu) |
| GET | `/api/asta-desa/ringkasan` | Jumlah keluarga terdata (hitungan hidup dari server) + rekap per kecamatan/desa/status/petugas + tren harian |
| GET | `/api/asta-desa/sebaran` | Titik koordinat untuk peta + rekap per kecamatan |
| GET | `/api/asta-desa/sensus` | Tabel sensus (filter & paginasi diteruskan ke ASTA DESA) |
| GET | `/api/asta-desa/sensus/:id` | Detail satu sensus — `{ sensus, anggotas, petugas }` |
| GET | `/api/asta-desa/pengguna` | Halaman daftar akun + rekap peran dari seluruh akun |
| GET | `/api/asta-desa/demografi` | Agregat anggota keluarga: jenis kelamin, piramida usia, pendidikan, hubungan, disabilitas |
| GET | `/api/asta-desa/layer` | Layer peta ASTA DESA |
| GET | `/api/asta-desa/pesan` | Riwayat pesan (berpaginasi) |
| GET | `/api/asta-desa/sebaran-peta` | Titik sebaran berkoordinat **rumah** — sumber peta penuh |
| GET | `/api/asta-desa/wilayah/kecamatan` | Daftar nama kecamatan (array string) — penyaring peta |
| GET | `/api/asta-desa/wilayah/desa?kecamatan=` | Daftar nama desa satu kecamatan (array string) |
| GET | `/api/asta-desa/wilayah/geojson?kecamatan=&desa=` | Geometri batas wilayah untuk disorot di peta |
| GET | `/api/asta-desa/cuaca?lat=&lon=` | Prakiraan BMKG pada satu koordinat |
| POST | `/api/asta-desa/segarkan` | Buang cache; dipakai tombol **Muat ulang** di halaman |

`/sebaran-peta` adalah satu-satunya endpoint di sini yang menyusuri **`/api/v1/sensuses`**
(jalur pengguna biasa, bukan grup `/admin`). Alasannya: resource admin tidak
pernah mengirim `rumah_lat`/`rumah_lon`, dan itulah koordinat yang digambar panel
super admin ASTA DESA. Barisnya jauh lebih berat di sana — jangan pakai jalur itu
untuk keperluan yang sudah cukup dilayani `/admin/sensuses`. Lihat
`requestPengguna` di service dan [`PETA_SEBARAN_ASTA_DESA.md`](PETA_SEBARAN_ASTA_DESA.md)
§3.1.

Empat endpoint wilayah & cuaca meneruskan endpoint **publik** ASTA DESA
(`/api/v1/public/...`), bukan grup `/admin` — lihat `ambilPublik` di service.
Tokennya sengaja tidak dikirim: endpoint wilayah di sana membaca pengguna lewat
guard `web` (session), bukan `sanctum`, sehingga token Bearer tidak berpengaruh —
dan tanpa pengguna terbaca, jawabannya justru mencakup seluruh kecamatan, yang
memang yang dibutuhkan DPMD. Rutenya tetap di balik JWT + peran internal DPMD
seperti rute lain; tidak ada alasan membuka pintu baru hanya karena di ujung sana
endpointnya publik.

Batas wilayah di-cache 24 jam (`adm_kecamatan`/`adm_desa` praktis tidak berubah),
cuaca 1 jam (sama dengan cache di sisi ASTA DESA). Koordinat cuaca dibulatkan ke
3 desimal sebelum diteruskan — tanpa itu tiap klik di peta menjadi kunci cache
baru yang tidak pernah terpakai ulang.

Tambahkan `?force=1` pada GET mana pun untuk melewati cache sekali jalan.

### Penanda kejujuran data

Tiga field muncul di beberapa respons dan **harus ditampilkan** bila bernilai
lebih dari nol:

- `sebagian` — penyusuran berhenti di `ASTADESA_MAX_ROWS` sebelum seluruh baris
  terbaca, jadi angkanya angka sebagian, bukan total resmi.
- `tanpa_koordinat` (pada `/sebaran`) — berapa baris yang tidak bisa dipetakan.
  Peta yang mewakili 40% data tetap tampak meyakinkan; tanpa angka ini, lubang di
  peta terbaca sebagai "tidak ada keluarga di sana" padahal artinya "koordinatnya
  belum diisi".
- `di_luar_wilayah` (pada `/sebaran`) — baris yang PUNYA koordinat tetapi
  koordinatnya jatuh di luar Kabupaten Bogor. Sengaja dipisah dari yang di atas:
  keduanya sama-sama absen dari peta, tetapi yang ini berarti "koordinatnya
  salah" — satu-satunya dari keduanya yang bisa dibetulkan dengan mendatangi
  barisnya di ASTA DESA.

---

## 4. Soal nama kolom

Tabel `sensuses` di ASTA DESA punya sekitar 100 kolom dan dokumen API-nya hanya
menyebut sebagian. Ketimbang mematok satu nama lalu pecah senyap begitu mereka
menamainya lain, setiap nilai dicari lewat **daftar kandidat nama** (fungsi
`pilih` di [`astadesa.controller.js`](../src/controllers/astadesa.controller.js)).

Kalau ada kolom baru yang relevan, **tambahkan** namanya ke daftar — jangan ganti
yang lama, supaya data versi lama tetap terbaca.

Tiga bentuk koordinat sudah ditangani dan diuji:

| Bentuk di sumber | Perlakuan |
| --- | --- |
| `latitude` / `longitude` biasa | dipakai apa adanya |
| lat & lng **tertukar** (lat berisi ≈106) | dibetulkan, bukan dibuang — kesalahan ini datang per-perangkat dan bisa berjumlah ratusan |
| satu string `"-6.55,106.72"` | dipecah |
| `0,0` | dibuang — satu titik 0,0 cukup membuat peta melompat ke Teluk Guinea dan seluruh sebaran Kabupaten Bogor mengerut jadi sebutir debu |
| koordinat sah tetapi **di luar Kabupaten Bogor** | tidak digambar di peta, tetapi TETAP dihitung di rekap dan tetap muncul di tabel; jumlahnya dilaporkan sebagai `di_luar_wilayah`. Data produksi memuat satu baris di Kec. Lindu, Desa Tomado (Sulawesi Tengah) — sisa uji coba, dan satu baris itu saja membentangkan bingkai peta dari Bogor sampai Sulawesi |

Kolom-kolom di `/sensuses/{id}` sendiri **tidak** disaring. Justru di sana ~100
kolom itu berguna, dan menyaringnya lewat daftar kandidat hanya akan membuang
kolom yang belum kita kenal. Panel detail di frontend merendernya dari kunci apa
pun yang datang. Yang diratakan hanya *amplop*-nya — lihat bagian berikut.

---

## 4b. Bentuk respons yang sudah diverifikasi ke produksi

Diperiksa langsung ke `astadesa.rmlabs.id` (September 2026), bukan dari dokumen
API. Kalau salah satu baris di bawah berubah, halamannya akan pecah senyap —
jadi periksa daftar ini lebih dulu saat ada angka yang tampak mustahil.

| Yang penting | Kenyataannya |
| --- | --- |
| Koordinat pada `/sensuses` | **BERSARANG**: `"lokasi": { "lat": "-6.40170353", "lon": "106.59887941" }` — bukan di tingkat atas, dan bujurnya bernama `lon` (bukan `longitude`/`lng`). Nilainya **string**. Mencarinya di tingkat atas membuat SELURUH baris terbaca tanpa koordinat dan peta tampil kosong tanpa satu pun galat |
| Kolom koordinat pada `/sensuses/{id}` | `lokasi_lat`/`lokasi_lon` dan `rumah_lat`/`rumah_lon` |
| `petugas` pada `/sensuses` | **objek** `{user_id, nama, nip, no_tlp, akun:{id,name,email}}`, bukan string. Tanpa penanganan, `String(objek)` membuat seluruh rekap petugas jadi satu baris "[object Object]" |
| `nama_petugas` | hanya ada pada **detail**, tidak pada baris daftar |
| Jumlah anggota per keluarga | `anggotas_count` |
| Hubungan keluarga | `hubungan_kk` (bukan `hubungan_keluarga`/`shdk`) |
| Usia anggota | **tidak ada kolom umur** — hanya `tanggal_lahir`, jadi usia dihitung di kode (backend untuk piramida, frontend untuk tabel anggota) |
| Pekerjaan anggota | **tidak ada** di `sensus_anggotas`. Pembacaannya tetap disiapkan; panelnya di frontend menyembunyikan diri selama kosong dan otomatis muncul bila mereka menambahkannya |
| Disabilitas | **ada**, dan berisi *jenis* (`"Tidak"`, `"Mental"`, …) — dihitung sebagai kategori, bukan sakelar ya/tidak |
| `roles` pada `/users` | **array** (`["surveyor"]`), dikelola Spatie; satu akun boleh berperan ganda |
| Status sensus | `pending_desa` dan `pending_kecamatan` — keduanya memuat kata "pending", jadi pencocokan tahap harus mendahulukan kata yang lebih spesifik (lihat `indeksStatus` di `warna.js`) |
| Bentuk `/sensuses/{id}` | amplop `{ sensus: {…104 kolom…}, anggotas: [...], petugas: {...} }` — **berbeda** dari baris `/sensuses` yang rata. Diratakan di `getSensusDetail` |
| Paginasi `/messages` | paginator **rata**: `current_page`/`last_page`/`total` di akar, **tanpa** `meta`. `/sensuses` dan `/users` memakai `meta` bersarang. Diseragamkan oleh `metaDari` |
| Isi `/messages` | hanya `sender_id`, `receiver_id`, `text` — tidak ada nama pengirim |
| `/admin/summary` | **membalas HTTP 500 di sisi mereka** per September 2026. Sebabnya sudah dilacak: `config/auth.php` di sana hanya mendefinisikan guard `web`, sedangkan guard `sanctum` didaftarkan Sanctum saat runtime dengan `provider => null`; middleware `auth:sanctum` menggeser `auth.defaults.guard`, lalu `Role::withCount('users')` memanggil `getModelForGuard('sanctum')` yang balas null. Perbaikannya ada di repo mereka, bukan di sini. `/ringkasan` sengaja menoleransinya (`summary: null`) dan tidak lagi bergantung padanya |
| Urutan `/admin/sensuses` | `orderByDesc('id')` dengan OFFSET. Saat pendataan berjalan, sisipan baris baru menggeser seluruh jendela: baris di perbatasan halaman terbaca dua kali, dan baris terbaru yang mendorongnya tidak terbaca sama sekali. Terukur ke produksi: 4.056 baris terkumpul, 4.055 id unik, 1 dobel, 1 hilang. Yang dobel dibuang `ambilSemua`; yang hilang tidak bisa ditambal dari sisi kita — karena itu angka pokok TIDAK boleh diambil dari panjang array |
| `meta.total` pada `/admin/sensuses` | `Sensus::count()` apa adanya, hidup, dan **sama persis dengan yang ditampilkan panel ASTA DESA**. Diverifikasi langsung: `meta.total` 4.143 = `DB::table('sensuses')->count()` 4.143, dalam 161 ms dengan `per_page=1`. Inilah sumber `total_sensus` sekarang |

Filter yang diteruskan ke sana **sudah diuji benar-benar diterapkan**:
`kecamatan`, `desa`, `status`, `user_id`, `dari`/`sampai`, `role`, dan `search`.
Catatan: `search` pada `/sensuses` mencocokkan identitas keluarga dan petugas —
bukan nama wilayah (`search=Cibinong` membalas 0 baris, sedangkan
`kecamatan=Cibinong` membalas isinya).

---

## 5. Cache

Dua lapis, keduanya di memori dan hilang saat proses di-restart:

| Lapis | Umur | Di mana |
| --- | --- | --- |
| Angka pokok (`/sensuses?per_page=1`, hanya `meta.total`) | 1 menit | `TTL_ANGKA_POKOK` di `src/controllers/astadesa.controller.js` |
| Respons per-endpoint di server | `ASTADESA_TTL_MS` (10 menit) | `src/services/astadesa.service.js` |
| Respons di browser | 10 menit | `frontend/src/pages/core-dashboard/asta-desa/useAstaDesa.js` |

Angka pokok sengaja dipisahkan dari sisanya. Saat pendataan ramai, laju masuknya
baris terukur ±3 per menit; dengan TTL sepuluh menit, "Keluarga Terdata" bisa
tertinggal ±30 baris di belakang panel ASTA DESA — dan selisih itulah yang
selama ini terbaca sebagai "datanya tidak sinkron". Menyegarkannya murah karena
yang diambil cuma satu angka dari satu baris; yang mahal adalah penyusuran 21
halaman, dan rincian di dalamnya (rekap kecamatan, tren harian, produktivitas
petugas) tidak berubah berarti dalam sepuluh menit.

Permintaan bersamaan digabung (inflight), sehingga lima pengunjung yang membuka
halaman pada detik yang sama tidak menjadi lima panggilan ke ASTA DESA.

Tombol **Muat ulang** membuang keduanya lalu menarik ulang dengan `force=1`.

---

## 6. Berkas

**Backend**

| Berkas | Isi |
| --- | --- |
| `src/services/astadesa.service.js` | Login, token, cache, penyusur seluruh halaman |
| `src/controllers/astadesa.controller.js` | Normalisasi kolom + agregasi |
| `src/routes/astadesa.routes.js` | Rute, di balik JWT + peran internal DPMD |
| `src/server.js` | Dipasang di `/api/asta-desa` |

**Frontend** — `src/pages/core-dashboard/asta-desa/`

| Berkas | Isi |
| --- | --- |
| `AstaDesaPage.jsx` | Kerangka halaman, lima tab + satu tautan keluar ke Peta Sebaran, penundaan pengambilan per tab |
| `RingkasanTab.jsx` | Kartu angka, laju pendataan, tahap verifikasi, peringkat kecamatan, petugas |
| `SensusTab.jsx` | Tabel sensus + panel detail satu keluarga |
| `DemografiTab.jsx` | Piramida usia, jenis kelamin, pendidikan, hubungan keluarga, disabilitas |
| `PenggunaTab.jsx` | Komposisi peran, produktivitas petugas, daftar akun |
| `LayerPesanTab.jsx` | Layer peta & riwayat pesan |
| `useAstaDesa.js` | Pengambil data + cache tingkat modul |
| `warna.js` | Palet data (sudah lolos uji keterbacaan buta warna) + pemformat angka |
| `ui.jsx` | Panel, kartu angka, daftar batang, keadaan memuat/kosong/galat |

**Frontend — Peta Sebaran penuh** — `src/pages/core-dashboard/asta-desa/peta/`

Halaman terpisah di `/core-dashboard/asta-desa/peta-sebaran`, replika panel
"Peta Sebaran" super admin ASTA DESA. Rinciannya di
[`PETA_SEBARAN_ASTA_DESA.md`](PETA_SEBARAN_ASTA_DESA.md).

| Berkas | Isi |
| --- | --- |
| `PetaSebaranPage.jsx` | Peta OpenLayers, cluster, identifikasi fitur, kontrol, cetak A3 |
| `PanelPeta.jsx` | Panel mengapung 384 px: tab Layer / Info / Filter + koordinat kursor |
| `konfigPeta.js` | Seluruh tetapan & gaya yang disalin persis dari panel asalnya |
| `usePetaSebaran.js` | Pengambil data peta (tiga tetap lewat `useAstaDesa`, empat sesuai-permintaan) |

---

## 7. Keputusan yang sengaja diambil

**Hanya ada satu peta sebaran, dan itu halaman penuh.** Sempat ada tab peta
ringkas berisi gelembung agregat per kecamatan/desa (`PetaTab.jsx`, Leaflet);
tab itu dihapus dan entrinya di deretan tab kini menautkan langsung ke
`/core-dashboard/asta-desa/peta-sebaran`. Dua peta untuk satu pertanyaan hanya
memaksa pembaca menebak mana yang berwenang — dan yang ringkas selalu kalah
begitu ada yang mengklik "buka peta penuh". Rekap per kecamatan tetap tersedia
sebagai angka di tab Ringkasan; **rincian per desa hilang bersama tab itu** dan
belum ada penggantinya dalam bentuk tabel.

Batas wilayah kini tersedia lewat `/wilayah/geojson`, yang meneruskan
`ST_AsGeoJSON` dari tabel `adm_kecamatan`/`adm_desa` ASTA DESA. Peta penuh
memakainya untuk menyorot wilayah terpilih dan menyaring titik secara spasial —
jadi catatan lama "proyek ini tidak punya berkas GeoJSON batas kecamatan" sudah
tidak berlaku.

**NIK dan nomor KK disamarkan di tabel** (`3271 •••• •••• 0001`), utuh hanya di
panel detail. Saat memindai daftar yang dibutuhkan cuma "apakah ini orang yang
saya cari", dan empat digit terakhir sudah menjawabnya — tanpa memampang nomor
lengkap di layar yang kebetulan sedang diproyeksikan.

**Warna data dihitung, bukan dipilih dengan mata.** Palet di `warna.js` sudah
diuji terhadap rentang kecerahan, ambang saturasi, keterpisahan bagi mata buta
warna (deutan/protan/tritan), keterpisahan bagi mata normal, dan kontras
terhadap latar. Merah bata brand DPMD sengaja tidak dipakai sebagai warna data:
di aplikasi ini merah adalah aksen identitas, dan begitu ia jadi salah satu
batang grafik, pembaca kehilangan cara membedakan "ini brand" dari "ini angka
yang buruk".

---

## 8. Memeriksa saat bermasalah

| Gejala | Artinya |
| --- | --- |
| Halaman memunculkan petunjuk pemasangan | `.env` belum diisi, atau backend belum di-restart |
| "Kredensial ASTA DESA ditolak" | `ASTADESA_IDENTITY`/`ASTADESA_PASSWORD` salah |
| "Akun yang dipakai bukan super_admin" | Akunnya benar, rolenya kurang — minta ASTA DESA menaikkannya |
| "Token tidak diterima (401)" | `ASTADESA_TOKEN` dicabut/kedaluwarsa; pakai identity+password agar bisa login ulang sendiri |
| "Server ASTA DESA tidak merespons dalam batas waktu" | Naikkan `ASTADESA_TIMEOUT_MS`, atau memang sisi sana sedang lambat |
| Banner "angka ini sebagian" | Naikkan `ASTADESA_MAX_ROWS` |
| Peta kosong padahal angka ada | Kolom koordinat di sumber tidak dikenali — tambahkan namanya ke `KUNCI_LAT`/`KUNCI_LNG` |
| Kartu ringkasan resmi ASTA DESA kosong | `/admin/summary` di sisi mereka sedang membalas 500 (lihat barisnya di tabel kejutan di atas untuk sebab persisnya) — halaman tetap jalan dengan hitungan sendiri; tidak ada yang perlu diperbaiki di sini |
| "Keluarga Terdata" beda dengan panel ASTA DESA | Selisih sampai ±30 baris itu normal selama kurang dari semenit: panel mereka menghitung ulang tiap kali dibuka, DPMD menyegarkan angkanya tiap 1 menit (`TTL_ANGKA_POKOK`) dan cache browser tiap 10 menit. Tombol **Muat ulang** melewati keduanya. Kalau selisihnya menetap jauh lebih besar dari itu, yang dicurigai `meta.total`-nya, bukan cache |
| `total_sensus` jauh lebih besar dari `total_terbaca` | Penyusuran berhenti di pagar `ASTADESA_MAX_ROWS`, atau banyak baris tergeser keluar paginasi. `sebagian: true` akan ikut menyala dan halaman memasang peringatannya sendiri |
| Kolom Peran di tabel pengguna kosong semua | Mereka mengganti bentuk `roles`; sesuaikan `daftarPeran` di `PenggunaTab.jsx` dan `namaRole` di controller |
| Panel detail keluarga serba "—" | Amplop `{sensus, anggotas, petugas}` berubah bentuk; sesuaikan `getSensusDetail` |

Uji cepat dari server:

```bash
curl -s -X POST https://astadesa.rmlabs.id/api/v1/login \
  -H 'Accept: application/json' \
  -d "identity=$ASTADESA_IDENTITY&password=$ASTADESA_PASSWORD"
```
