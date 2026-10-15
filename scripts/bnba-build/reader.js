/**
 * reader.js — pembaca workbook BNBA desa.
 *
 * Tantangan utama file BNBA: baris header memakai sel gabung (merge) dua tingkat,
 * dan pada file .ods SheetJS tidak selalu menuliskan sel tertutup (covered cell),
 * sehingga label induk bergeser ke kiri terhadap kolom datanya. Baris header anak
 * dan baris data selalu lurus, jadi posisi label induk direkonstruksi dengan
 * menelusuri label induk berurutan sambil memakai lebar merge sebagai lebar kolom.
 */

const xlsx = require('xlsx');
const { normLabel, SUB_LABELS, resolveField } = require('./mapping');

const MAX_HEADER_SCAN = 25;

function readWorkbook(filePath) {
  return xlsx.readFile(filePath, { raw: true, cellDates: false });
}

function sheetRows(ws) {
  return xlsx.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null, blankrows: true });
}

/** Merge horizontal pada satu baris, dipetakan anchor kolom → lebar. */
function horizontalMerges(ws, rowIndex) {
  const map = new Map();
  for (const m of ws['!merges'] || []) {
    if (m.s.r !== rowIndex) continue;
    if (m.e.c <= m.s.c) continue;
    map.set(m.s.c, m.e.c - m.s.c + 1);
  }
  return map;
}

/**
 * Susun label per kolom untuk satu baris header.
 * Bila baris punya merge horizontal, posisi kolom direkonstruksi dengan menelusuri
 * label tak-kosong secara berurutan; bila tidak, posisi mentah dipakai apa adanya.
 */
function layoutHeaderRow(ws, rows, rowIndex) {
  const raw = rows[rowIndex] || [];
  const merges = horizontalMerges(ws, rowIndex);
  const labels = [];

  if (merges.size === 0) {
    raw.forEach((v, c) => {
      const label = normLabel(v);
      if (label) labels[c] = label;
    });
    return labels;
  }

  let outCol = raw.findIndex((v) => normLabel(v) !== '');
  if (outCol < 0) return labels;

  for (let i = 0; i < raw.length; i += 1) {
    const label = normLabel(raw[i]);
    if (!label) continue; // sel tertutup merge — tidak menggeser kolom
    const width = merges.get(i) || 1;
    for (let k = 0; k < width; k += 1) labels[outCol + k] = label;
    outCol += width;
  }
  return labels;
}

function looksLikeSubHeader(rows, rowIndex) {
  const raw = rows[rowIndex] || [];
  const filled = raw.map(normLabel).filter(Boolean);
  if (filled.length === 0) return false;
  const hits = filled.filter((v) => SUB_LABELS.has(v)).length;
  return hits >= 2;
}

/**
 * Label satu baris header dengan sel gabung dilebarkan ke seluruh rentangnya.
 * Hanya untuk .xlsx (merge tercatat lengkap); tidak dipakai untuk rekonstruksi ODS.
 */
function spanHeaderRow(ws, rows, rowIndex) {
  const labels = [];
  (rows[rowIndex] || []).forEach((v, c) => {
    const label = normLabel(v);
    if (label) labels[c] = label;
  });
  for (const m of ws['!merges'] || []) {
    if (m.s.r > rowIndex || m.e.r < rowIndex) continue;
    const label = normLabel((rows[m.s.r] || [])[m.s.c]);
    if (!label) continue;
    for (let c = m.s.c; c <= m.e.c; c += 1) labels[c] = label;
  }
  return labels;
}

/**
 * Format "Desk LKD": kepala tiga tingkat
 *   NO | IDENTITAS | DASAR PEMBENTUKAN LEMBAGA | DASAR PENETAPAN | WILAYAH | JABATAN | ...
 *        NAMA LENGKAP, NO KTP, ..., JK, STTS | (PERATURAN KEPALA DESA) | ... | ALAMAT, DESA, KECAMATAN
 *                                    L, P       PEJABAT, NOMOR, TANGGAL         (JABATAN → RW, RT)
 * Kolom dikenali dari pasangan label induk/anak/cucu, jadi posisi kolom antar
 * sheet boleh bergeser (sheet Kader/KATAR punya kolom tanggal lahir lebih lebar).
 */
