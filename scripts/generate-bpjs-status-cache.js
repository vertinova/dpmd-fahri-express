/**
 * BPJS Membership Status Cache Generator
 * =====================================================================
 * Membaca folder "DESK BPJS JULI 2026" (1 file .xlsx per desa, dikelompokkan
 * per kecamatan). Setiap file punya sheet:
 *   - AKTIF     : peserta BPJS TK yang ditandai MASIH AKTIF   (punya NIK+KPJ)
 *   - NON AKTIF : peserta yang ditandai TIDAK AKTIF           (hanya KPJ, tanpa NIK)
 *   - BARU      : pengurus RT/RW BARU yang belum terdaftar BPJS (punya NIK+RT/RW)
 *   - DATABASE  : master mentah 21k baris (diabaikan — sudah ada di rtrwbpjs.json)
 *
 * Menghasilkan:
 *   1. data/rtrwbpjsstatus.json          -> dipakai controller sebagai overlay
 *   2. RTRW_BPJS_Status_Report_<tgl>.xlsx -> laporan (desa kosong + jumlah/desa)
 *
 * Jalankan:  node scripts/generate-bpjs-status-cache.js
 * Override sumber: set env BPJS_DESK_DIR="path/ke/folder"
 * =====================================================================
 */

const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');
const prisma = require('../src/config/prisma');

const DATA_DIR = path.join(__dirname, '..', 'data');
const SOURCE_DIR = process.env.BPJS_DESK_DIR
  || path.join(DATA_DIR, 'desk-bpjs-juli-2026');
const FALLBACK_SOURCE_DIR = 'c:/laragon/www/dpmd/DESK BPJS JULI 2026';
const OUTPUT_JSON = path.join(DATA_DIR, 'rtrwbpjsstatus.json');
const OUTPUT_REPORT = path.join(__dirname, '..', '..', `RTRW_BPJS_Status_Report_${new Date().toISOString().slice(0, 10)}.xlsx`);
const CACHE_VERSION = 1;

// ---------------------------------------------------------------------------
// Helpers (disamakan dengan rtrwComparison.controller.js)
// ---------------------------------------------------------------------------
const toText = (value) => String(value ?? '').trim();
const toUpper = (value) => toText(value).toUpperCase();

function normalizeNik(value) {
  const digits = String(value ?? '').replace(/\D/g, '');
  return digits.length >= 10 ? digits : '';
}

const DEGREE_TOKENS = new Set([
  'SE', 'SH', 'ST', 'SPD', 'SPDI', 'SSOS', 'SAG', 'SKOM', 'SIP', 'SKM', 'SPT', 'SHUT',
  'SPI', 'SS', 'SAB', 'SIKOM', 'SPSI', 'SKED', 'SFARM', 'SKEP', 'SSI', 'SSTP', 'SP',
  'AMD', 'AMK', 'MM', 'MSI', 'MPD', 'MPDI', 'MH', 'MKOM', 'MAP', 'MSC', 'MT', 'MKES', 'PHD',
]);

