# Prolap — Peta Output per Bidang

Dokumen kerja Sub Bagian Program & Pelaporan (Sekretariat). Isinya **daftar
output yang bisa dilaporkan dari tiap bidang**, beserta sumber datanya di
sistem dan apa yang masih kurang.

Output **dikamarkan per bidang pemiliknya**. Prolap hanya merekap; yang
menghasilkan output tetap bidang teknis. Katalog + pengelompokannya ada di satu
tempat: `dpmd-frontend/src/constants/prolapOutputs.js`, dipakai halaman
Sekretariat untuk menampilkan kartu per bidang.

| Bidang | Output | Halaman | Service |
|---|---|---|---|
| SPKED | Pembangunan Bankeu (jalan, TPT, jembatan) | `…/prolap/output-infrastruktur` | `outputInfrastruktur.service.js` |
| SPKED | BUMDes | `…/prolap/output-bumdes` | `outputBumdes.service.js` |
| KKD | Penyaluran Keuangan Desa (ADD, DD, BHPRD, Bankeu, BP) | `…/prolap/output-keuangan` | `outputKeuanganDesa.service.js` |
| PMD | Kelembagaan Desa + pengurus | `…/prolap/output-kelembagaan` | `outputKelembagaan.service.js` |
| Pemdes | Pemerintahan Desa (aparatur, produk hukum, profil) | `…/prolap/output-pemerintahan` | `outputPemerintahanDesa.service.js` |
| Sekretariat | Layanan internal | — | belum siap, lihat §7 |

Semua lewat `prolap.routes.js`, yang seluruh rutenya dibatasi
`checkRole('superadmin', 'sekretariat')` — bidang_id 2 lewat pseudo-role. Di sisi
frontend, rute `/sekretariat/prolap/*` dijaga `RoleProtectedRoute
allowedBidang={[2]}`.

---

## 1. Apa yang dihitung sebagai "output"

Bukan kegiatan, bukan anggaran, bukan jumlah dokumen yang di-upload. Output =
**hasil yang menempel di desa dan bisa dihitung**. Syaratnya empat:

| Syarat | Contoh pada Bankeu |
|---|---|
| Punya satuan yang jelas | meter / unit |
| Punya lokasi (minimal desa) | `desa_id` → nama desa & kecamatan |
| Punya tahun | `tahun_anggaran` |
| Punya penanda "sudah jadi" | `dpmd_status = approved` (disetujui) / ada LPJ approved (selesai) |

Penanda "sudah jadi" itu yang paling sering hilang di modul lain — lihat kolom
**Penanda selesai** pada tiap tabel di bawah.

Tingkat kesiapan yang dipakai di dokumen ini:

- **A** — data sudah ada dan bersih, tinggal dibuatkan endpoint + halaman.
- **B** — data ada tapi perlu pembersihan/penguraian (teks bebas, duplikat, tanpa tahun).
- **C** — belum ada penanda output-nya; butuh tambahan kolom/proses, keputusan bidang dulu.

Angka baris di bawah diambil dari dump `dpmd_20260707_060944.sql` (7 Juli 2026)
— indikatif, untuk menilai apakah suatu output layak ditampilkan, bukan angka
laporan.

---

## 2. Ringkasan satu halaman

| Bidang | Output utama | Satuan | Kesiapan |
|---|---|---|---|
| SPKED | Infrastruktur desa terbangun (Bankeu reguler + perubahan) | meter / unit | **A — SUDAH JADI** |
| SPKED | BUMDes berbadan hukum & aktif bertransaksi | unit BUMDes | **A — SUDAH JADI** |
| SPKED | Penyertaan modal & kontribusi PADes dari BUMDes | rupiah | **A — SUDAH JADI** |
| KKD | Desa cair per sumber dana & tahap, realisasi, kecepatan salur (SIPANDA) | desa + rupiah | **A — SUDAH JADI** |
| KKD | Rincian DD earmarked/non-earmarked & insentif | desa + rupiah | C — masih JSON |
| PMD | Kelembagaan desa terdata & aktif (Posyandu, LPM, KT, PKK, RT, RW, Satlinmas) | lembaga | **A — SUDAH JADI** |
| PMD | Pengurus lembaga terdata | orang | **A — SUDAH JADI** |
| PMD | Kelembagaan yang sudah ber-SK (produk hukum terlampir) | lembaga | **A — SUDAH JADI** |
| Pemdes | Aparatur desa aktif & lengkap dokumennya | orang | **A — SUDAH JADI** |
| Pemdes | Produk hukum desa ditetapkan (Perdes/Perkades) | dokumen | **A — SUDAH JADI** |
| Pemdes | Profil desa terisi lengkap (termasuk titik koordinat) | desa | **A — SUDAH JADI** |
| Sekretariat | Layanan internal: surat–disposisi tuntas, kegiatan terlaksana, kehadiran, realisasi anggaran | berkas/kegiatan/rupiah | B |

