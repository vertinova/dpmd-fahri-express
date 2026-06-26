# Update Data BPJS untuk RT/RW Comparison

## Ringkasan

Data BPJS peserta RT/RW disimpan sebagai JSON cache di `data/rtrwbpjs.json`.
File ini dibaca oleh backend (`rtrwComparison.controller.js`) dan di-serve ke
halaman **Persandingan RT/RW** di frontend. Cache backend otomatis ter-invalidasi
saat `rtrwbpjs.json` berubah (deteksi via `mtimeMs` + `size`).

---

## Langkah Update

### 1. Tempatkan file BPJS baru

Taruh file Excel baru di folder bebas (tidak harus `data/`). Contoh:

```
dpmd-fahri-express/data/rtrwbpjs20260626.xlsx
```

### 2. Periksa nama sheet

File BPJS yang pernah diterima menggunakan dua nama sheet berbeda:

| Sheet name   | Sumber                       |
|--------------|------------------------------|
| `DATABASE`   | Format lama (s.d. Mei 2026)  |
| `data_upah`  | Format baru (Juni 2026+)     |

Periksa dengan cepat:

```bash
node -e "const x=require('xlsx').readFile('data/rtrwbpjs_baru.xlsx'); console.log(x.SheetNames)"
```

### 3. Update `BPJS_FILE` di generate script lalu jalankan

Edit satu baris di `scripts/generate-rtrw-json-cache.js`:

```js
// Ganti nilai BPJS_FILE ke file terbaru:
const BPJS_FILE = path.join(DATA_DIR, 'rtrwbpjs20260626.xlsx'); // ← nama file baru
```

Lalu jalankan:

```bash
cd dpmd-fahri-express
node scripts/generate-rtrw-json-cache.js
```

Script sudah menangani:
- Deteksi sheet otomatis (`DATABASE` → `data_upah` → sheet pertama)
- Normalisasi `ID_PEGAWAI` integer → dot-format `32.01.XX.XXXX` via `normalizeBpjsDesaKode()`

> **Penting (lesson learned Juni 2026):** Format lama (`rtrwbpjs.xlsx`) menyimpan
> `ID_PEGAWAI` sebagai teks `32.01.XX.XXXX`. Format baru (`data_upah`) menyimpannya
> sebagai integer `3201XXXXXX`. Fungsi `normalizeBpjsDesaKode()` sudah ditambahkan
> ke generate script dan controller untuk menangani kedua format secara otomatis.

### 4. Verifikasi output

```bash
node -e "
const d = JSON.parse(require('fs').readFileSync('data/rtrwbpjs.json'));
console.log('generatedAt   :', d.generatedAt);
console.log('source        :', d.source.name);
console.log('sheetName     :', d.sheetName);
console.log('totalPenerima :', d.meta.totalPenerima);
console.log('totalDesa     :', d.meta.totalDesa);
console.log('sample blth   :', [...new Set(d.data.flatMap(x=>x.details.map(y=>y.blth)))].sort().join(', '));
"
```

### 5. Cache backend invalidasi otomatis

Tidak perlu restart server. Controller mendeteksi perubahan via `mtimeMs + size`
dari `rtrwbpjs.json` pada setiap request. Halaman RT/RW Comparison langsung pakai
data baru setelah JSON ditulis.

---

## Kolom yang wajib ada di Excel

| Kolom Excel   | Keterangan                        |
|---------------|-----------------------------------|
| `NIK`         | 16 digit NIK peserta              |
| `ID_PEGAWAI`  | Kode desa (format: `3201022001`)  |
| `KPJ`         | Nomor kartu BPJS                  |
| `KODE_TK`     | Kode tenaga kerja                 |
| `NAMA_LENGKAP`| Nama peserta                      |
| `TGL_LAHIR`   | Format `DD-MM-YYYY` atau serial   |
| `UPAH`        | Nominal upah (angka)              |
| `RAPEL`       | Rapel (angka, boleh 0)            |
| `BLTH`        | Bulan tagihan `DD-MM-YYYY`        |
| `NPP`         | Nomor pelaksanaan pembayaran      |

---

## Riwayat update

| Tanggal    | File sumber                     | Sheet        | Penerima | Desa |
|------------|---------------------------------|--------------|----------|------|
| 2026-05-05 | `rtrwbpjs.xlsx`                 | `DATABASE`   | 19.682   | 432  |
| 2026-06-26 | `rtrwbpjs20260626.xlsx`         | `data_upah`  | 21.559   | 413  |