function resolveDeskHeader(ws, rows) {
  const headerRow = rows.findIndex((row, i) => i < MAX_HEADER_SCAN && (row || []).map(normLabel).includes('IDENTITAS'));
  if (headerRow < 0) return null;
  const subRaw = (rows[headerRow + 1] || []).map(normLabel);
  if (!subRaw.includes('NAMA LENGKAP')) return null;

  const top = spanHeaderRow(ws, rows, headerRow);
  const sub = spanHeaderRow(ws, rows, headerRow + 1);
  const leaf = spanHeaderRow(ws, rows, headerRow + 2);
  const isPosyandu = top.some((l) => l && l.startsWith('NAMA KETUA POSYANDU'));

  const fields = {};
  const jkCols = [];
  const width = Math.max(top.length, sub.length, leaf.length);
  const labels = [];
  const set = (field, c) => { if (fields[field] === undefined) fields[field] = c; };

  for (let c = 0; c < width; c += 1) {
    const t = top[c] || '';
    const s = sub[c] || '';
    const l = leaf[c] || '';
    labels[c] = { top: t, sub: s };
    if (t === 'IDENTITAS') {
      if (s === 'NAMA LENGKAP') set(isPosyandu ? 'nama_posyandu' : 'nama_lengkap', c);
      else if (/^(NO\.? ?KTP|NIK)$/.test(s)) set('nik', c);
      else if (s === 'TEMPAT LAHIR') set('tempat_lahir', c);
      else if (/^TGL\.? ?LAHIR$/.test(s)) set('tanggal_lahir', c);
      else if (s === 'JK' && (l === 'L' || l === 'P')) jkCols.push(c);
      else if (s.startsWith('STTS') || s.startsWith('STATUS')) set('status_perkawinan', c);
    } else if (t.startsWith('DASAR PEMBENTUKAN')) {
      if (l === 'NOMOR') set('_nomor_perkades', c);
      else if (l === 'TANGGAL') set('_tanggal_perkades', c);
    } else if (t.startsWith('DASAR PENETAPAN')) {
      if (l === 'NOMOR') set('_nomor_sk', c);
      else if (l === 'TANGGAL') set('_tanggal_sk', c);
    } else if (t === 'WILAYAH') {
      if (s === 'ALAMAT') set(isPosyandu ? '_posyandu_jalan' : 'alamat_rumah', c);
      else if (s === 'DESA') set(isPosyandu ? '_posyandu_desa' : 'desa_alamat', c);
      else if (s === 'KECAMATAN') set(isPosyandu ? '_posyandu_kecamatan' : 'kecamatan_alamat', c);
    } else if (t === 'JABATAN') {
      if (l === 'RW') set('_wilayah_rw', c);
      else if (l === 'RT') set('_wilayah_rt', c);
      else set('jabatan', c);
    } else if (/^NO\.? ?NIK$/.test(t)) set('nik', c);
    else if (/^NO\.? ?(TELP|HP)/.test(t)) set('no_telepon', c);
    else if (t.startsWith('PENDIDIKAN')) set('pendidikan', c);
    else if (t.startsWith('NAMA KETUA POSYANDU')) set('_nama_ketua', c);
    else if (t.startsWith('BANK')) set('nama_bank', c);
    else if (t.startsWith('NOMOR REKENING')) set('nomor_rekening', c);
    else if (t.startsWith('NAMA REKENING')) set('nama_rekening', c);
  }

  // Baris data pertama: baris bernomor setelah tiga baris kepala.
  let dataStart = rows.findIndex((row, i) => i > headerRow + 2 && /^\d+$/.test(String(row?.[0] ?? '').trim()));
  if (dataStart < 0) dataStart = headerRow + 3;

  return {
    format: 'desk',
    headerRow,
    subRow: headerRow + 1,
    dataStart,
    fields,
    tanggalLahirParts: [],
    // JK ditulis sebagai tanda di salah satu kolom L atau P.
    firstFilled: jkCols.length ? { jenis_kelamin: jkCols } : {},
    labels,
  };
}

