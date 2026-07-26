# Generator Data Status BPJS (Aktif / Non-Aktif / Baru)

Dokumentasi untuk skrip [`scripts/generate-bpjs-status-cache.js`](../scripts/generate-bpjs-status-cache.js) — pembangun **overlay status kepesertaan BPJS** yang dipakai halaman **Persandingan RT/RW** (`RtrwComparisonPage`).

> Berbeda dengan **data BPJS master** (`data/rtrwbpjs.json`, ~21rb peserta, lihat [UPDATE_BPJS_DATA.md](./UPDATE_BPJS_DATA.md)). Dokumen ini soal **data _status_ BPJS** — penanda manual per-desa: siapa yang **Aktif**, **Non-Aktif**, dan pengurus **Baru** (belum terdaftar BPJS).

---

## 1. Ringkasan

- **Input:** folder `DESK BPJS JULI 2026` (di root DPMD, di luar repo) — 1 file `.xlsx` per desa, dikelompokkan per subfolder kecamatan.
- **Output 1:** `data/rtrwbpjsstatus.json` — cache overlay yang dibaca controller (JSON sementara, **bukan** ke database).
- **Output 2:** `RTRW_BPJS_Status_Report_<tgl>.xlsx` (di root DPMD) — laporan verifikasi.
- **Sifat:** JSON di-**timpa penuh** tiap run (bukan append). Selalu dibangun ulang dari seluruh folder, jadi hasilnya = kondisi folder saat itu.

Tiap file Excel punya sheet:

| Sheet | Isi | Kunci yang tersedia |
|---|---|---|
| `AKTIF` | Peserta BPJS TK yang ditandai **masih aktif** | NIK + KPJ |
| `NON AKTIF` | Peserta yang ditandai **tidak aktif** (berakhir masa bakti / mengundurkan diri / meninggal / pindah) | **hanya KPJ** (tanpa NIK) |
| `BARU` | Pengurus RT/RW **baru**, belum terdaftar BPJS | NIK + RT/RW |
| `DATABASE` | Master mentah 21rb baris | **diabaikan** (redundan dgn `rtrwbpjs.json`) |

---

## 2. Cara menjalankan

```bash
cd dpmd-fahri-express
node scripts/generate-bpjs-status-cache.js
```

- Durasi ~2–4 menit (parsing 250+ file Excel).
- **Butuh database MySQL hidup** (Laragon start) — dipakai untuk nama desa/kecamatan + enrichment RT/RW.
- Override lokasi folder sumber: `set BPJS_DESK_DIR="path/ke/folder"` (default: `data/desk-bpjs-juli-2026/`, fallback `c:/laragon/www/dpmd/DESK BPJS JULI 2026`).

Di akhir muncul ringkasan JSON (jumlah file, aktif/non-aktif/baru, desa kosong, warning, path output).

### Menambah file baru
Cukup taruh file `.xlsx` baru di subfolder kecamatannya lalu **jalankan ulang** — file dipindai otomatis (rekursif), tak perlu didaftarkan. Tidak ada mode inkremental; selalu regenerate penuh.

---

## 3. Output JSON: `data/rtrwbpjsstatus.json`

```jsonc
{
  "version": 1,
  "generatedAt": "2026-07-15T...",
  "meta": { "filesProcessed": 265, "totalAktif": 9189, "totalNonAktif": 1749, "totalBaru": 2753, "desaWithData": 244 },

  // AKTIF -> dijoin ke item persandingan lewat NIK
  "membershipByNik": { "<nik>": { "status": "aktif", "desaKode", "kpj", "kodeTk", "upah", "tglLahir", "sourceFile" } },

  // NON-AKTIF (dan AKTIF) -> dijoin lewat KPJ. Non-aktif menang saat KPJ bentrok.
  "membershipByKpj": { "<kpj>": { "status": "non_aktif", "desaKode", "sebab", "tglTidakAktif", "tglLahir", "sourceFile" } },

  // Fallback NON-AKTIF via nama+desa (dipakai saat NIK & KPJ gagal, mis. KPJ master kosong)
  "membershipByNameDesa": { "<NAMA_NORMALIZED>|<desaKode>": { "status": "non_aktif", "desaKode", "sebab", "tglLahir", "sourceFile" } },

  // Pengurus BARU (di luar BPJS)
  "baru": [ { "desaKode", "nik", "normalized", "nama", "jenis", "rwNomor", "rtNomor", "jabatan", "tglLahir", "alamat", "pendidikan", "sourceFile" } ]
}
```

---

## 4. Bagaimana controller memakainya (overlay)

Di [`rtrwComparison.controller.js`](../src/controllers/kelembagaan/rtrwComparison.controller.js), `resolveMembership()` menandai tiap item persandingan yang ada di BPJS:

1. **AKTIF** → cocokkan detail BPJS lewat **NIK** (`membershipByNik`).
2. **NON-AKTIF** → cocokkan lewat **KPJ** (`membershipByKpj`) — karena sheet NON AKTIF tak punya NIK.
3. **Fallback** → jika NIK & KPJ gagal, cocokkan lewat **nama + kode desa** (`membershipByNameDesa`), **diverifikasi tanggal lahir** (ditolak bila dua sisi ada tapi beda).

Hasil per item: `bpjsMembership` = `aktif` | `non_aktif` | `mixed` | `unmarked` | `null`.

> **Kenapa fallback perlu:** ±10% peserta di master BPJS punya **KPJ kosong**. Non-aktif hanya bisa dijoin via KPJ, jadi tanpa fallback banyak yang jatuh ke "Belum ditandai" walau di desk statusnya non-aktif (kasus **OBAY SOBARI**). Fallback nama+desa memulihkan kasus-kasus ini.

Sinkronisasi cache: tanda tangan (mtime+size) `rtrwbpjsstatus.json` masuk `getSourceCacheKey()`, jadi regen JSON **otomatis** dipakai controller **tanpa restart** server.

Pengurus **BARU** dipakai untuk tab "Data Baru" (dicocokkan ke Database via NIK/nama untuk penyandingan).

---

## 5. Output laporan Excel

`RTRW_BPJS_Status_Report_<tgl>.xlsx`, sheet:

| Sheet | Isi |
|---|---|
| **Ringkasan** | Total file, desa punya data vs kosong, total aktif/non-aktif/baru, warning |
| **Jumlah per Desa** | Per desa: aktif / non-aktif / baru / total, ada file? |
| **Daftar Aktif** | List semua peserta AKTIF + **JENIS/RW/RT dari database** (match via NIK; kolom `ADA DI DB`) |
| **Daftar Non-Aktif** | List semua peserta NON-AKTIF + sebab (tanpa RT/RW karena tak ada NIK) |
| **Desa Kosong** | Desa di DB yang belum ada data |
| **Kode Tak Dikenal** | Kode desa dari file yang tak ada di database |
| **Warnings** | NIK duplikat, baru tanpa NIK, non-aktif tanpa KPJ, dll |

---

## 6. Detail teknis penting

- **Deteksi kolom berbasis ISI**, bukan nama header. Banyak file kolomnya bergeser (header ada "NO" tapi data tak mengisinya → NIK jatuh di kolom "NO"). Parser mengenali NIK (16 digit), kode desa (`32.01.xx.xxxx`), KPJ (9–12 digit), nama (alfabet), tanggal — jadi tahan geseran kolom.
- **Penjaga tgl lahir** (1900–2015): buang nilai bocor dari kolom BLTH (2025/2026) atau typo (`0069`, `1864`).
- **Enrichment RT/RW** (sheet Daftar Aktif): NIK AKTIF dicocokkan ke `prisma.pengurus` (+ `rts`/`rws`) untuk ambil JENIS/RW/RT/JABATAN. ~80% aktif dapat match.
- **Urutan tulis:** JSON ditulis **sebelum** Excel. Kalau file Excel sedang dibuka (`EBUSY`), JSON tetap tersimpan; laporan dilewati dengan peringatan (tidak menggagalkan seluruh run).

---

## 7. Troubleshooting

| Gejala | Penyebab & solusi |
|---|---|
| `Can't reach database server at localhost:3306` | MySQL mati → **Start Laragon**, jalankan ulang. |
| `EBUSY ... RTRW_BPJS_Status_Report_...xlsx` | File laporan sedang dibuka di Excel → **tutup**, jalankan ulang. JSON sudah aman tersimpan. |
| Data suatu file tak muncul | Cek sheet **Kode Tak Dikenal** & **Warnings** — kode desa file mungkin tak dikenal DB, atau kode tak bisa ditentukan (AKTIF & BARU kosong). |
| Orang non-aktif tetap "Belum ditandai" di app | KPJ-nya kosong/beda di master **dan** namanya beda ejaan (fallback exact-match gagal), **atau** memang sudah tak ada di master BPJS (tak ada baris untuk ditandai). |

---

## 8. Alur update ke produksi

1. Update file di folder DESK BPJS → `node scripts/generate-bpjs-status-cache.js`.
2. Commit **`data/rtrwbpjsstatus.json`** (file laporan Excel di root TIDAK di-commit).
3. Push ke `main` → webhook auto-deploy menyalin JSON ke server; controller memakainya otomatis (cache via mtime).

> Kalau logika overlay ikut berubah, commit juga `rtrwComparison.controller.js` **bersama** JSON-nya — tanpa JSON baru, map fallback kosong dan perubahan tak berefek.
