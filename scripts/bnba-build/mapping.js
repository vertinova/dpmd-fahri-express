/**
 * mapping.js — kamus kolom, kosakata baku, dan normalizer untuk konversi
 * workbook BNBA desa → output template import pengurus kelembagaan.
 *
 * Skema kolom output HARUS sinkron dengan pembaca template di:
 *   - src/controllers/kelembagaan/pengurus.controller.js (importPengurus)
 *   - scripts/import-output-template.js
 * Kolom berawalan "_" adalah kolom jejak (provenance) — importer mengabaikannya.
 */

// ---------------------------------------------------------------------------
// Skema template output
// ---------------------------------------------------------------------------

const PENGURUS_COLUMNS = [
  'nama_lengkap',
  'jabatan',
  'nik',
  'tempat_lahir',
  'tanggal_lahir',
  'jenis_kelamin',
  'status_perkawinan',
  'pendidikan',
  'agama',
  'golongan_darah',
  'nomor_buku_nikah',
  'alamat_rumah',
  'rt_rumah',
  'rw_rumah',
  'desa_alamat',
  'kecamatan_alamat',
  'kode_pos',
  'no_telepon',
  'nama_bank',
  'nomor_rekening',
  'nama_rekening',
  'tanggal_mulai_jabatan',
  'tanggal_akhir_jabatan',
  'status_jabatan',
  'status_verifikasi_pengurus',
  'produk_hukum_id_pengurus',
];

const PROVENANCE_COLUMNS = [
  '_sumber_file',
  '_sumber_sheet',
  '_sumber_baris',
  '_nomor_perkades',
  '_nomor_sk',
  '_jabatan_asli',
  '_bank_operasional',
  '_rekening_operasional',
  '_catatan',
];

const TEMPLATE_SHEETS = [
  { name: '01_RTRW', lembaga: ['jenis_wilayah', 'nomor_rw', 'nomor_rt'] },
  { name: '02_POSYANDU', lembaga: ['nama_posyandu', 'alamat_posyandu'] },
  { name: '03_LPM', lembaga: ['nama_lembaga', 'alamat_sekretariat'] },
  { name: '04_KARANG_TARUNA', lembaga: ['nama_lembaga', 'alamat_sekretariat'] },
  { name: '05_PKK', lembaga: ['nama_lembaga', 'alamat_sekretariat'] },
  { name: '06_LINMAS', lembaga: ['nama_lembaga', 'alamat_sekretariat'] },
  { name: '07_LEMBAGA_LAINNYA', lembaga: ['nama_lembaga', 'alamat_sekretariat'] },
];

function columnsForSheet(sheetName) {
  const def = TEMPLATE_SHEETS.find((s) => s.name === sheetName);
  if (!def) throw new Error(`Sheet template tidak dikenal: ${sheetName}`);
  return ['kode_desa', ...def.lembaga, ...PENGURUS_COLUMNS, ...PROVENANCE_COLUMNS];
}

// Prefix nama lembaga — disalin persis dari importer supaya nama lembaga yang
// kita tulis identik dengan yang akan dibuat importer bila kolom dikosongkan.
const LEMBAGA_PREFIX = {
  '03_LPM': 'LPM DESA',
  '04_KARANG_TARUNA': 'KARANG TARUNA DESA',
  '05_PKK': 'PKK DESA',
  '06_LINMAS': 'SATLINMAS DESA',
};

// ---------------------------------------------------------------------------
// Klasifikasi sheet sumber
// ---------------------------------------------------------------------------

/** Kategori internal → sheet template tujuan (null = bukan sumber pengurus). */
const CATEGORY_TARGET = {
  RTRW: '01_RTRW',
  POSYANDU: '02_POSYANDU',
  KADER_POSYANDU: '02_POSYANDU',
  LPM: '03_LPM',
  KARANG_TARUNA: '04_KARANG_TARUNA',
  PKK: '05_PKK',
  LINMAS: '06_LINMAS',
  LINMAS_EXTRA: null,
  LAINNYA: '07_LEMBAGA_LAINNYA',
};