/**
 * Cari baris header dan bangun peta kolom → field.
 * @returns {{headerRow:number, subRow:number|null, dataStart:number, fields:Object<string,number>, labels:Array}|null}
 */
function resolveHeader(ws, rows) {
  const desk = resolveDeskHeader(ws, rows);
  if (desk) return desk;

  // Format rekap lama memakai lima baris kepala bertingkat. Posisi data tetap
  // konsisten, tetapi pasangan label induk/anaknya tidak cukup untuk resolver
  // BNBA biasa.
  const rekapHeaderRow = rows.findIndex((row) => {
    const labels = (row || []).map(normLabel);
    return labels.includes('IDENTITAS') && labels.includes('JABATAN');
  });
  if (rekapHeaderRow >= 0) {
    const dataStart = rows.findIndex((row, i) => i > rekapHeaderRow && /^\d+$/.test(String(row?.[0] ?? '')) && normLabel(row?.[1]));
    // RT/RW menyisipkan tiga kolom setelah tanggal lahir: jenis, nomor RW,
    // nomor RT. Format rekap lembaga lain tidak memiliki ketiganya.
    const firstData = rows[dataStart >= 0 ? dataStart : rekapHeaderRow + 1] || [];
    const isRtRw = /^(RT|RW)$/.test(normLabel(firstData[5]));
    const isKaderPosyandu = (rows[rekapHeaderRow] || []).map(normLabel).includes('POSYANDU');
    const offset = isRtRw ? 3 : 0;
    return {
      headerRow: rekapHeaderRow,
      subRow: null,
      dataStart: dataStart >= 0 ? dataStart : rekapHeaderRow + 1,
      fields: {
        nama_lengkap: 1, nik: 2, tempat_lahir: 3,
        tanggal_lahir: 4, jenis_kelamin: 5 + offset, status_perkawinan: 6 + offset,
        _nomor_perkades: 8 + offset, _nomor_sk: 11 + offset, tanggal_akhir_jabatan: 12 + offset,
        alamat_rumah: 13 + offset, desa_alamat: 14 + offset, kecamatan_alamat: 15 + offset,
        jabatan: 16 + offset,
        no_telepon: 17 + offset + (isKaderPosyandu ? 1 : 0),
        pendidikan: 18 + offset + (isKaderPosyandu ? 1 : 0),
        ...(isRtRw ? { _wilayah_rw: 6, _wilayah_rt: 7 } : {}),
        ...(isKaderPosyandu ? { nama_posyandu: 17 } : {}),
      },
      tanggalLahirParts: [],
      labels: [],
    };
  }

  let headerRow = -1;
  for (let i = 0; i < Math.min(rows.length, MAX_HEADER_SCAN); i += 1) {
    const labels = (rows[i] || []).map(normLabel);
    const hasNo = labels.some((v) => v === 'NO' || v === 'NO.' || v === 'NOMOR');
    const hasNama = labels.some((v) => v.startsWith('NAMA'));
    if (hasNo && hasNama) { headerRow = i; break; }
  }
  if (headerRow < 0) return null;

  const top = layoutHeaderRow(ws, rows, headerRow);
  const hasSub = looksLikeSubHeader(rows, headerRow + 1);
  // Baris sub-header selalu sebaris dengan data; hanya induknya yang perlu
  // direkonstruksi untuk file ODS dengan sel merge tertutup.
  const sub = hasSub ? (rows[headerRow + 1] || []).map(normLabel) : [];

  const width = Math.max(top.length, sub.length);
  const fields = {};
  const tanggalLahirParts = [];
  const labels = [];
  for (let c = 0; c < width; c += 1) {
    const topLabel = top[c] || '';
    const subLabel = sub[c] || '';
    labels[c] = { top: topLabel, sub: subLabel };
    const field = resolveField(topLabel, subLabel);
    if (!field) continue;
    if (field === 'tanggal_lahir') tanggalLahirParts.push(c);
    // Kolom pertama yang cocok yang menang — kolom duplikat di kanan diabaikan.
    if (fields[field] === undefined) fields[field] = c;
  }

  return {
    headerRow,
    subRow: hasSub ? headerRow + 1 : null,
    dataStart: hasSub ? headerRow + 2 : headerRow + 1,
    fields,
    tanggalLahirParts,
    labels,
  };
}