function normalizeName(value) {
  let name = toUpper(value);
  name = name.normalize('NFKD').replace(/[̀-ͯ]/g, '');
  name = name.replace(/\./g, '');
  name = name.replace(/[,`'"]/g, ' ');
  name = name.replace(/[()_:/\\-]/g, ' ');
  name = name.replace(/\s+/g, ' ').trim();
  name = name.replace(/^(H|HJ|HJA|HAJI|HAJAH|DRS|DRA|IR|KH)\s+/g, '');
  const tokens = name.split(' ').filter(Boolean);
  while (tokens.length > 1 && DEGREE_TOKENS.has(tokens[tokens.length - 1])) tokens.pop();
  return tokens.join(' ');
}

function padNomor(value) {
  const digits = String(value ?? '').replace(/\D/g, '').replace(/^0+/, '');
  return digits ? digits.padStart(3, '0') : null;
}

function numberValue(value) {
  if (typeof value === 'number') return value;
  const cleaned = String(value ?? '').replace(/[^\d.-]/g, '');
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : 0;
}

function dateToStr(value) {
  if (!value) return '';
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }
  if (typeof value === 'number' && value > 1000) {
    const date = new Date(Math.round((value - 25569) * 86400 * 1000));
    return Number.isNaN(date.getTime()) ? '' : date.toISOString().slice(0, 10);
  }
  const text = toText(value);
  const dmy = text.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
  if (dmy) return `${dmy[3]}-${dmy[2].padStart(2, '0')}-${dmy[1].padStart(2, '0')}`;
  const ymd = text.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  if (ymd) return `${ymd[1]}-${ymd[2].padStart(2, '0')}-${ymd[3].padStart(2, '0')}`;
  return text;
}

function normalizeBpjsDesaKode(value) {
  const raw = toText(value).replace(/\.+$/g, '');
  if (/^32\.01\.\d{2}\.\d{4}$/.test(raw)) return raw;
  const digits = raw.replace(/\D/g, '');
  if (digits.length === 10) return `${digits.slice(0, 2)}.${digits.slice(2, 4)}.${digits.slice(4, 6)}.${digits.slice(6, 10)}`;
  return raw;
}

// Kode desa yang valid mengikuti pola BPS 32.01.xx.xxxx
function isValidDesaKode(kode) {
  return /^32\.01\.\d{2}\.\d{4}$/.test(kode || '');
}

// Tgl lahir dengan penjaga tahun wajar (1900..2015). Membuang nilai yang bocor
// dari kolom BLTH (2025/2026) atau typo sumber ("0069", "1864").
function birthDate(value) {
  const s = dateToStr(value);
  const year = parseInt(String(s).slice(0, 4), 10);
  return year >= 1900 && year <= 2015 ? s : '';
}

function jenisFromJabatan(jabatan, rt, rw) {
  const t = toUpper(jabatan);
  if (/\bRT\b/.test(t)) return 'RT';
  if (/\bRW\b/.test(t)) return 'RW';
  if (rt) return 'RT';
  if (rw) return 'RW';
  return null;
}

// ---------------------------------------------------------------------------
// Traversal & parsing
// ---------------------------------------------------------------------------
function resolveSourceDir() {
  if (fs.existsSync(SOURCE_DIR)) return SOURCE_DIR;
  if (fs.existsSync(FALLBACK_SOURCE_DIR)) return FALLBACK_SOURCE_DIR;
  throw new Error(`Folder sumber DESK BPJS tidak ditemukan. Set env BPJS_DESK_DIR. Dicari: ${SOURCE_DIR}`);
}

function walkExcel(dir) {
  let out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) out = out.concat(walkExcel(p));
    else if (/\.xlsx?$/i.test(entry.name) && !entry.name.startsWith('~$')) out.push(p);
  }
  return out;
}

function mode(values) {
  const count = new Map();
  values.forEach((v) => count.set(v, (count.get(v) || 0) + 1));
  let best = null;
  let bestN = 0;
  for (const [v, n] of count) {
    if (n > bestN) { best = v; bestN = n; }
  }
  return best;
}

// ---------------------------------------------------------------------------
// Deteksi kolom berbasis ISI (bukan nama header). Perlu karena banyak file
// bergeser kolom: header ada "NO" tapi data tak mengisinya, sehingga NIK jatuh
// di kolom "NO", nama di kolom "KODE_TK", dst. Deteksi via pola nilai jauh lebih
// tahan-banting daripada memetakan lewat nama header.
// ---------------------------------------------------------------------------
const RE_NIK = /^\d{16}$/;
const RE_DATE = /^\d{1,2}[-/]\d{1,2}[-/]\d{4}$/;
const RE_KODE = /^32\.01(?:\.\d{2}\.\d{4})?\.?$/;
const NONAKTIF_KEYWORDS = /BERAKHIR|MASA BAKTI|MENGUNDURKAN|MENINGGAL|PINDAH|NON ?AKTIF|TIDAK AKTIF/i;

function readArraySheet(ws) {
  if (!ws) return [];
  return XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', blankrows: false });
}

// Cari indeks baris header (mengandung sel NAMA_LENGKAP / NAMA / NIK), data mulai setelahnya.
function findHeaderRow(rows, tokens) {
  for (let i = 0; i < Math.min(rows.length, 6); i++) {
    const joined = rows[i].map((c) => toUpper(c)).join('|');
    if (tokens.some((t) => joined.includes(t))) return i;
  }
  return 0;
}

function colScores(dataRows, cIdx, sampleN = 60) {
  const s = { n: 0, nik: 0, kode: 0, name: 0, kpj: 0, kodeTk: 0, date: 0, upah: 0, keyword: 0 };
  for (const r of dataRows) {
    const raw = r[cIdx];
    if (raw === '' || raw == null) continue;
    s.n += 1;
    const str = String(raw).trim();
    const digits = str.replace(/\D/g, '');
    if (RE_NIK.test(str)) s.nik += 1;
    if (RE_KODE.test(str) || isValidDesaKode(normalizeBpjsDesaKode(str))) s.kode += 1;
    if (/[A-Za-z]/.test(str) && str.replace(/[^A-Za-z]/g, '').length >= 3 && !/^\d/.test(str)) s.name += 1;
    if (/^9\d{13,15}$/.test(digits)) s.kodeTk += 1;
    else if (/^\d{9,12}$/.test(str)) s.kpj += 1; // str (bukan digits) -> tolak "32.01.xx.xxxx"
    if (RE_DATE.test(str) || (typeof raw === 'number' && raw > 10000 && raw < 60000)) s.date += 1;
    if ((typeof raw === 'number' || /^\d+$/.test(str)) && Number(digits) >= 100000 && Number(digits) <= 100000000) s.upah += 1;
    if (NONAKTIF_KEYWORDS.test(str)) s.keyword += 1;
    if (s.n >= sampleN) break;
  }
  return s;
}

// Pilih kolom terbaik untuk tiap peran; kolom yang sudah terpakai dikecualikan.
function detectColumns(dataRows, roles) {
  const maxCols = dataRows.reduce((m, r) => Math.max(m, r.length), 0);
  const stats = [];
  for (let c = 0; c < maxCols; c++) stats.push(colScores(dataRows, c));
  const used = new Set();
  const picked = {};
  for (const [role, metric] of roles) {
    let best = -1; let bestScore = 0;
    for (let c = 0; c < maxCols; c++) {
      if (used.has(c)) continue;
      const st = stats[c];
      if (!st.n) continue;
      const score = st[metric] / st.n;
      if (st[metric] > 0 && score > bestScore) { bestScore = score; best = c; }
    }
    if (best >= 0 && bestScore >= 0.4) { picked[role] = best; used.add(best); }
  }
  return picked;
}

// Cocokkan nama sheet secara toleran (abaikan spasi & besar-kecil huruf), jadi
// "NON AKTIF" / "NONAKTIF" / "Non Aktif" -> NONAKTIF; "Aktif" -> AKTIF; dst.
const normSheet = (name) => String(name).toUpperCase().replace(/[^A-Z]/g, '');

function parseFile(filePath, agg, warnings) {
  const fileName = path.basename(filePath);
  // Baca nama sheet dulu (cepat, tanpa parse sel) untuk temukan variasi nama.
  let sheetNames;
  try {
    sheetNames = XLSX.readFile(filePath, { bookSheets: true }).SheetNames || [];
  } catch (err) {
    warnings.push({ level: 'error', file: fileName, message: `Gagal baca daftar sheet: ${err.message}` });
    return;
  }
  const pickSheet = (target) => sheetNames.find((n) => normSheet(n) === target);
  const sAktif = pickSheet('AKTIF');
  const sNon = pickSheet('NONAKTIF');
  const sBaru = pickSheet('BARU');
  const wanted = [sAktif, sNon, sBaru].filter(Boolean);
  if (!wanted.length) {
    warnings.push({ level: 'warn', file: fileName, message: 'Tak ada sheet AKTIF/NON AKTIF/BARU yang dikenali — dilewati.' });
    return;
  }

  let wb;
  try {
    wb = XLSX.readFile(filePath, { sheets: wanted, cellDates: false });
  } catch (err) {
    warnings.push({ level: 'error', file: fileName, message: `Gagal baca workbook: ${err.message}` });
    return;
  }

  const aktifAll = readArraySheet(sAktif ? wb.Sheets[sAktif] : null);
  const nonAktifAll = readArraySheet(sNon ? wb.Sheets[sNon] : null);
  const baruAll = readArraySheet(sBaru ? wb.Sheets[sBaru] : null);

  const aktifRows = aktifAll.slice(findHeaderRow(aktifAll, ['NAMA_LENGKAP', 'NIK']) + 1);
  const nonAktifRows = nonAktifAll.slice(findHeaderRow(nonAktifAll, ['NAMA_LENGKAP', 'KPJ', 'SEBAB']) + 1);
  // BARU: header 2 baris (baris 0 & 1), data mulai baris ke-2
  const baruRows = baruAll.slice(2);

  // Deteksi kolom via isi (tahan pergeseran kolom antar file).
  const aCol = detectColumns(aktifRows, [
    ['nik', 'nik'], ['kodeTk', 'kodeTk'], ['kode', 'kode'],
    ['tgl', 'date'], ['nama', 'name'], ['kpj', 'kpj'], ['upah', 'upah'],
  ]);
  const nCol = detectColumns(nonAktifRows, [
    ['kpj', 'kpj'], ['sebab', 'keyword'], ['tgl', 'date'], ['nama', 'name'],
  ]);
  const bCol = detectColumns(baruRows, [
    ['nik', 'nik'], ['kode', 'kode'], ['tgl', 'date'], ['nama', 'name'],
  ]);
  const at = (row, idx) => (idx == null ? '' : row[idx]);

  // Kode desa file: dari kolom kode AKTIF & BARU (modus).
  const kodeCandidates = [];
  [[aktifRows, aCol.kode], [baruRows, bCol.kode]].forEach(([rows, idx]) => {
    if (idx == null) return;
    rows.forEach((r) => {
      const k = normalizeBpjsDesaKode(at(r, idx));
      if (isValidDesaKode(k)) kodeCandidates.push(k);
    });
  });
  const fileDesaKode = mode(kodeCandidates);

  if (!fileDesaKode) {
    warnings.push({ level: 'error', file: fileName, message: 'Kode desa file tidak dapat ditentukan (AKTIF & BARU kosong/invalid) — data file ini dilewati.' });
    return;
  }

  const bucket = agg.byDesa.get(fileDesaKode) || {
    desaKode: fileDesaKode, aktif: 0, nonAktif: 0, baru: 0, files: new Set(),
  };
  bucket.files.add(fileName);

  // ---- AKTIF ----
  aktifRows.forEach((r) => {
    const namaRaw = toText(at(r, aCol.nama));
    const nama = normalizeName(namaRaw);
    const nik = normalizeNik(at(r, aCol.nik));
    const kpj = toText(at(r, aCol.kpj));
    if (!nama && !nik && !kpj) return;
    const rowKode = (() => {
      const k = normalizeBpjsDesaKode(at(r, aCol.kode));
      return isValidDesaKode(k) ? k : fileDesaKode;
    })();
    bucket.aktif += 1;
    agg.totals.aktif += 1;

    const rec = {
      status: 'aktif', desaKode: rowKode, nik, kpj,
      kodeTk: toText(at(r, aCol.kodeTk)), nama,
      tglLahir: birthDate(at(r, aCol.tgl)), upah: numberValue(at(r, aCol.upah)),
      sourceFile: fileName,
    };
    agg.aktifList.push({
      desaKode: rowKode, namaRaw: namaRaw || nama, nik, kpj,
      tglLahir: rec.tglLahir, upah: rec.upah, sourceFile: fileName,
    });
    if (nik) {
      if (agg.byNik.has(nik) && agg.byNik.get(nik).sourceFile !== fileName) {
        warnings.push({ level: 'info', file: fileName, message: `NIK ${nik} (${nama}) duplikat lintas file dengan ${agg.byNik.get(nik).sourceFile}` });
      }
      agg.byNik.set(nik, rec);
    }
    if (kpj) agg.byKpj.set(kpj, rec);
    if (!nik && !kpj) warnings.push({ level: 'warn', file: fileName, message: `AKTIF tanpa NIK & KPJ: ${nama}` });
  });

  // ---- NON AKTIF (tanpa NIK, hanya KPJ) ----
  nonAktifRows.forEach((r) => {
    const namaRaw = toText(at(r, nCol.nama));
    const nama = normalizeName(namaRaw);
    const kpj = toText(at(r, nCol.kpj));
    if (!nama && !kpj) return;
    bucket.nonAktif += 1;
    agg.totals.nonAktif += 1;

    const rec = {
      status: 'non_aktif', desaKode: fileDesaKode, nik: '', kpj, nama,
      tglLahir: birthDate(at(r, nCol.tgl)),
      sebab: toText(at(r, nCol.sebab)),
      tglTidakAktif: '',
      keterangan: '',
      sourceFile: fileName,
    };
    agg.nonAktifList.push({
      desaKode: fileDesaKode, namaRaw: namaRaw || nama, normalized: nama, kpj,
      tglLahir: rec.tglLahir, sebab: rec.sebab, sourceFile: fileName,
    });
    if (kpj) {
      // Non-aktif menang atas aktif untuk KPJ yang sama (status terbaru).
      agg.byKpj.set(kpj, rec);
    } else {
      agg.nonAktifNoKpj.push(rec);
      warnings.push({ level: 'warn', file: fileName, message: `NON AKTIF tanpa KPJ (tak bisa dijoin): ${nama}` });
    }
  });

  // ---- BARU (pengurus baru, belum di BPJS) ----
  // Kolom deskriptif (jabatan/rw/rt/alamat/pendidikan) tetap posisional karena
  // sheet BARU berbentuk formulir SK yang konsisten; NIK/nama/kode dideteksi isi.
  baruRows.forEach((r) => {
    const namaRaw = toText(at(r, bCol.nama) || r[2]);
    const nama = normalizeName(namaRaw);
    const nik = normalizeNik(at(r, bCol.nik) || r[3]);
    if (!nama && !nik) return;
    const kode = (() => {
      const k = normalizeBpjsDesaKode(at(r, bCol.kode) || r[1]);
      return isValidDesaKode(k) ? k : fileDesaKode;
    })();
    const jabatan = toText(r[7]);
    const rw = padNomor(r[8]);
    const rt = padNomor(r[9]);
    bucket.baru += 1;
    agg.totals.baru += 1;

    agg.baru.push({
      desaKode: kode, nik, normalized: nama, nama: namaRaw,
      jenis: jenisFromJabatan(jabatan, rt, rw), jabatan,
      rwNomor: rw, rtNomor: rt,
      lp: toText(r[4]), tempatLahir: toText(r[5]), tglLahir: birthDate(at(r, bCol.tgl) || r[6]),
      noSk: toText(r[10]), masaBhakti: dateToStr(r[11]),
      alamat: toText(r[12]), pendidikan: toText(r[18]),
      sourceFile: fileName,
    });
    if (!nik) warnings.push({ level: 'info', file: fileName, message: `BARU tanpa NIK: ${namaRaw}` });
  });

  agg.byDesa.set(fileDesaKode, bucket);
}

// ---------------------------------------------------------------------------
// Report builder (butuh daftar desa dari database)
// ---------------------------------------------------------------------------
async function buildReport(agg) {
  const desas = await prisma.desas.findMany({
    select: {
      kode: true, nama: true, status_pemerintahan: true,
      kecamatans: { select: { nama: true } },
    },
    orderBy: [{ kecamatans: { nama: 'asc' } }, { nama: 'asc' }],
  });
  const desaByKode = new Map(desas.map((d) => [d.kode, d]));

  const perDesaRows = desas.map((d) => {
    const b = agg.byDesa.get(d.kode);
    return {
      'KODE DESA': d.kode,
      'DESA': d.nama,
      'KECAMATAN': d.kecamatans?.nama || '',
      'JENIS': d.status_pemerintahan,
      'AKTIF': b?.aktif || 0,
      'NON AKTIF': b?.nonAktif || 0,
      'BARU': b?.baru || 0,
      'TOTAL': (b?.aktif || 0) + (b?.nonAktif || 0) + (b?.baru || 0),
      'ADA FILE': b ? 'Ya' : 'Tidak',
      'FILE SUMBER': b ? [...b.files].join('; ') : '',
    };
  });

  // Desa di DB yang belum punya data sama sekali
  const emptyRows = perDesaRows
    .filter((r) => r['TOTAL'] === 0)
    .map((r) => ({
      'KODE DESA': r['KODE DESA'], 'DESA': r['DESA'],
      'KECAMATAN': r['KECAMATAN'], 'JENIS': r['JENIS'],
      'KETERANGAN': r['ADA FILE'] === 'Ya' ? 'Ada file tapi 0 data' : 'Belum ada file/data',
    }));

  // Kode desa dari file yang TIDAK dikenal di database
  const unknownKodes = [...agg.byDesa.keys()]
    .filter((k) => !desaByKode.has(k))
    .map((k) => {
      const b = agg.byDesa.get(k);
      return {
        'KODE DESA (FILE)': k,
        'AKTIF': b.aktif, 'NON AKTIF': b.nonAktif, 'BARU': b.baru,
        'FILE SUMBER': [...b.files].join('; '),
      };
    });

  // Perkaya AKTIF dengan JENIS/RW/RT dari database (match via NIK ke pengurus).
  const aktifNiks = [...new Set(agg.aktifList.map((a) => a.nik).filter(Boolean))];
  const pengurusByNik = new Map();
  if (aktifNiks.length) {
    const pengurus = await prisma.pengurus.findMany({
      where: { nik: { in: aktifNiks }, pengurusable_type: { in: ['rw', 'rt', 'rws', 'rts'] } },
      select: { nik: true, pengurusable_type: true, pengurusable_id: true, jabatan: true },
    });
    // Normalisasi tipe (rt->rts, rw->rws) seperti di controller.
    const norm = (t) => (t === 'rt' ? 'rts' : t === 'rw' ? 'rws' : t);
    const rtIds = pengurus.filter((p) => norm(p.pengurusable_type) === 'rts').map((p) => p.pengurusable_id);
    const rwIds = pengurus.filter((p) => norm(p.pengurusable_type) === 'rws').map((p) => p.pengurusable_id);
    const [rts, rws] = await Promise.all([
      rtIds.length ? prisma.rts.findMany({ where: { id: { in: rtIds } }, select: { id: true, nomor: true, rws: { select: { nomor: true } } } }) : [],
      rwIds.length ? prisma.rws.findMany({ where: { id: { in: rwIds } }, select: { id: true, nomor: true } }) : [],
    ]);
    const rtById = new Map(rts.map((rt) => [rt.id, rt]));
    const rwById = new Map(rws.map((rw) => [rw.id, rw]));
    pengurus.forEach((p) => {
      const nik = normalizeNik(p.nik);
      if (!nik || pengurusByNik.has(nik)) return;
      const type = norm(p.pengurusable_type);
      const rt = type === 'rts' ? rtById.get(p.pengurusable_id) : null;
      const rw = type === 'rws' ? rwById.get(p.pengurusable_id) : null;
      pengurusByNik.set(nik, {
        jenis: type === 'rts' ? 'RT' : 'RW',
        rwNomor: type === 'rts' ? (rt?.rws?.nomor ?? '') : (rw?.nomor ?? ''),
        rtNomor: type === 'rts' ? (rt?.nomor ?? '') : '',
        jabatan: p.jabatan || '',
      });
    });
  }

  const sortLoc = (a, b) => String(a.KECAMATAN).localeCompare(String(b.KECAMATAN))
    || String(a.DESA).localeCompare(String(b.DESA))
    || String(a.NAMA).localeCompare(String(b.NAMA));

  const aktifRows = agg.aktifList.map((a) => {
    const desa = desaByKode.get(a.desaKode);
    const info = a.nik ? pengurusByNik.get(a.nik) : null;
    return {
      'KECAMATAN': desa?.kecamatans?.nama || '',
      'DESA': desa?.nama || '',
      'KODE DESA': a.desaKode,
      'JENIS': info?.jenis || '',
      'RW': info?.rwNomor || '',
      'RT': info?.rtNomor || '',
      'NAMA': a.namaRaw,
      'NIK': a.nik || '',
      'KPJ': a.kpj || '',
      'TGL LAHIR': a.tglLahir || '',
      'UPAH': a.upah || 0,
      'JABATAN (DB)': info?.jabatan || '',
      'ADA DI DB': info ? 'Ya' : 'Tidak',
      'FILE SUMBER': a.sourceFile,
    };
  }).sort(sortLoc);

  const nonAktifRows = agg.nonAktifList.map((n) => {
    const desa = desaByKode.get(n.desaKode);
    return {
      'KECAMATAN': desa?.kecamatans?.nama || '',
      'DESA': desa?.nama || '',
      'KODE DESA': n.desaKode,
      'NAMA': n.namaRaw,
      'KPJ': n.kpj || '',
      'TGL LAHIR': n.tglLahir || '',
      'SEBAB NON-AKTIF': n.sebab || '',
      'FILE SUMBER': n.sourceFile,
    };
  }).sort(sortLoc);

  return { desas, perDesaRows, emptyRows, unknownKodes, aktifRows, nonAktifRows };
}

function writeReportExcel(agg, report, warnings) {
  const wb = XLSX.utils.book_new();

  const totalDesaDb = report.desas.length;
  const desaWithData = report.perDesaRows.filter((r) => r['TOTAL'] > 0).length;
  const summaryRows = [
    { INFO: 'Total file Excel diproses', NILAI: agg.filesProcessed },
    { INFO: 'Total desa di database', NILAI: totalDesaDb },
    { INFO: 'Desa punya data (aktif/nonaktif/baru)', NILAI: desaWithData },
    { INFO: 'Desa KOSONG (belum ada data)', NILAI: totalDesaDb - desaWithData },
    { INFO: 'Total peserta AKTIF', NILAI: agg.totals.aktif },
    { INFO: 'AKTIF dpt RT/RW dari DB', NILAI: report.aktifRows.filter((r) => r['ADA DI DB'] === 'Ya').length },
    { INFO: 'Total peserta NON AKTIF', NILAI: agg.totals.nonAktif },
    { INFO: 'Total pengurus BARU', NILAI: agg.totals.baru },
    { INFO: 'Kode desa file tak dikenal DB', NILAI: report.unknownKodes.length },
    { INFO: 'NON AKTIF tanpa KPJ (tak bisa dijoin)', NILAI: agg.nonAktifNoKpj.length },
    { INFO: 'Jumlah warning', NILAI: warnings.length },
    { INFO: 'Dibuat pada', NILAI: new Date().toISOString() },
  ];

  const addSheet = (name, rows) => {
    const ws = XLSX.utils.json_to_sheet(rows.length ? rows : [{ '(kosong)': '' }]);
    if (rows.length) {
      ws['!cols'] = Object.keys(rows[0]).map((k) => {
        const maxLen = Math.max(k.length, ...rows.map((r) => String(r[k] ?? '').length));
        return { wch: Math.min(maxLen + 2, 55) };
      });
    }
    XLSX.utils.book_append_sheet(wb, ws, name);
  };

  addSheet('Ringkasan', summaryRows);
  addSheet('Jumlah per Desa', report.perDesaRows);
  addSheet('Daftar Aktif', report.aktifRows);
  addSheet('Daftar Non-Aktif', report.nonAktifRows);
  addSheet('Desa Kosong', report.emptyRows);
  addSheet('Kode Tak Dikenal', report.unknownKodes);
  addSheet('Warnings', warnings.map((w) => ({ LEVEL: w.level, FILE: w.file, PESAN: w.message })));

  XLSX.writeFile(wb, OUTPUT_REPORT);
}

function writeJsonCache(agg) {
  const membershipByNik = {};
  for (const [nik, rec] of agg.byNik) {
    membershipByNik[nik] = {
      status: rec.status, desaKode: rec.desaKode, kpj: rec.kpj,
      kodeTk: rec.kodeTk, upah: rec.upah, tglLahir: rec.tglLahir,
      sourceFile: rec.sourceFile,
    };
  }
  const membershipByKpj = {};
  for (const [kpj, rec] of agg.byKpj) {
    membershipByKpj[kpj] = {
      status: rec.status, desaKode: rec.desaKode, nik: rec.nik || '',
      sebab: rec.sebab || '', tglTidakAktif: rec.tglTidakAktif || '',
      keterangan: rec.keterangan || '', tglLahir: rec.tglLahir || '',
      sourceFile: rec.sourceFile,
    };
  }

  // Fallback join non-aktif via nama+desa: dipakai controller saat KPJ/NIK gagal
  // (mis. KPJ peserta di master BPJS kosong). Key = `${normalized}|${desaKode}`.
  const membershipByNameDesa = {};
  for (const n of agg.nonAktifList) {
    if (!n.normalized || !n.desaKode) continue;
    const key = `${n.normalized}|${n.desaKode}`;
    if (membershipByNameDesa[key]) continue; // deterministik: pertama menang
    membershipByNameDesa[key] = {
      status: 'non_aktif', desaKode: n.desaKode,
      sebab: n.sebab || '', tglTidakAktif: '', tglLahir: n.tglLahir || '',
      sourceFile: n.sourceFile,
    };
  }

  const payload = {
    version: CACHE_VERSION,
    generatedAt: new Date().toISOString(),
    meta: {
      sourceDir: agg.sourceDir,
      filesProcessed: agg.filesProcessed,
      totalAktif: agg.totals.aktif,
      totalNonAktif: agg.totals.nonAktif,
      totalBaru: agg.totals.baru,
      desaWithData: agg.byDesa.size,
    },
    membershipByNik,
    membershipByKpj,
    membershipByNameDesa,
    baru: agg.baru,
  };
  fs.writeFileSync(OUTPUT_JSON, JSON.stringify(payload));
  return fs.statSync(OUTPUT_JSON).size;
}

async function main() {
  const startedAt = Date.now();
  const sourceDir = resolveSourceDir();
  const files = walkExcel(sourceDir);

  const agg = {
    sourceDir,
    filesProcessed: 0,
    totals: { aktif: 0, nonAktif: 0, baru: 0 },
    byDesa: new Map(),
    byNik: new Map(),
    byKpj: new Map(),
    baru: [],
    nonAktifNoKpj: [],
    aktifList: [],     // semua baris AKTIF (untuk sheet Daftar Aktif)
    nonAktifList: [],  // semua baris NON AKTIF (untuk sheet Daftar Non-Aktif)
  };
  const warnings = [];

  files.forEach((f) => { parseFile(f, agg, warnings); agg.filesProcessed += 1; });

  const report = await buildReport(agg);
  const jsonSize = writeJsonCache(agg); // tulis JSON dulu (yang dipakai aplikasi)
  let reportError = null;
  try {
    writeReportExcel(agg, report, warnings);
  } catch (err) {
    // Umumnya EBUSY karena file laporan sedang dibuka di Excel. JSON sudah aman.
    reportError = err.message;
    console.warn(`\n[!] Laporan Excel GAGAL ditulis (${err.code || 'error'}): ${err.message}\n    -> JSON cache tetap tersimpan. Tutup file Excel lalu jalankan ulang untuk laporan.`);
  }

  console.log(JSON.stringify({
    ms: Date.now() - startedAt,
    sourceDir,
    files: files.length,
    totals: agg.totals,
    desaWithData: agg.byDesa.size,
    totalDesaDb: report.desas.length,
    desaKosong: report.emptyRows.length,
    kodeTakDikenal: report.unknownKodes.length,
    nonAktifNoKpj: agg.nonAktifNoKpj.length,
    warnings: warnings.length,
    jsonCache: `${(jsonSize / 1024 / 1024).toFixed(2)} MB -> ${path.relative(process.cwd(), OUTPUT_JSON)}`,
    report: reportError ? `GAGAL (file terkunci?) -> ${reportError}` : path.relative(process.cwd(), OUTPUT_REPORT),
  }, null, 2));

  await prisma.$disconnect();
  // Exit eksplisit: hindari loop 'beforeExit' di config prisma (async di beforeExit
  // memicu event berulang -> banjir log "Prisma Client disconnected").
  process.exit(0);
}

main().catch(async (err) => {
  console.error('Generator gagal:', err);
  try { await prisma.$disconnect(); } catch { /* noop */ }
  process.exit(1);
});