---

## 3. SPKED — Sarana Prasarana Kewilayahan dan Ekonomi Desa

### 3.1 Infrastruktur terbangun — **sudah jalan**

| | |
|---|---|
| Sumber | `bankeu_proposals` (3.820 baris) + `bankeu_perubahan_proposals` (3.487 baris) |
| Penanda selesai | `dpmd_status = 'approved'` → *disetujui*; ada `bankeu_lpj` / `bankeu_perubahan_lpj` status approved → *selesai* |
| Satuan | meter (jalan, TPT, drainase) / unit (jembatan, air bersih, sanitasi, bangunan) |
| Halaman | `/bidang/sekretariat/prolap/output-infrastruktur` |

Dua keterbatasan yang sudah dilaporkan apa adanya di layar dan **harus tetap
begitu** di output bidang lain:

1. `volume` teks bebas (`"470 M x 3 M x 0.15 M"`, `"1 PAKET"`) → panjang diurai
   heuristik, yang gagal dibaca dihitung terpisah sebagai `tidak_terbaca`, bukan nol.
2. `lokasi` teks bebas tanpa koordinat → titik peta memakai koordinat **desa**
   dari `profil_desas`, dan hanya sebagian desa yang mengisinya.

Catatan sumber: pada Bankeu reguler `kegiatan_id = 1` menggabungkan jalan DAN
jembatan dalam satu master, jadi keduanya tidak bisa dipisah dan seluruhnya
masuk kategori `jalan`.

### 3.2 BUMDes — **sudah jalan**

| Output | Satuan | Penanda selesai | Sumber |
|---|---|---|---|
| BUMDes berbadan hukum | unit | `badanhukum` terisi (+ `NIB`, `NPWP`, `LKPP` sebagai kelengkapan) | `bumdes` (187 baris) |
| BUMDes aktif | unit | `status = 'aktif'` | `bumdes` |
| Penyertaan modal desa | rupiah | `PenyertaanModal2019..2024` | `bumdes` |
| Kontribusi PADes | rupiah | `KontribusiTerhadapPADes2021..2024` | `bumdes` |
| Omset & laba | rupiah | `Omset2023/2024`, `Laba2023/2024` | `bumdes` |
| Tenaga kerja terserap | orang | `TotalTenagaKerja` | `bumdes` |
| Desa wisata | desa | `DesaWisata` | `bumdes` |

Halaman `…/prolap/output-bumdes` → `outputBumdes.service.js`. Empat hal yang
ditemukan saat membangunnya, dan sudah ditangani di service:

- Kolom keuangan **per tahun jadi nama kolom sendiri** (`Omset2023`, `Omset2024`,
  `PenyertaanModal2019`…). Sudah di-*unpivot* di `DERET`, jadi halaman tidak ikut
  berubah tiap ganti tahun — cukup tambah tahun di konstanta itu setelah kolomnya
  ada.
- **`bumdes.desa_id` KOSONG di seluruh 187 baris.** Penghubung yang benar adalah
  `kode_desa`, yang cocok 187/187 dengan `desas.kode`. Sebelum diperbaiki, seluruh
  sebaran per kecamatan jatuh ke "Tidak Diketahui".
