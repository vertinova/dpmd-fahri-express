# Core Dashboard API (Eksternal)

Dokumen integrasi untuk mitra/rekan yang mengonsumsi data agregat DPMD Kabupaten Bogor.

- **Versi payload:** `2.0`
- **Base URL produksi:** `https://dpmd.bogorkab.go.id`
- **Endpoint:** `GET /api/public/core-dashboard` (alias: `GET /api/public/dashboard`)
- **Auth:** API key (header)
- **Format:** JSON, realtime (tanpa cache di sisi server)

> Catatan v2.1: payload diringkas menjadi **3 modul inti** saja
> (BUMDes, Aparatur Desa gabungan, Bankeu **Perubahan**).
> Modul lama (wilayah, profil desa, produk hukum, kelembagaan, keuangan desa/
> bankeu reguler) **sudah tidak lagi dikembalikan** — data penyaluran dana desa
> pindah ke endpoint terpisah `GET /api/public/sipanda`.

---

## 1. Autentikasi

Sertakan API key pada **salah satu** header berikut:

| Header | Contoh |
|---|---|
| `x-api-key` | `x-api-key: YOUR_API_KEY` |
| `x-core-dashboard-key` | `x-core-dashboard-key: YOUR_API_KEY` |
| `Authorization` (Bearer) | `Authorization: Bearer YOUR_API_KEY` |

API key diberikan terpisah oleh tim DPMD. **Jangan** menaruh key di kode frontend
publik — panggil endpoint ini hanya dari backend/server mitra.

### Respons error auth

| Kondisi | HTTP | Body |
|---|---|---|
| API key salah / tidak dikirim | `401` | `{ "success": false, "message": "API key tidak valid" }` |
| API key belum dikonfigurasi di server | `503` | `{ "success": false, "message": "Core Dashboard API belum dikonfigurasi" }` |
| Error tak terduga | `500` | `{ "success": false, "message": "...", "error": "..." }` |

---

## 2. Mode pengambilan data

| Mode | Query | Isi |
|---|---|---|
| **Full Detail** (default) | _(tanpa query)_ | Semua angka rekap **+ `records` detail** per modul. Lebih berat. |
| **Preview / Ringkasan** | `?view=preview` | Hanya angka rekap; semua `records` kosong. Cepat & ringan. |

Alias query preview yang juga diterima: `?view=summary`, `?detail=preview`, `?mode=preview`.

Selalu cek `data.meta.mode` (`"full"` / `"preview"`) untuk memastikan apa yang diterima.

---

## 3. Contoh request

```bash
# Full detail
curl -H "x-api-key: YOUR_API_KEY" \
  https://dpmd.bogorkab.go.id/api/public/core-dashboard \
  -o core-dashboard.json

# Preview (ringkasan saja, cepat)
curl -H "x-api-key: YOUR_API_KEY" \
  "https://dpmd.bogorkab.go.id/api/public/core-dashboard?view=preview"
```

```javascript
const res = await fetch(
  "https://dpmd.bogorkab.go.id/api/public/core-dashboard",
  { headers: { "x-api-key": process.env.DPMD_API_KEY, Accept: "application/json" } }
);
const { data } = await res.json();

console.log(data.meta.mode);                          // "full"
console.log(data.summary.total_bumdes);
console.log(data.modules.bankeu_perubahan.records.length);
```

> Jika dibuka langsung dari browser (tanpa API key, `Accept: text/html`),
> endpoint menampilkan halaman HTML interaktif untuk uji coba & panduan singkat.

---

## 4. Struktur respons

```jsonc
{
  "success": true,
  "message": "Data Core Dashboard publik berhasil diambil",
  "data": {
    "meta":    { "...": "metadata" },
    "endpoints": { "...": "info endpoint" },
    "summary": { "...": "4 angka rekap" },
    "dashboard": { "cards": [], "modules": [] },  // siap render UI
    "modules": { "...": "4 modul + records" },
    "sources": { "...": "status sumber data" }
  }
}
```

### 4.1 `data.meta`

```json
{
  "generated_at": "2026-06-30T04:00:00.000Z",
  "timezone": "Asia/Jakarta",
  "version": "2.0",
  "access": "protected_api_key",
  "auth_required": true,
  "realtime": true,
  "cache": "no-store",
  "mode": "full",
  "detail_records": true
}
```

### 4.2 `data.summary` — 3 angka inti