/** Ambil baris data sebagai objek {field: nilai} beserta nomor baris Excel-nya. */
function extractRows(rows, header) {
  const out = [];
  const entries = Object.entries(header.fields);
  for (let i = header.dataStart; i < rows.length; i += 1) {
    const raw = rows[i] || [];
    if (!raw.some((v) => v !== null && v !== undefined && v !== '')) continue;
    const obj = { __row: i + 1, __raw: raw };
    for (const [field, col] of entries) obj[field] = raw[col];
    for (const [field, cols] of Object.entries(header.firstFilled || {})) {
      const hit = cols.map((c) => raw[c]).find((v) => v !== null && v !== undefined && String(v).trim() !== '');
      if (hit !== undefined) obj[field] = hit;
    }
    const tanggalParts = (header.tanggalLahirParts || []).map((c) => raw[c]);
    if (tanggalParts.length > 1 && tanggalParts.every((v) => v !== null && v !== undefined && v !== '')) {
      obj.tanggal_lahir = tanggalParts.join('/');
    }
    out.push(obj);
  }
  return out;
}

/**
 * Deteksi nama desa & kecamatan dari kepala sheet.
 * Mendukung dua pola: label "Desa/Kelurahan" + nilai di kanannya, atau judul
 * "NOMINATIF ... DESA X" / "KECAMATAN Y".
 */
function detectWilayah(rows) {
  const result = { desa: '', kecamatan: '' };

  const valueRightOf = (rowIdx, colIdx) => {
    const raw = rows[rowIdx] || [];
    for (let c = colIdx + 1; c < colIdx + 6 && c < raw.length; c += 1) {
      const v = normLabel(raw[c]);
      if (v) return v;
    }
    return '';
  };

  for (let i = 0; i < Math.min(rows.length, MAX_HEADER_SCAN); i += 1) {
    const raw = rows[i] || [];
    for (let c = 0; c < raw.length; c += 1) {
      const label = normLabel(raw[c]);
      if (!label) continue;
      if (!result.desa && /^DESA\s*\/\s*KELURAHAN$/.test(label)) result.desa = valueRightOf(i, c);
      if (!result.kecamatan && /^KECAMATAN$/.test(label) && c < raw.length - 1) {
        const v = valueRightOf(i, c);
        if (v) result.kecamatan = v;
      }
    }
  }

  for (let i = 0; i < Math.min(rows.length, 6); i += 1) {
    const first = normLabel((rows[i] || [])[0]);
    if (!first) continue;
    if (!result.desa) {
      const m = first.match(/^NOMINATIF\s+LEMBAGA\s+KEMASYARAKATAN\s+DESA\s+(.+)$/);
      if (m && m[1].trim()) result.desa = m[1].trim();
    }
    if (!result.kecamatan) {
      const m = first.match(/^KECAMATAN\s+(.+)$/);
      if (m && m[1].trim()) result.kecamatan = m[1].trim();
    }
  }

  return result;
}

module.exports = {
  readWorkbook,
  sheetRows,
  resolveHeader,
  extractRows,
  detectWilayah,
  layoutHeaderRow,
};