- **Ada nilai salah ketik ekstrem**: penyertaan modal 2022 tercatat
  Rp 1.000.000.002.018 di BUMDes Mukti Jaya Ligarmukti, sementara nilai wajar
  tertinggi ±Rp 562 juta. Nilai >100× nilai tengah dikeluarkan dari penjumlahan
  **dan dilaporkan di layar** supaya bisa diperbaiki di sumbernya.
- 187 BUMDes di 187 desa dari 416. Sisanya disebut **"belum terdata"**, bukan
  "tidak punya BUMDes" — dua hal berbeda yang tidak bisa dipisahkan dari data ini.
- `LaporanKeuangan2024` terisi **0 dari 187**; `NilaiAset` hanya 73, tenaga kerja
  153. Tiap angka disertai jumlah pengisinya.

---

## 4. KKD — Kekayaan dan Keuangan Desa

Sumber utamanya **bukan lagi file JSON**, melainkan **API SIPANDA Kab. Bogor**
(live, sudah terpasang):

```
GET https://sipanda-bogorkab.smartvillage.info/{tahun}/index.php/api/DashboardController/dashboard
```

- Backend: `sipanda.service.js` → `fetchSipandaRows({ tahun })`, cache memori TTL
  5 menit per tahun, timeout 12 detik. Dipakai endpoint `/api/public/sipanda`.
- Frontend KKD: `hooks/useSipanda.js` — satu panggilan dibagi ke semua halaman
  penyaluran (ADD, DD Reguler, BHPRD, Bankeu Infras, BP), lalu tiap halaman
  memfilter `sumber_dana` di sisi klien.

Barisnya granular **per desa per tahap/bulan**, dan jauh lebih kaya dari JSON
lama. Field yang tersedia:

| Field | Kegunaan untuk output |
|---|---|
| `sumber_dana` | ADD / DD REGULER / BHPRD / BANKEU INFRAS DESA / BP |
| `kecamatan`, `desa`, `id_desa` | lokasi output |
| `anggaran` | nilai realisasi |
| `sudah_cair` (`'Y'`/`'N'`) | **penanda selesai yang sesungguhnya** |
| `tanggal_pencairan`, `sp2d` | tanggal & bukti cair |
| `nm_tahap`, `periode`, `id_periode` | tahap/bulan + urutan kronologis |
| `sts` | status pengajuan (mis. "Belum Mengajukan") |

### Output yang sudah dibuat

Halaman `…/prolap/output-keuangan` → `GET /api/prolap/output-keuangan?tahun=&sumber=&force=`
→ `outputKeuanganDesa.service.js`. Tiap sumber dana jadi satu kartu output
tersendiri, dan kartu yang dipilih membuka rincian tahap, tren bulanan, sebaran
kecamatan, posisi berkas yang belum cair, serta tabel per desa.


| Output | Satuan | Penanda selesai |
|---|---|---|
| Desa cair per sumber dana | desa | `sudah_cair = 'Y'` |
| Nilai realisasi per sumber dana | rupiah | jumlah `anggaran` baris cair |
| Tahap tuntas (semua desa cair) | tahap | agregasi per `nm_tahap` |
| Kecepatan salur / tren bulanan | hari, rupiah | `tanggal_pencairan` + `id_periode` |
| Kecamatan tertinggal | kecamatan | % desa cair terendah di tahap berjalan |

Karena ada `tanggal_pencairan` dan `id_periode`, **tren waktu dan kecepatan
salur mungkin dibuat** — ini yang tidak bisa dilakukan pada data JSON lama.

### Yang masih perlu diperhatikan

- **Ketergantungan pihak luar.** SIPANDA di luar kendali DPMD. Halaman prolap
  harus tetap tampil saat SIPANDA mati/lambat, dan **menyebutkan kapan data
  terakhir berhasil diambil** — jangan menampilkan angka basi seolah live.
- **Tahun ada di path URL**, dan `SIPANDA_TAHUN` default `'2026'` (env). Laporan
  lintas tahun berarti beberapa panggilan; ketersediaan tahun lama belum
  diverifikasi.