| Field | Tipe | Keterangan |
|---|---|---|
| `total_bumdes` | number | Jumlah BUMDes |
| `total_aparatur` | number | **Gabungan** aparatur lokal (aktif) + external (dapur desa) |
| `total_aparatur_lokal` | number | Rincian: aparatur aktif dari DB lokal |
| `total_aparatur_external` | number | Rincian: kepala desa + perangkat + BPD (dapur desa) |
| `total_bankeu_perubahan_proposal` | number | Jumlah proposal Bankeu **Perubahan** yang **sudah masuk DPMD** (`submitted_to_dpmd = true`), semua tahun |
| `total_bankeu_perubahan_anggaran` | number | Total nominal anggaran usulan (Rupiah) dari proposal yang sudah masuk DPMD (scope sama dgn count) |

> `total_aparatur` = `total_aparatur_lokal` + `total_aparatur_external` (penjumlahan langsung).

---

## 5. Modul (`data.modules`)

### 5.1 `bumdes`

Rekap + `records` per BUMDes.

```jsonc
{
  "total": 416,
  "aktif": 300,
  "tidak_aktif": 116,
  "total_aset": 0,
  "total_omzet_2024": 0,
  "total_laba_2024": 0,
  "total_tenaga_kerja": 0,
  "by_status": [ { "key": "aktif", "label": "Aktif", "total": 300 } ],
  "by_kecamatan": [ { "key": "...", "label": "...", "total": 0 } ],
  "records": [
    {
      "id": 1,
      "kecamatan": "...", "desa": "...", "nama_bumdesa": "...",
      "status": "aktif", "nib": null, "npwp": null, "badan_hukum": null,
      "pengurus": { "direktur": { "nama": "...", "hp": "..." }, "...": {} },
      "keuangan": { "omset_2024": 0, "laba_2024": 0, "nilai_aset": 0, "...": 0 },
      "files": { "perdes": { "url": "...", "download_url": "..." }, "...": {} }
    }
  ]
}
```

### 5.2 `aparatur_desa`

Total gabungan + breakdown external (kades/perangkat/BPD) + `records` lokal.

```jsonc
{
  "source": "gabungan_lokal_external",
  "external_available": true,
  "total_gabungan": 9500,
  "local_total_aktif": 500,
  "external_total": 9000,
  "kepala_desa":    { "total": 0, "gender": [], "pendidikan": [], "usia": [] },
  "perangkat_desa": { "total": 0, "gender": [], "pendidikan": [], "usia": [] },
  "bpd":            { "total": 0, "gender": [], "pendidikan": [], "usia": [] },
  "total": 500,            // jumlah records lokal
  "aktif": 500,
  "by_jabatan": [], "by_pendidikan": [], "by_gender": [], "by_status": [],
  "records": [
    {
      "id": 1, "kecamatan": {}, "nama_desa": "...",
      "nama_lengkap": "...", "jabatan": "...", "nipd": null, "niap": null,
      "jenis_kelamin": "...", "pendidikan_terakhir": "...", "status": "Aktif",
      "files": { "pas_foto": {}, "ktp": {}, "ijazah_terakhir": {}, "...": {} }
    }
  ]
}
```

> `kepala_desa/perangkat_desa/bpd` adalah agregat (chart gender/pendidikan/usia)
> dari sumber external. `records` adalah data per-orang dari DB lokal.
> Bila sumber external sedang tidak tersedia, `external_available=false` dan
> `source="local_database"` (endpoint tetap `200`).

### 5.3 `bankeu_perubahan`

Proposal Bankeu **Perubahan** yang **sudah masuk DPMD** — disamakan dengan statistik
halaman verifikasi DPMD/SPKED: `submitted_to_dpmd = true` **atau** pernah dikirim ke
DPMD (`submitted_to_dpmd_at`) **atau** pernah diverifikasi DPMD (`dpmd_verified_at`).
Termasuk yang dikembalikan DPMD (revision/rejected). Proposal yang masih draft / di
desa / di kecamatan **tidak** dihitung. `scope: "masuk_dpmd"` menegaskan hal ini.