function classifySheet(sheetName, context = '') {
  const key = String(sheetName || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const contextKey = String(context || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (/^(KADERPOSYANDU|KADER)$/.test(key)) return 'KADER_POSYANDU';
  if (/^POSYANDU/.test(key)) return 'POSYANDU';
  if (/^(RTRW|RWRT|RT|RW)$/.test(key) || /DATANAMARTRW/.test(contextKey)) return 'RTRW';
  if (/^LPM/.test(key)) return 'LPM';
  if (/^PKK/.test(key)) return 'PKK';
  if (/^(KATAR|KARTAR|KARANGTARUNA)/.test(key)) return 'KARANG_TARUNA';
  if (/^LINMAS(DESA|ANGGOTA|BNBA)/.test(key)) return 'LINMAS_EXTRA';
  if (/^(LINMAS|SATLINMAS|HANSIP)/.test(key)) return 'LINMAS';
  return 'LAINNYA';
}

// ---------------------------------------------------------------------------
// Resolusi header → field
// ---------------------------------------------------------------------------

function normLabel(v) {
  return String(v == null ? '' : v)
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
}

/** Sub-label yang menandai baris header kedua (baris anak dari kolom bergabung). */
const SUB_LABELS = new Set([
  'LAHIR',
  'TGL/BLN/TH',
  'JABATAN',
  'RW',
  'RT',
  'DESA',
  'KECAMATAN',
  'KODE POS',
  'JALAN/GANG DAN NOMOR RUMAH',
]);

/**
 * Petakan pasangan (label induk, label anak) ke nama field internal.
 * Mengembalikan null untuk kolom yang tidak dipakai.
 */
function resolveField(topLabel, subLabel) {
  const top = normLabel(topLabel);
  const sub = normLabel(subLabel);

  if (!top && !sub) return null;

  // Kelompok alamat (induk menentukan konteks, anak menentukan bagian).
  const addressPart = (prefix) => {
    if (sub === 'RT') return `${prefix}_rt`;
    if (sub === 'RW') return `${prefix}_rw`;
    if (sub === 'DESA') return `${prefix}_desa`;
    if (sub === 'KECAMATAN') return `${prefix}_kecamatan`;
    if (sub === 'KODE POS') return `${prefix}_kode_pos`;
    return `${prefix}_jalan`;
  };
  if (top === 'ALAMAT RUMAH') {
    const part = addressPart('rumah');
    return {
      rumah_jalan: 'alamat_rumah',
      rumah_rt: 'rt_rumah',
      rumah_rw: 'rw_rumah',
      rumah_desa: 'desa_alamat',
      rumah_kecamatan: 'kecamatan_alamat',
      rumah_kode_pos: 'kode_pos',
    }[part];
  }
  if (top.startsWith('ALAMAT POSYANDU')) return addressPart('_posyandu');
  if (top.startsWith('ALAMAT SEKRETARIAT')) return 'alamat_sekretariat';
  if (top.startsWith('ALAMAT')) return 'alamat_rumah';

  // Kelompok jabatan RT/RW: anak "RW"/"RT" adalah nomor wilayahnya.
  if (top === 'JABATAN') {
    if (sub === 'RW') return '_wilayah_rw';
    if (sub === 'RT') return '_wilayah_rt';
    return 'jabatan';
  }

  if (top === 'NO' || top === 'NO.' || top === 'NOMOR') return null;
  if (top === 'NAMA' || top === 'NAMA LENGKAP') return 'nama_lengkap';
  if (top === 'NIK' || top === 'NO.NIK' || top === 'NO NIK' || top === 'N I K') return 'nik';
  if (top === 'L/P' || top === 'JENIS KELAMIN' || top === 'L / P') return 'jenis_kelamin';
  if (top === 'TEMPAT' || top === 'TEMPAT LAHIR') return 'tempat_lahir';
  if (top.startsWith('TANGGAL LAHIR') || top === 'TGL LAHIR' || top === 'TGL.LAHIR') return 'tanggal_lahir';
  if (top.includes('PERKADES')) return top.includes('TANGGAL') ? '_tanggal_perkades' : '_nomor_perkades';
  if (top.includes('SK KADES') || top.startsWith('NOMOR SK')) return '_nomor_sk';
  if (top.includes('MASA BHAKTI') || top.includes('MASA BAKTI')) return 'tanggal_akhir_jabatan';
  if (top.includes('PENDIDIKAN')) return 'pendidikan';
  if (top.includes('STATUS KAWIN') || top.includes('STATUS PERKAWINAN')) return 'status_perkawinan';
  if (top === 'NO HP' || top === 'NO. HP' || top === 'NO TLF' || top === 'NO TELEPON' || top === 'NO.HP') return 'no_telepon';
  if (top.includes('NAMA REKENING')) return 'nama_rekening';
  if (top.includes('NOMOR REKENING') || top.includes('NO REKENING')) return 'nomor_rekening';
  if (top.startsWith('REKENING')) return 'nomor_rekening'; // mis. "REKENING BJB"
  if (top.startsWith('BANK')) return 'nama_bank';
  if (top === 'NAMA POSYANDU') return 'nama_posyandu';
  if (top === 'POSYANDU') return 'nama_posyandu';
  if (top.includes('NAMA KETUA')) return '_nama_ketua';
  if (top.includes('STATUS BANGUNAN')) return '_status_bangunan';
  if (top.startsWith('TINGKAT')) return '_tingkat';
  if (top === 'AGAMA') return 'agama';
  if (top.includes('GOLONGAN DARAH') || top === 'GOL DARAH' || top === 'GOL. DARAH') return 'golongan_darah';
  if (top.includes('BUKU NIKAH')) return 'nomor_buku_nikah';

  return null;
}

// ---------------------------------------------------------------------------
// Normalizer nilai
// ---------------------------------------------------------------------------

const EXCEL_EPOCH_UTC = Date.UTC(1899, 11, 30);

const BULAN = {
  JANUARI: 1, JAN: 1, JNUARI: 1, JANUARY: 1,
  FEBRUARI: 2, FEB: 2, PEBRUARI: 2, FEBRUARY: 2,
  MARET: 3, MAR: 3, MARCH: 3,
  APRIL: 4, APR: 4,
  MEI: 5, MAY: 5,
  JUNI: 6, JUN: 6, JUNE: 6,
  JULI: 7, JUL: 7, JULY: 7,
  AGUSTUS: 8, AGT: 8, AGS: 8, AUG: 8, AGUSTUSS: 8,
  SEPTEMBER: 9, SEP: 9, SEPT: 9,
  OKTOBER: 10, OKT: 10, OCT: 10, OCTOBER: 10,
  NOVEMBER: 11, NOV: 11, NOP: 11, NOPEMBER: 11,
  DESEMBER: 12, DES: 12, DEC: 12, DECEMBER: 12,
};

function text(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) return '';
    return Number.isInteger(v) ? String(v) : String(v);
  }
  return String(v).replace(/^['`]+/, '').replace(/\s+/g, ' ').trim();
}

function upper(v) {
  return text(v).toUpperCase();
}

function digitsOnly(v) {
  return text(v).replace(/\D+/g, '');
}

function pad3(v) {
  const d = digitsOnly(v);
  if (!d) return '';
  return d.padStart(3, '0').slice(-3);
}

function iso(y, m, d) {
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (Number.isNaN(dt.getTime())) return null;
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1) return null;
  return dt.toISOString().slice(0, 10);
}

function lastDayOfMonth(y, m) {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

function plausibleYear(y) {
  return Number.isInteger(y) && y >= 1900 && y <= 2100;
}

/**
 * Parse tanggal dari sel BNBA yang isinya sangat bervariasi.
 * @param {*} v nilai sel
 * @param {{allowYearOnly?: boolean}} opts allowYearOnly untuk kolom masa bhakti
 * @returns {{value: string|null, note: string|null}} value dalam format YYYY-MM-DD
 */
function parseTanggal(v, opts = {}) {
  const allowYearOnly = Boolean(opts.allowYearOnly);
  if (v === null || v === undefined || v === '') return { value: null, note: null };

  if (v instanceof Date && !Number.isNaN(v.getTime())) {
    return { value: v.toISOString().slice(0, 10), note: null };
  }

  if (typeof v === 'number' && Number.isFinite(v)) {
    if (plausibleYear(v) && v < 3000) {
      // Angka 4 digit di kolom masa bhakti = tahun, bukan serial Excel.
      if (!allowYearOnly) return { value: null, note: `tanggal '${v}' hanya tahun` };
      return { value: iso(v, 12, 31), note: `masa bhakti hanya tahun ${v}` };
    }
    if (v < 3000) return { value: null, note: `tanggal '${v}' tidak valid` };
    const dt = new Date(EXCEL_EPOCH_UTC + Math.floor(v) * 86400000);
    if (Number.isNaN(dt.getTime())) return { value: null, note: `tanggal '${v}' tidak valid` };
    return { value: dt.toISOString().slice(0, 10), note: null };
  }

  const s = text(v).toUpperCase();
  if (!s) return { value: null, note: null };

  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) {
    const out = iso(Number(m[1]), Number(m[2]), Number(m[3]));
    return out ? { value: out, note: null } : { value: null, note: `tanggal '${s}' tidak valid` };
  }

  m = s.match(/^(\d{1,2})\s*[-/.]\s*(\d{1,2})\s*[-/.]\s*(\d{2,4})$/);
  if (m) {
    let y = Number(m[3]);
    if (y < 100) y += y > 30 ? 1900 : 2000;
    const out = iso(y, Number(m[2]), Number(m[1]));
    return out ? { value: out, note: null } : { value: null, note: `tanggal '${s}' tidak valid` };
  }

  m = s.match(/^(\d{1,2})\s+([A-Z]+)\s+(\d{4})$/);
  if (m && BULAN[m[2]]) {
    const out = iso(Number(m[3]), BULAN[m[2]], Number(m[1]));
    return out ? { value: out, note: null } : { value: null, note: `tanggal '${s}' tidak valid` };
  }

  if (!allowYearOnly) return { value: null, note: `tanggal '${s}' tidak dikenali` };

  // Kolom masa bhakti: "TH.2030", "AGUSTUS 2030", "OKT 2029", "TH 2025".
  m = s.match(/^([A-Z]+)\.?\s*(\d{4})$/);
  if (m && BULAN[m[1]]) {
    const y = Number(m[2]);
    const mo = BULAN[m[1]];
    if (plausibleYear(y)) return { value: iso(y, mo, lastDayOfMonth(y, mo)), note: null };
  }

  const years = s.match(/\b(19|20)\d{2}\b/g);
  if (years && years.length === 1) {
    const y = Number(years[0]);
    if (plausibleYear(y)) return { value: iso(y, 12, 31), note: `masa bhakti '${s}' dibaca sebagai akhir ${y}` };
  }

  return { value: null, note: `masa bhakti '${s}' tidak dikenali` };
}

function parseNik(v) {
  const raw = text(v);
  if (!raw) return { value: null, note: null };
  const d = raw.replace(/\D+/g, '');
  if (!d) return { value: null, note: `NIK '${raw}' tidak berisi angka` };
  if (typeof v === 'number' && v > Number.MAX_SAFE_INTEGER) {
    return { value: d, note: `NIK '${d}' dibaca sebagai angka besar, cek ketelitian digit` };
  }
  if (d.length !== 16) return { value: d, note: `NIK '${d}' bukan 16 digit` };
  // Nomor urut NIK tidak pernah 0000; pola ini muncul bila sel angka Excel
  // memotong digit belakang.
  if (typeof v === 'number' && d.endsWith('0000')) {
    return { value: d, note: `NIK '${d}' berakhiran 0000 (sel angka), kemungkinan digit belakang hilang — cek KTP` };
  }
  return { value: d, note: null };
}

/**
 * Bandingkan tanggal lahir hasil parse dengan tanggal lahir yang tersandi di NIK
 * (digit 7-12 = DDMMYY, hari +40 untuk perempuan). Hanya menghasilkan catatan.
 */
function cekTanggalLahirVsNik(tanggalIso, nik) {
  if (!tanggalIso || !nik || nik.length !== 16) return null;
  let dd = Number(nik.slice(6, 8));
  const mm = Number(nik.slice(8, 10));
  const yy = Number(nik.slice(10, 12));
  if (dd > 40) dd -= 40;
  if (!dd || dd > 31 || !mm || mm > 12) return null;
  const [y, m, d] = tanggalIso.split('-').map(Number);
  if (m === mm && d === dd && y % 100 === yy) return null;
  const nikYear = yy > (new Date().getFullYear() % 100) ? 1900 + yy : 2000 + yy;
  const nikDate = `${String(dd).padStart(2, '0')}-${String(mm).padStart(2, '0')}-${nikYear}`;
  const tertukar = m === dd && d === mm && y % 100 === yy;
  return tertukar
    ? `tanggal lahir ${tanggalIso} kemungkinan tertukar hari/bulan — NIK menunjuk ${nikDate}`
    : `tanggal lahir ${tanggalIso} tidak cocok dengan NIK (NIK menunjuk ${nikDate})`;
}

function parseTelepon(v) {
  const raw = text(v);
  if (!raw) return null;
  let d = raw.replace(/[^\d+]/g, '');
  if (!d) return null;
  if (d.startsWith('+62')) d = `0${d.slice(3)}`;
  else if (d.startsWith('62') && d.length > 10) d = `0${d.slice(2)}`;
  else if (d.startsWith('8')) d = `0${d}`;
  return d;
}

function parseJenisKelamin(v) {
  const s = upper(v);
  if (!s) return '';
  if (s.startsWith('L')) return 'L';
  if (s.startsWith('P') || s.startsWith('W')) return 'P';
  return '';
}

const PENDIDIKAN_MAP = new Map(Object.entries({
  'TIDAK SEKOLAH': '',
  'BELUM SEKOLAH': '',
  BERIJAZAH: '',
  SD: 'SD', MI: 'SD', SDN: 'SD', 'SD/MI': 'SD', 'PAKET A': 'SD', 'SD SEDERAJAT': 'SD',
  SMP: 'SMP', SLTP: 'SMP', MTS: 'SMP', 'MTS/SMP': 'SMP', 'SMP/MTS': 'SMP', 'PAKET B': 'SMP',
  'SLTP/SEDERAJAT': 'SMP', 'SMP SEDERAJAT': 'SMP',
  SMA: 'SMA/SMK', SMK: 'SMA/SMK', SLTA: 'SMA/SMK', MA: 'SMA/SMK', MAN: 'SMA/SMK',
  ALIYAH: 'SMA/SMK', STM: 'SMA/SMK', SMEA: 'SMA/SMK', 'PAKET C': 'SMA/SMK',
  'SMA/SMK': 'SMA/SMK', 'SLTA/SEDERAJAT': 'SMA/SMK', 'SMA SEDERAJAT': 'SMA/SMK',
  'SLTA SEDERAJAT': 'SMA/SMK',
  D1: 'D1', D2: 'D2', D3: 'D3', DIII: 'D3', 'D-III': 'D3', DIPLOMA: 'D3', D4: 'S1',
  S1: 'S1', SI: 'S1', 'S-1': 'S1', 'S.PD': 'S1', 'S.AG': 'S1', 'S.SOS': 'S1', 'S.E': 'S1',
  SARJANA: 'S1',
  S2: 'S2', 'S-2': 'S2', MAGISTER: 'S2',
  S3: 'S3', 'S-3': 'S3', DOKTOR: 'S3',
}));

function parsePendidikan(v) {
  const s = upper(v)
    .replace(/\s*\/\s*/g, '/')
    .replace(/[.]$/, '')
    .replace(/^(TAMAT|TAMATAN|LULUS|LULUSAN)\s+/, '');
  if (!s) return { value: '', note: null };
  if (PENDIDIKAN_MAP.has(s)) {
    const mapped = PENDIDIKAN_MAP.get(s);
    return { value: mapped, note: mapped ? null : `pendidikan '${s}' diabaikan` };
  }
  const compact = s.replace(/\s*\/\s*SEDERAJAT$/, '');
  if (PENDIDIKAN_MAP.has(compact)) return { value: PENDIDIKAN_MAP.get(compact), note: null };
  if (/^S\.?\s?\w/.test(s)) return { value: 'S1', note: `pendidikan '${s}' dibaca sebagai S1` };
  return { value: '', note: `pendidikan '${s}' tidak dikenali` };
}

const KAWIN_MAP = new Map(Object.entries({
  KAWIN: 'MENIKAH',
  MENIKAH: 'MENIKAH',
  'SUDAH KAWIN': 'MENIKAH',
  'SUDAH MENIKAH': 'MENIKAH',
  'BELUM KAWIN': 'BELUM MENIKAH',
  'TIDAK KAWIN': 'BELUM MENIKAH',
  'BELUM MENIKAH': 'BELUM MENIKAH',
  'CERAI HIDUP': 'CERAI HIDUP',
  'CERAI MATI': 'CERAI MATI',
  DUDA: 'CERAI MATI',
  JANDA: 'CERAI MATI',
}));

function parseStatusKawin(v) {
  const s = upper(v);
  if (!s) return { value: '', note: null };
  if (KAWIN_MAP.has(s)) return { value: KAWIN_MAP.get(s), note: null };
  return { value: '', note: `status kawin '${s}' tidak dikenali` };
}

// ---------------------------------------------------------------------------
// Normalisasi jabatan ke kosakata baku aplikasi
// (lihat dpmd-frontend/src/constants/jabatanMapping.js)
// ---------------------------------------------------------------------------

const JABATAN_SUFFIX = {
  '03_LPM': 'LPM',
  '04_KARANG_TARUNA': 'KARANG TARUNA',
  '05_PKK': 'PKK',
  '02_POSYANDU': 'POSYANDU',
};

const ROMAWI = { 1: 'I', 2: 'II', 3: 'III', 4: 'IV' };

/**
 * @param {string} raw jabatan mentah dari BNBA
 * @param {string} targetSheet sheet template tujuan
 * @param {string|null} jenisWilayah 'RW' | 'RT' untuk sheet 01_RTRW
 */
function normalizeJabatan(raw, targetSheet, jenisWilayah) {
  const s = upper(raw).replace(/\s+/g, ' ').trim();

  if (targetSheet === '01_RTRW') {
    const jenis = jenisWilayah || (/\bRT\b/.test(s) ? 'RT' : /\bRW\b/.test(s) ? 'RW' : null);
    if (!jenis) return { value: s, note: s ? `jabatan '${s}' tidak jelas RT/RW` : null };
    const base = s.replace(/\s*R[TW]\s*\d*\s*$/, '').trim() || 'KETUA';
    if (/^KETUA/.test(base)) return { value: `KETUA ${jenis}`, note: null };
    if (/^SEKRETARIS|^SEKERTARIS/.test(base)) return { value: `SEKRETARIS ${jenis}`, note: null };
    if (/^BENDAHARA/.test(base)) return { value: `BENDAHARA ${jenis}`, note: null };
    if (/^SEKSI/.test(base)) return { value: base, note: null };
    return { value: `${base} ${jenis}`, note: `jabatan '${s}' dinormalkan ke '${base} ${jenis}'` };
  }

  if (!s) return { value: '', note: null };

  if (targetSheet === '06_LINMAS') {
    if (/^ANGGOTA/.test(s) || /^(SAT)?LINMAS$/.test(s)) return { value: 'ANGGOTA SATLINMAS', note: null };
    if (/^(KEPALA SATLINMAS|KASATLINMAS)/.test(s)) return { value: 'KEPALA SATLINMAS', note: null };
    if (/^(KEPALA PELAKSANA|KALAK)/.test(s)) return { value: 'KEPALA PELAKSANA', note: null };
    if (/^KOMANDAN REGU/.test(s)) return { value: s, note: null };
    if (/^DANRU/.test(s)) return { value: 'KOMANDAN REGU', note: `jabatan '${s}' dipertahankan sebagai 'KOMANDAN REGU' (regu tidak disebut)` };
    if (/^WADANRU|^WAKIL DANRU/.test(s)) return { value: 'WAKIL KOMANDAN REGU', note: `jabatan '${s}' di luar daftar baku satlinmas` };
    return { value: s, note: `jabatan '${s}' di luar daftar baku satlinmas` };
  }

  const suffix = JABATAN_SUFFIX[targetSheet];

  if (targetSheet === '05_PKK') {
    // "KETUA TP.PKK" / "KETUA TP PKK" / "KETUA TIM PENGGERAK PKK" → "KETUA PKK".
    const tp = s.match(/^(KETUA|WAKIL KETUA|SEKRETARIS|BENDAHARA)\s+(TP\.?\s*|TIM PENGGERAK\s+)PKK$/);
    if (tp) return { value: `${tp[1]} PKK`, note: null };
    const pokja = s.match(/^(KETUA|SEKRETARIS|BENDAHARA|ANGGOTA)\s+POKJA\s*([IV]+|\d)$/);
    if (pokja) {
      const num = /^\d$/.test(pokja[2]) ? ROMAWI[Number(pokja[2])] : pokja[2];
      if (num) return { value: `${pokja[1]} POKJA ${num}`, note: null };
    }
  }

  if (targetSheet === '02_POSYANDU') {
    if (/^KETUA POSYANDU\b/.test(s)) return { value: 'KETUA POSYANDU', note: null };
    if (/^KADER/.test(s) || /^ANGGOTA$/.test(s)) return { value: 'KADER POSYANDU', note: null };
  }

  if (/^KETUA BIDANG/.test(s) || /^SEKSI/.test(s) || /^POKJA/.test(s)) {
    return { value: s, note: null };
  }

  if (suffix) {
    if (/^WAKIL KETUA$/.test(s)) return { value: `WAKIL KETUA ${suffix}`, note: null };
    if (/^WAKIL$/.test(s)) return { value: `WAKIL KETUA ${suffix}`, note: null };
    if (/^KETUA$/.test(s)) return { value: `KETUA ${suffix}`, note: null };
    if (/^(SEKRETARIS|SEKERTARIS)$/.test(s)) return { value: `SEKRETARIS ${suffix}`, note: null };
    if (/^BENDAHARA$/.test(s)) return { value: `BENDAHARA ${suffix}`, note: null };
    if (s === `KETUA ${suffix}` || s === `SEKRETARIS ${suffix}` || s === `BENDAHARA ${suffix}`) {
      return { value: s, note: null };
    }
    if (/^ANGGOTA$/.test(s)) {
      return { value: targetSheet === '04_KARANG_TARUNA' || targetSheet === '03_LPM' ? 'ANGGOTA' : s, note: null };
    }
  }

  return { value: s, note: null };
}

module.exports = {
  PENGURUS_COLUMNS,
  PROVENANCE_COLUMNS,
  TEMPLATE_SHEETS,
  LEMBAGA_PREFIX,
  CATEGORY_TARGET,
  SUB_LABELS,
  columnsForSheet,
  classifySheet,
  normLabel,
  resolveField,
  text,
  upper,
  digitsOnly,
  pad3,
  parseTanggal,
  parseNik,
  cekTanggalLahirVsNik,
  parseTelepon,
  parseJenisKelamin,
  parsePendidikan,
  parseStatusKawin,
  normalizeJabatan,
};
