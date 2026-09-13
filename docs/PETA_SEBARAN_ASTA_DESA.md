# Peta Sebaran ASTA DESA — replika panel super admin

Halaman `/core-dashboard/asta-desa/peta-sebaran` meniru panel **Peta Sebaran**
milik super admin aplikasi ASTA DESA: desain yang sama, fungsi yang sama, dari
data yang sama lewat proxy `/api/asta-desa`.

Dokumen ini menjelaskan apa yang sudah sama, apa yang **belum** bisa sama dan
mengapa, serta angka-angka mana yang tidak boleh diubah sendiri.

Lihat juga: [`ASTA_DESA_INTEGRATION.md`](ASTA_DESA_INTEGRATION.md) untuk
kredensial, cache, dan daftar endpoint.

---

## 1. Satu peta, satu pintu

Halaman ini **satu-satunya** peta sebaran di aplikasi. Entri "Peta Sebaran" di
deretan tab halaman Asta Desa bukan tab, melainkan tautan langsung ke sini.

Sebelumnya ada tab peta ringkas (`PetaTab.jsx`, Leaflet) berisi gelembung agregat
per kecamatan/desa plus tabel peringkat. Tab itu **dihapus**: dua peta untuk satu
pertanyaan hanya memaksa pembaca menebak mana yang berwenang, dan yang ringkas
selalu kalah begitu ada yang membuka yang penuh.

Yang ikut hilang bersamanya, dan perlu diketahui:

- **Tabel rincian per desa** — belum ada penggantinya. Rekap per kecamatan masih
  tersedia sebagai angka di tab Ringkasan.
- **Dua spanduk kelengkapan data** (baris tanpa koordinat, baris di luar
  Kabupaten Bogor) — sudah dipindahkan ke kartu di sudut kiri bawah peta ini,
  ditambah satu baris baru soal titik yang memakai koordinat lokasi pendataan.

Leaflet tetap terpasang dan dipakai halaman lain (mis. `MapSection.jsx` di
landing page); yang dihapus hanya tab petanya.

**Mengapa OpenLayers padahal proyek ini sudah punya Leaflet.** Tugasnya bukan
"menggambar peta" melainkan "menggambar peta yang sama". Cluster beranimasi dan
pembukaan cluster berbentuk spiral datang dari ol-ext; legenda dan identifikasi
fitur datang dari WMS GeoServer lewat `getFeatureInfoUrl`; dan panel asalnya
memakai OpenLayers 8.2.0 — versi yang sama dipasang di sini. Menyusun ulang
semuanya di atas Leaflet berarti menebak-nebak sampai mirip, bukan memastikan
sama. Berkas OpenLayers dimuat malas lewat `lazy()` (±113 kB gzip, satu chunk
sendiri), jadi halaman Asta Desa biasa tidak membayarnya.

---

## 2. Fungsi yang sudah ada

| Fungsi | Catatan |
| --- | --- |
| Peta dasar + 4 basemap | OSM, Google Satellite, Google Hybrid, Esri World Imagery |
| Titik ter-cluster beranimasi | `AnimatedCluster`, jarak 40 px, durasi 700 ms |
| Klik cluster → mengembang spiral | `SelectCluster` ol-ext |
| Panel layer per grup | Tematik → Administrasi → Rencana → Foto Udara |
| Sakelar tampil/sembunyi per layer | |
| Slider transparansi per layer | 0–100%, langsung diterapkan |
| Legenda per layer | `GetLegendGraphic` untuk WMS, kotak contoh untuk vektor |
| Identifikasi fitur WMS | `GetFeatureInfo` paralel ke semua layer WMS yang tampil |
| Panel info atribut | 14 baris, urutan & penamaan sama dengan panel |
| Foto rumah | Dari media ASTA DESA |
| Kartu cuaca BMKG | Temperatur, kondisi, kelembaban, angin |
| Penyaring kecamatan / desa / enumerator | |
| Pencarian teks | Nama KK, NIK (tersamar), enumerator — debounce 500 ms |
| Sorot batas wilayah + filter spasial | Titik-dalam-polygon pada EPSG:3857 |
| Penanda klik menempel ke fitur | Pin merah |
| Tombol GPS "lokasi saya" | Titik biru berhalo, zoom 16 |
| Koordinat kursor | Format `lat, lon` 4 desimal |
| Cetak A3 landscape | Peta 73% kiri, keterangan 21% kanan, kop DPMD |
| Detail lengkap satu keluarga | Tombol **Detail Aset** membuka `PanelDetail` (104 kolom + anggota) |

Tab **Stats** di panel asalnya tombolnya dikomentari, jadi tidak tampil di sana —
dan tidak dibuat di sini. Kartu statistiknya sudah tersedia di tab Ringkasan.

---

## 3. Batas paritas — yang tidak bisa sama

### 3.1 Koordinat: sudah `rumah_*`, dengan satu cadangan

