// Quick test of the Excel parser - no DB connection needed
'use strict';
const XLSX   = require('xlsx');
const path   = require('path');
const fs     = require('fs');

function normalizeNomor(val) {
  const s = String(val ?? '').trim().replace(/^0+/, '') || '0';
  return s === '0' ? null : s;
}
function up(v, f = '-') { return String(v ?? '').trim().toUpperCase() || f; }
function upOrNull(v) { const s = String(v ?? '').trim().toUpperCase(); return s || null; }
function excelToDate(val) {
  if (!val || val === '-' || val === '' || val === 0) return null;
  if (typeof val === 'string') {
    const m = val.trim().match(/^(\d{1,2})[-\/](\d{1,2})[-\/](\d{4})$/);
    if (m) return new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
    return null;
  }
  if (typeof val === 'number' && val > 1000) {
    return new Date(Math.round((val - 25569) * 86400 * 1000));
  }
  return null;
}
function normName(s) { return String(s ?? '').trim().toUpperCase().replace(/\s+/g, ' '); }

function analyzeSheet(rows) {
  const hri = [];
  let dsi = -1;
  for (let i = 0; i < rows.length; i++) {
    const c0 = String(rows[i][0] ?? '').toUpperCase().trim();
    if (c0 === 'NO') {
      hri.push(i);
    } else if (hri.length > 0) {
      const v = rows[i][0];
      if (typeof v === 'number' && v >= 1) { dsi = i; break; }
    }
  }
  if (!hri.length || dsi === -1) return null;
  const mhr = rows[hri[0]];
  const colCount = Math.max(...rows.slice(dsi, dsi + 5).map(r => r.length));
  const mh = [];
  for (let c = 0; c < colCount; c++) {
    const parts = hri.map(ri => String(rows[ri][c] ?? '').trim()).filter(s => s !== '');
    mh.push(parts.join('|').toLowerCase());
  }
  const isFA = String(mhr[1] ?? '').toLowerCase().trim().includes('kecamatan');
  let bk = -1;
  for (let c = mh.length - 1; c >= 0; c--) {
    if (mh[c].includes('bank')) { bk = c; break; }
  }
  return { hri, dsi, mh, isFA, bk };
}

function parseFormatA(row, bk) {
  const jab = String(row[8] ?? '').trim().toUpperCase();
  const r9  = String(row[9]  ?? '').trim();
  const r10 = String(row[10] ?? '').trim();
  let rwN, rtN, kt;
  if (jab.includes('RW') && !jab.includes('RT')) {
    rwN = normalizeNomor(r9 || r10);
    rtN = null;
    kt  = 'rws';
  } else {
    rwN = normalizeNomor(r9);
    rtN = normalizeNomor(r10);
    kt  = rtN ? 'rts' : 'rws';
  }
  const b = bk > 0 ? bk : 22;
  return {
    kecamatanNama: normName(row[1]),
    desaNama     : normName(row[2]),
    nama         : up(row[3]),
    jabatan      : jab,
    rwNomor      : rwN,
    rtNomor      : rtN,
    namaBank     : upOrNull(row[b]),
    masaBhakti   : excelToDate(row[12]),
    kt,
  };
}

function parseFormatB(row, bk) {
  const jab = String(row[6] ?? '').trim().toUpperCase();
  const r7  = String(row[7] ?? '').trim();
  const r8  = String(row[8] ?? '').trim();
  let rwN, rtN, kt;
  if (jab.includes('RW') && !jab.includes('RT')) {
    rwN = normalizeNomor(r7 || r8);
    rtN = null;
    kt  = 'rws';
  } else {
    rwN = normalizeNomor(r7);
    rtN = normalizeNomor(r8);
    kt  = rtN ? 'rts' : 'rws';
  }
  const b = bk > 0 ? bk : 21;
  return {
    kecamatanNama: normName(row[15]),
    desaNama     : normName(row[14]),
    nama         : up(row[1]),
    jabatan      : jab,
    rwNomor      : rwN,
    rtNomor      : rtN,
    namaBank     : upOrNull(row[b]),
    masaBhakti   : excelToDate(row[10]),
    kt,
  };
}

const DATA_DIR = path.join(__dirname, '../data/datartrw');
const files = fs.readdirSync(DATA_DIR).filter(f => f.endsWith('.xlsx'));

for (const f of files) {
  try {
    const wb   = XLSX.readFile(path.join(DATA_DIR, f));
    const ws   = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
    const info = analyzeSheet(rows);
    if (!info) { console.log(f, '→ CANNOT PARSE'); continue; }

    const recs = rows.slice(info.dsi)
      .filter(r => typeof r[0] === 'number' && r[0] >= 1)
      .map(r => info.isFA ? parseFormatA(r, info.bk) : parseFormatB(r, info.bk));
    const valid = recs.filter(r => r && r.nama !== '-' && r.jabatan && r.rwNomor);
    const s = valid[0];

    console.log(
      f.substring(0, 35).padEnd(35),
      '| Fmt:', info.isFA ? 'A' : 'B',
      '| rows:', String(valid.length).padStart(3),
      '| sample:', JSON.stringify({
        nama    : s?.nama,
        jabatan : s?.jabatan,
        rw      : s?.rwNomor,
        rt      : s?.rtNomor,
        desa    : s?.desaNama,
        kec     : s?.kecamatanNama,
        bank    : s?.namaBank,
        akhir   : s?.masaBhakti?.toISOString()?.slice(0, 10),
      })
    );
  } catch (e) {
    console.error(f, '→ ERROR:', e.message);
  }
}