```jsonc
{
  "scope": "masuk_dpmd",
  "total_proposal": 0,
  "approved_by_dpmd": 0,
  "total_anggaran_usulan": 0,
  "by_status": [], "by_dpmd_status": [],
  "by_jenis_kegiatan": [], "by_tahun_anggaran": [], "by_kecamatan": [],
  "records": [
    {
      "id": "1", "kecamatan": {}, "nama_desa": "...",
      "tahun_anggaran": 2026,
      "jenis_kegiatan": "wajib | pilihan_infrastruktur | pilihan_non_infrastruktur",
      "judul_proposal": "...", "kegiatan_nama": "...", "nama_kegiatan_spesifik": "...",
      "volume": "...", "lokasi": "...", "anggaran_usulan": 0,
      "status": "...", "kecamatan_status": "...", "dpmd_status": "...",
      "submitted_to_dpmd": true,
      "kegiatan": [ { "id": 1, "kategori": "...", "nama_kegiatan": "..." } ],
      "files": { "proposal": {}, "surat_pengantar": {}, "surat_permohonan": {}, "berita_acara": {} }
    }
  ]
}
```

> Mencakup **semua tahun anggaran** — gunakan `by_tahun_anggaran` atau filter
> field `record.tahun_anggaran` di sisi mitra bila hanya butuh satu tahun.

> **Catatan:** modul keuangan desa (ADD/DD/BHPRD/Bankeu reguler) **TIDAK** ada di
> core-dashboard. Seluruh data penyaluran dana desa dipindahkan ke endpoint terpisah
> **`GET /api/public/sipanda`** (lihat §8).

---

## 6. Referensi file

Setiap field file/foto/PDF dikembalikan sebagai objek terstruktur:

```json
{
  "path": "uploads/bumdes_laporan_keuangan/xxx.pdf",
  "filename": "xxx.pdf",
  "url": "https://dpmd.bogorkab.go.id/uploads/bumdes_laporan_keuangan/xxx.pdf",
  "download_url": "https://dpmd.bogorkab.go.id/uploads/bumdes_laporan_keuangan/xxx.pdf"
}
```

Bila tidak ada file, nilainya `null`.

---

## 7. Catatan integrasi

- **Default = Full Detail** dan berat (ribuan records, tanpa cache). Untuk angka
  ringkas/polling sering, pakai `?view=preview`. Ambil full hanya saat sinkronisasi.
- Endpoint **realtime** (`Cache-Control: no-store`); mitra disarankan menyimpan
  cache sendiri sesuai kebutuhan.
- **Perjalanan dinas tidak** termasuk dalam payload ini.
- `data.dashboard.cards` & `data.dashboard.modules` adalah bentuk siap-render
  (label + data_path), opsional untuk dipakai.

---

## 8. Endpoint terpisah: SIPANDA (penyaluran dana desa)

`GET /api/public/sipanda` — **endpoint berbeda** dari core-dashboard, tapi **auth-nya sama** (header `x-api-key` / `Authorization: Bearer` dgn `CORE_DASHBOARD_API_KEY`).

Berisi realisasi penyaluran dana desa **live dari SIPANDA** tahun berjalan, dipecah per `sumber_dana`: `add`, `dd_reguler`, `bhprd`, `bankeu_infras_desa`, `bp`. Setiap sumber punya total, rekap **per kecamatan** (`by_kecamatan`), dan (mode full) `records[]` per desa. Pakai `?view=preview` untuk tanpa `records`.

> Catatan: `bankeu_infras_desa` & `bp` bisa `Rp 0` bila belum ada pencairan di SIPANDA untuk tahun berjalan. Bila SIPANDA tidak dapat dijangkau, endpoint membalas `502` (tidak ada fallback statis — ini memang endpoint live SIPANDA).

```jsonc
{
  "success": true,
  "data": {
    "meta": { "source": "sipanda", "mode": "full", "...": "..." },
    "tahun": 2026,
    "total_realisasi": 913524546142,
    "sumber_dana": {
      "add": {
        "label": "Alokasi Dana Desa (ADD)",
        "sumber_dana": "ADD",
        "total_realisasi": 406865146624,
        "total_desa": 416,
        "by_kecamatan": [ { "kecamatan": "GUNUNG PUTRI", "total_realisasi": 0, "total_desa": 0 } ],
        "records": [ { "nomor": 1, "kecamatan": "JASINGA", "desa": "CURUG", "realisasi": 0, "realisasi_label": "Rp 0" } ]
      },
      "dd_reguler":         { "...": "..." },
      "bhprd":              { "...": "..." },
      "bankeu_infras_desa": { "...": "..." },
      "bp":                 { "...": "..." }
    }
  }
}
```