Panel super admin menggambar `rumah_lat`/`rumah_lon`. Halaman ini **juga**,
sehingga posisi titiknya sama — tetapi jalan menuju ke sana perlu dicatat karena
tidak lurus.

`GET /api/v1/admin/sensuses` (yang dipakai seluruh tab lain di halaman Asta Desa)
**tidak mengirim kolom itu sama sekali**: `AdminSensusResource` di sana hanya
menyertakan `lokasi: { lat, lon }`. Karena itu peta penuh memakai endpoint yang
lain, `GET /api/v1/sensuses` — jalur pengguna biasa, bukan grup admin — yang
membalas model Sensus apa adanya (`$guarded = ['id']`), lengkap dengan `rumah_*`
dan dengan NIK/no. KK yang sudah disamarkan oleh `maskPrivacy` di sana. Akun
super_admin tidak ber-role surveyor/verifikator, jadi penyaringan per peran di
endpoint itu tidak mengenainya: yang terbaca seluruh kabupaten, sama dengan yang
dilihat panel.

Lihat `requestPengguna` di service dan `getSebaranPeta` di controller. **Tidak ada
satu pun perubahan di sisi ASTA DESA yang dibutuhkan untuk ini.**

Harganya: baris dari endpoint itu jauh lebih berat (~104 kolom, plus anggota
keluarga dan URL media), jadi penyusuran pertamanya lebih lama daripada
`/sebaran`. Hasilnya di-cache seperti yang lain.

Endpoint `/sebaran` yang lama dibiarkan hidup meski tab yang memakainya sudah
dihapus: bentuknya ringan, sudah terdokumentasi, dan mencabut permukaan API lebih
berisiko daripada membiarkannya. Kini tidak ada pemakainya di frontend.

**Sisa selisih yang masih mungkin.** Baris yang `rumah_*`-nya kosong digambar
memakai `lokasi_*` sebagai cadangan, supaya tidak hilang diam-diam dari peta.
Titik seperti itu bisa berada di posisi yang sedikit berbeda dari panel — yang
memang tidak menggambarnya sama sekali. Jumlahnya dilaporkan sebagai
`pakai_koordinat_lokasi` dan ditampilkan di sudut kiri bawah peta, jadi
selisihnya bisa dijelaskan, bukan ditebak. Sebutkan juga `tanpa_koordinat` dan
`di_luar_wilayah` saat melaporkan — keduanya ikut membuat jumlah berbeda, dan
artinya tidak sama (lihat `ASTA_DESA_INTEGRATION.md`).

### 3.2 CQL_FILTER per peran tidak dipasang

Panel menempelkan `CQL_FILTER` ke layer WMS sesuai peran pembukanya
(`verifikator_kecamatan` → `kecamatan = '…'`, dan seterusnya). Halaman ini
bekerja dengan token **super_admin**, yang di panel pun tidak mendapat filter apa
pun — jadi tidak ada yang perlu ditiru. Bila suatu saat DPMD ingin membatasi
tampilan per kecamatan, filternya harus ditambahkan sendiri di `buatLayer`.

### 3.3 Atribut titik diambil saat diklik

Panel me-render seluruh atribut di server, sehingga semuanya langsung ada. Di
sini titik hanya membawa sembilan kolom ringkas; sisa atribut (alamat, kondisi
rumah, bantuan sosial, foto) datang dari `/asta-desa/sensus/:id` **saat titik
diklik**. Hasil akhirnya sama; yang berbeda, ada jeda singkat dan baris
"Mengambil atribut lengkap…" pada klik pertama sebuah titik. Memuat 104 kolom
untuk ribuan titik di depan akan terasa sebagai peta yang lama terbuka.

### 3.4 GetFeatureInfo bergantung pada CORS GeoServer

Identifikasi layer WMS memakai `fetch` ke URL GeoServer, lintas-origin. Bila
GeoServer tidak mengirim header CORS, permintaan itu gagal dan layer tersebut
**dilewati tanpa pesan galat** — atribut titik kuesioner tetap terbaca. Gejalanya:
mengklik di atas layer WMS tidak memunculkan atributnya padahal legendanya
tampil. Pemeriksaannya ada di tab Network peramban, bukan di kode ini.

### 3.5 Tanpa mode gelap

Panel asalnya punya mode gelap karena Filament punya sakelar temanya; Core
Dashboard DPMD seluruhnya terang, jadi varian `dark:` sengaja tidak disalin. Di
Tailwind v4 tanpa setelan `dark` berbasis kelas, `dark:` jatuh ke
`prefers-color-scheme` — menyalinnya apa adanya akan membuat panel ini menggelap
sendiri di laptop bertema gelap sementara sisa halaman tetap putih.

### 3.6 Pratinjau basemap memakai tile, bukan thumbnail