- **Jebakan format `anggaran`.** Nilainya berdesimal (`"220190608.00"`). Gunakan
  `toNumber`, **jangan** `toCurrencyNumber` yang membuang titik — nilainya jadi
  100× lipat. Sudah dicatat di `publicDashboard.controller.js`, jangan diulang.
- **`id_desa` itu milik SIPANDA**, bukan `desas.id` kita. Untuk menggabungkan
  dengan output bidang lain per desa, pencocokan tetap lewat nama
  kecamatan+desa — dan nama yang tidak cocok **wajib dilaporkan**, jangan
  didiamkan hilang.
- Untuk prolap, ambil lewat **backend** (`sipanda.service.js`), bukan meniru
  `useSipanda.js` yang memanggil SIPANDA langsung dari browser dengan tahun
  ter-hardcode.

### Sisa yang masih JSON

SIPANDA **tidak memecah** DD menjadi earmarked/non-earmarked maupun insentif.
Rincian itu masih memakai unggahan JSON lewat endpoint sendiri
(`/dd-earmarked-t1/data`, `/dd-earmarked-t2`, `/dd-nonearmarked-t1`,
`/dd-nonearmarked-t2`, `/insentif-dd`) yang dibaca halaman
`kkd/dd/DdEarmarkedT1..T2`, `DdNonEarmarkedT1..T2`, `InsentifDd`. Isinya tipis —
`sts`, `kecamatan`, `desa`, `Realisasi` — tanpa tanggal dan tanpa tahun (tahun
hanya di nama file). **Jangan** jadikan dasar output bertahun; kalau rincian
earmarked diperlukan sebagai output, tanyakan ke KKD apakah SIPANDA bisa
menyediakannya.

---

## 5. PMD — Pemberdayaan Masyarakat Desa

Bidang dengan data output paling rapi. Semua tabel kelembagaan punya pola kolom
yang **sama persis**: `desa_id`, `status_kelembagaan` (aktif/nonaktif),
`status_verifikasi` (unverified/verified), `produk_hukum_id`, `verified_at`,
`verifikator_nama`, `nonaktif_at`.

| Output | Satuan | Sumber (baris) |
|---|---|---|
| Posyandu aktif & terverifikasi | lembaga | `posyandus` (4.458) |
| RT aktif & terverifikasi | lembaga | `rts` (13.930) |
| RW aktif & terverifikasi | lembaga | `rws` (3.567) |
| LPM aktif & terverifikasi | lembaga | `lpms` (325) |
| PKK aktif & terverifikasi | lembaga | `pkks` (336) |
| Karang Taruna aktif & terverifikasi | lembaga | `karang_tarunas` (256) |
| Satlinmas aktif & terverifikasi | lembaga | `satlinmas` (359) |
| Lembaga lainnya | lembaga | `lembaga_lainnyas` (14) |
| Pengurus terdata & terverifikasi | orang | `pengurus` (51.098) |
| Kelembagaan ber-SK | lembaga | `produk_hukum_id IS NOT NULL` di tabel mana pun di atas |
| Cakupan jiwa/KK ter-RT | jiwa / KK | `rts.jumlah_jiwa`, `rts.jumlah_kk` |

Halaman `…/prolap/output-kelembagaan` → `outputKelembagaan.service.js`. Karena
polanya identik, kedelapan tabel diolah **satu query UNION** yang sudah
teragregasi di basis data — bukan delapan query terpisah.

**Koreksi penting terhadap rencana awal dokumen ini.** Rencana semula menyebut
output PMD adalah lembaga "aktif + terverifikasi". Itu keliru: pengecekan ke
basis data menunjukkan **tidak ada satu pun baris berstatus `verified`** di
kesembilan tabel (8 lembaga + pengurus) — 23.218 belum diperiksa, 27 ditolak,
0 terverifikasi. Verifikasi belum pernah dijalankan sama sekali. Kalau dipakai
sebagai ukuran, seluruh angka output PMD akan nol.

Yang dipakai sebagai output karena itu adalah **terdata & aktif**, dan keadaan
verifikasi ditampilkan terpisah dengan penjelasannya di layar.

Empat hal yang ikut dilaporkan apa adanya:

- **78,1% data (18.162 dari 23.245 lembaga) berasal dari impor massal**
  (`imported = 1`), bukan input desa. Dipisah hitungannya di setiap tingkat.
- `rts.jumlah_jiwa` / `jumlah_kk` hanya terisi di **124 dari 13.930 RT (0,9%)**,
  jadi **tidak dijadikan output** — hanya dilaporkan tingkat keterisiannya. Total
  jiwa dari data ini (39.397) jauh di bawah kenyataan.
- Kelembagaan ber-SK baru **4,3%** (999 dari 23.245).
- `pengurus` memakai relasi polimorfik (`pengurusable_type` + `pengurusable_id`).
  Perhatikan ketidakseragaman nilainya: lembaga lainnya memakai
  `'lembaga-lainnya'` (bertanda hubung), bukan nama tabel seperti jenis lain.

---

## 6. Pemdes — Pemerintahan Desa

| Output | Satuan | Penanda selesai | Sumber (baris) |
|---|---|---|---|
| Aparatur desa aktif | orang | `status = 'Aktif'`, `tanggal_pemberhentian IS NULL` | `aparatur_desa` (3.187) |
| Aparatur ber-SK pengangkatan | orang | `nomor_sk_pengangkatan` + `produk_hukum_id` | `aparatur_desa` |
| Cakupan jaminan sosial aparatur | orang / % | `bpjs_kesehatan_nomor`, `bpjs_ketenagakerjaan_nomor` terisi | `aparatur_desa` |
| Kelengkapan berkas aparatur | orang / % | 7 kolom `file_*` (pas foto, KTP, KK, akta, ijazah, 2 BPJS) | `aparatur_desa` |
| Produk hukum desa ditetapkan | dokumen | `tanggal_penetapan`, `status_peraturan = 'berlaku'`, per `tahun` & `jenis` | `produk_hukums` (1.003) |
| Profil desa terisi | desa | kelengkapan kolom wajib | `profil_desas` (405 dari 435 desa) |
| Desa berkoordinat | desa | `latitude`/`longitude` valid | `profil_desas` |

Halaman `…/prolap/output-pemerintahan` → `outputPemerintahanDesa.service.js`.

Angka sebenarnya saat dibangun (jauh berbeda dari dump Juli, karena penggabungan
arsip Dapur Desa sudah berjalan):

- Aparatur **7.312 tercatat, 7.280 aktif** — tapi hanya **43,5% diinput desa**;
  56,5% (4.129 orang) berasal dari arsip Dapur Desa.
- BPJS Kesehatan **7,6%**, Ketenagakerjaan **7%**, SK pengangkatan terlampir
  **0,9%**. Berkas: pas foto 85,9%, sisanya (KTP 11,2%, KK 10,3%, ijazah 9,7%,
  akta 6,6%) masih satu digit sampai belasan persen.
- Produk hukum 1.003 dokumen (993 berlaku) tapi baru tersebar di **65 desa
  (15,6%)**. Deret tahunannya rapi: 2019 (13) sampai 2026 (139).
- Profil desa: 405 desa punya baris, tapi rata-rata kelengkapannya hanya **30%**.
  **81 desa lengkap penuh, 249 desa kosong sama sekali.** Karena itu yang dihitung
  adalah kelengkapan per kolom terhadap SELURUH 416 desa — punya baris tidak sama
  dengan terisi.

Catatan:

- `produk_hukums` punya `tahun` dan `jenis` — ini satu-satunya output Pemdes yang
  langsung bisa dibuat **runtut per tahun** tanpa penataan apa pun.
- Titik koordinat di `profil_desas` **kotor**: ada `lat = lng` (salah tempel),
  tanda minus hilang, dan nilai nol. `outputInfrastruktur.service.js` sudah punya
  `cleanKoordinat()` + `BOGOR_BOUNDS` untuk ini — pakai ulang fungsi itu, jangan
  tulis pembersih kedua yang aturannya beda.
- `sumber_data` pada `aparatur_desa` membedakan input desa vs suntikan arsip
  Dapur Desa. Sama seperti `imported` di PMD: pisahkan hitungannya.

