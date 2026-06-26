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

### 3. Jalankan konversi (inline — tidak perlu ubah file lain)

```bash
cd dpmd-fahri-express

node - << 'EOF'
const fs   = require('fs');
const path = require('path');
const XLSX = require('xlsx');

const toText       = (v) => String(v ?? '').trim();
const toUpper      = (v) => toText(v).toUpperCase();
const normalizeNik = (v) => { const d = String(v??'').replace(/\D/g,''); return d.length>=10?d:''; };
const normalizeName = (v) => {
  let n = toUpper(v).normalize('NFKD').replace(/[̀-ͯ]/g,'');
  n = n.replace(/[.`'"]/g,' ').replace(/[()_:/\\-]/g,' ')
       .replace(/^(H|HJ|HJA|HAJI|HAJAH)\s+/g,'').replace(/\s+/g,' ').trim();
  return n;
};
const numberValue = (v) => { if(typeof v==='number')return v; const p=Number(String(v??'').replace(/[^\d.-]/g,'')); return Number.isFinite(p)?p:0; };
const dateToStr   = (v) => {
  if(!v) return '';
  if(v instanceof Date && !Number.isNaN(v.getTime())) return v.toISOString().slice(0,10);
  if(typeof v==='number' && v>1000){ const d=new Date(Math.round((v-25569)*86400*1000)); return Number.isNaN(d.getTime())?'':d.toISOString().slice(0,10); }
  const t = toText(v);
  const dmy = t.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
  if(dmy) return `${dmy[3]}-${dmy[2].padStart(2,'0')}-${dmy[1].padStart(2,'0')}`;
  const ymd = t.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  if(ymd) return `${ymd[1]}-${ymd[2].padStart(2,'0')}-${ymd[3].padStart(2,'0')}`;
  return t;
};

// ← GANTI path ini ke file BPJS baru
const SRC = path.join(__dirname, 'data', 'rtrwbpjs_BARU.xlsx');
const OUT = path.join(__dirname, 'data', 'rtrwbpjs.json');

const workbook  = XLSX.readFile(SRC);
const sheetName = workbook.Sheets['DATABASE']  ? 'DATABASE'
                : workbook.Sheets['data_upah'] ? 'data_upah'
                : workbook.Sheets['Sheet1']    ? 'Sheet1'
                : workbook.SheetNames[0];

console.log('Sheet dipakai:', sheetName);
const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { defval: '' });
console.log('Baris terbaca:', rows.length);

const grouped = new Map();
rows.forEach((row) => {
  const desaKode = toText(row.ID_PEGAWAI || row.ID_Pegawai || row['ID Pegawai']);
  const nama     = normalizeName(row.NAMA_LENGKAP);
  if (!desaKode || !nama) return;
  const nik = normalizeNik(row.NIK);
  const key = `${desaKode}|${nik || nama}`;
  const detail = {
    nik, idPegawai: desaKode,
    kpj: toText(row.KPJ), kodeTk: toText(row.KODE_TK),
    namaLengkap: nama,
    tglLahir: dateToStr(row.TGL_LAHIR),
    upah: numberValue(row.UPAH), rapel: numberValue(row.RAPEL),
    blth: dateToStr(row.BLTH), npp: toText(row.NPP),
  };
  if (!grouped.has(key)) {
    grouped.set(key, { source:'bpjs', nama, normalized:nama, nik, desaKode, totalUpah:0, details:[] });
  }
  const item = grouped.get(key);
  item.totalUpah += detail.upah;
  item.details.push(detail);
});

const stat = fs.statSync(SRC);
const payload = {
  version: 1,
  generatedAt: new Date().toISOString(),
  source: { name: path.basename(SRC), size: stat.size, mtimeMs: stat.mtimeMs },
  sheetName,
  meta: {
    totalRows: rows.length,
    totalPenerima: grouped.size,
    totalDesa: new Set([...grouped.values()].map(i => i.desaKode)).size,
  },
  data: Array.from(grouped.values()),
};

fs.writeFileSync(OUT, JSON.stringify(payload));
const outStat = fs.statSync(OUT);
console.log('totalPenerima :', payload.meta.totalPenerima);
console.log('totalDesa     :', payload.meta.totalDesa);
console.log('Output        :', OUT, `(${(outStat.size/1024/1024).toFixed(2)} MB)`);
EOF
```

> **Catatan:** Ganti `rtrwbpjs_BARU.xlsx` di baris `const SRC` dengan nama file aktual.

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