ASTA DESA punya `/assets/img/basemaps/*.png`; DPMD tidak. Pratinjau di pemilih
basemap digambar dari satu tile asli z=10 di atas Kabupaten Bogor — yang justru
membuatnya selalu cocok dengan basemap yang benar-benar tampil.

---

## 4. Angka yang tidak boleh diubah sendiri

Semuanya ada di `konfigPeta.js` dan disalin persis dari panel asalnya. Mengubah
salah satunya membuat kedua peta berhenti bisa disandingkan sebagai bukti bahwa
keduanya menampilkan hal yang sama — jadi perubahan di sini harus berpasangan
dengan perubahan di sana.

| Hal | Nilai |
| --- | --- |
| Pusat peta | `[106.8456, -6.5971]` (bujur, lintang) |
| Zoom awal / tombol home / fokus titik | 12 / **14** / 16 |
| Jarak cluster | 40 px |
| Durasi animasi cluster | 700 ms |
| Radius cluster | `12 + min(jumlah/10, 8)` px |
| Radius titik tunggal | 6 px; 8 px setelah cluster dibuka |
| Warna penanda data | `#64748b`, garis putih 2 px |
| Sorot wilayah | garis `rgba(217,119,6,0.8)`, isi `rgba(217,119,6,0.1)` |
| Penanda klik | `#ef4444`, anchor `[0.5, 1]` |
| Titik GPS | isi `#2563eb` r=7; halo `rgba(37,99,235,0.15)` r=24 |
| `view.fit` batas wilayah | padding `[50,50,50,50]`, durasi 1000 ms |
| Debounce pencarian & penyaring | 500 ms |
| Rumus skala cetak | `resolution × metersPerUnit × 39.37 × 90` |
| Cetak | A3 landscape; peta 73% kiri, keterangan 21% kanan, tepi hitam 2 px |

Rumus skala itu bukan rumus yang paling benar secara kartografi (39,37 = inci per
meter, 90 = dpi yang diasumsikan). Mencocokkannya justru intinya: cetakan dari
dua aplikasi harus menuliskan skala yang sama.

---

## 5. Privasi

NIK dan nomor KK **disamarkan dua kali**, dan keduanya disengaja:

1. Di backend, `/asta-desa/sebaran` mengirim `nik` yang sudah tersamar
   (`samarkanNomor`) — NIK utuh tidak pernah sampai ke browser untuk keperluan
   peta. Pencarian NIK di panel asalnya pun hanya pernah mengenai 6 digit pertama,
   karena di sana nilainya juga disamarkan sebelum dikirim ke tampilan.
2. Di frontend, `samarkan()` pada `konfigPeta.js` menyamarkan lagi nilai yang
   datang dari endpoint detail — yang memang mengirimkan seluruh kolom apa adanya.

Nomor utuh tetap bisa dilihat di panel detail tab Data Sensus, satu klik jauhnya,
bagi yang memang butuh. Yang membuka peta sebaran tidak pernah butuh NIK lengkap.

---

## 6. Uji terima

Buka `/admin/map` di ASTA DESA dengan akun super admin, sandingkan dengan
`/core-dashboard/asta-desa/peta-sebaran`:

**Data**
- [ ] Jumlah titik sama, kecuali sebanyak `pakai_koordinat_lokasi` +
      `di_luar_wilayah` — cocokkan dengan penjelasan
      [§3.1](#31-koordinat-sudah-rumah_-dengan-satu-cadangan).
- [ ] Posisi titik yang sama persis untuk baris yang `rumah_*`-nya terisi.
- [ ] Jumlah & urutan layer per grup sama (hanya `is_active`, urut `urutan`).
- [ ] Pilih satu kecamatan → sorot dan zoom mendarat di wilayah yang sama.
- [ ] Klik titik yang sama → 14 baris atribut identik, termasuk NIK tersamar.

**Tampilan**
- [ ] Warna cluster & titik `#64748b`, bukan hijau/biru.
- [ ] Panel selebar 384 px, berlatar-blur, sudut & bayangan sama.
- [ ] Label kecil kapital berspasi lebar.
- [ ] Di layar < 1024 px panel menyusut mengikuti lebar layar, peta tetap penuh.

**Fungsi**
- [ ] Pencarian ter-debounce dan mengenai nama KK / NIK / enumerator.
- [ ] Slider transparansi mengubah layer seketika, persentase ikut berubah.
- [ ] Legenda WMS muncul; layer dimatikan → "Aktifkan layer…".
- [ ] Kartu cuaca muncul dengan 4 metrik saat peta diklik.
- [ ] Pin merah menempel ke titik data, bukan ke posisi klik mentah.
- [ ] Tombol GPS memunculkan titik biru berhalo dan zoom ke 16.
- [ ] Cetak menghasilkan A3 landscape dengan kop DPMD, skala terisi, dan legenda
      memuat basemap + semua layer aktif.
- [ ] Sisa aplikasi (sidebar Core Dashboard) tidak ikut tercetak.