---

## 7. Sekretariat — output layanan internal

Berbeda sifat dari empat bidang teknis: outputnya bukan yang terbangun di desa,
melainkan **layanan yang tuntas**. Tetap layak masuk prolap sebagai kinerja
internal, tapi jangan dicampur dalam satu angka dengan output pembangunan.

| Output | Satuan | Sumber (baris) | Catatan |
|---|---|---|---|
| Surat masuk terdisposisi & tuntas | berkas | `surat_masuk` (399), `disposisi` (1.104) | perlu dipastikan ada status "selesai ditindaklanjuti" |
| Kegiatan terlaksana | kegiatan | `jadwal_kegiatan` (339) | butuh penanda terlaksana vs batal |
| Kehadiran pegawai | hari-orang / % | `absensi_pegawai` (1.892) | hari libur ikut `hari_libur` via `holidayCache.service` |
| Realisasi anggaran & pencairan | rupiah | `anggaran_rka_items` (153), `pencairan` (0) | pencairan & arsip barang masih kosong di dump — fitur baru, tunggu terisi |
| Perjalanan dinas | orang-hari | `perjadin_pegawai` (0) | idem |
| Rapat daring terselenggara | rapat | `video_meetings` (32) | |

Tabel bernilai 0 di dump 7 Juli 2026 (`pencairan`, `arsip_barang`,
`perjadin_pegawai`, `nomor_surat_requests`, `musdesus`) — modul relatif baru.
Jangan dijadikan output dulu sampai datanya terisi; grafik kosong lebih merusak
kepercayaan daripada tidak ada grafik.

---

## 8. Urutan pengerjaan yang disarankan

1. ~~**PMD — kelembagaan & pengurus.**~~ **Selesai** — lihat §5.
2. ~~**Pemdes — aparatur + produk hukum.**~~ **Selesai** — lihat §6.
3. ~~**KKD — posisi & kecepatan salur dari SIPANDA.**~~ **Selesai** — lihat §4.
4. ~~**SPKED — BUMDes.**~~ **Selesai** — lihat §3.2.
5. **Sekretariat — layanan internal.** Satu-satunya yang belum; menunggu modul
   pencairan/perjadin/arsip barang terisi data. Kartunya sudah ada di halaman
   Sekretariat dalam keadaan mati beserta alasannya.

## 9. Yang perlu diputuskan bidang (bukan keputusan teknis)

- **KKD:** rincian DD earmarked/non-earmarked & insentif masih JSON unggahan dan
  tak punya tanggal/tahun. Perlu jadi output juga, atau cukup lima sumber dana
  yang sudah ada di SIPANDA? Kalau perlu — bisakah SIPANDA menyediakan
  pecahannya?
- **KKD:** laporan lintas tahun perlu tarik SIPANDA per tahun; tahun berapa saja
  yang datanya masih tersedia di sana?
- **SPKED:** desa tanpa baris BUMDes itu "tidak punya BUMDes" atau "belum
  didata"? Menentukan penyebutnya.
- **PMD:** verifikasi kelembagaan **belum pernah dijalankan sama sekali** (0 dari
  23.245 lembaga dan 51.098 pengurus berstatus `verified`). Mau mulai dijalankan,
  atau kolom verifikasi dianggap tidak dipakai? Selama belum, output PMD memakai
  "terdata & aktif".
- **PMD:** 78% data lembaga berasal dari impor massal. Apakah itu boleh dihitung
  sebagai capaian, atau hanya yang diinput desa sendiri?
- **SPKED:** nilai penyertaan modal Rp 1.000.000.002.018 di BUMDes Mukti Jaya
  Ligarmukti perlu diperbaiki di sumbernya; sekarang dikecualikan otomatis.
- **Pemdes:** kelengkapan berkas & BPJS aparatur masih satu digit persen. Perlu
  jadi target kerja, atau memang tidak diunggah ke sistem?
- **Sekretariat:** `jadwal_kegiatan` perlu penanda "terlaksana" — sekarang belum
  ada, jadi kegiatan batal tetap terhitung.
