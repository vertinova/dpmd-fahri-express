const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');

const DATA_DIR = path.join(__dirname, '..', 'data');
const ADD_FILE = path.join(DATA_DIR, 'rtrwadd.xlsx');
const BPJS_FILE = path.join(DATA_DIR, 'rtrwbpjs.xlsx');
const ADD_JSON_FILE = path.join(DATA_DIR, 'rtrwadd.json');
const BPJS_JSON_FILE = path.join(DATA_DIR, 'rtrwbpjs.json');
const CACHE_VERSION = 1;

const toText = (value) => String(value ?? '').trim();
const toUpper = (value) => toText(value).toUpperCase();

function normalizeNik(value) {
  const digits = String(value ?? '').replace(/\D/g, '');
  return digits.length >= 10 ? digits : '';
}

function normalizeName(value) {
  let name = toUpper(value);
  name = name.normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
  name = name.replace(/[.`'"]/g, ' ');
  name = name.replace(/[()_:/\\-]/g, ' ');
  name = name.replace(/^(H|HJ|HJA|HAJI|HAJAH)\s+/g, '');
  name = name.replace(/\s+/g, ' ').trim();
  return name;
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
  if (dmy) {
    return `${dmy[3]}-${dmy[2].padStart(2, '0')}-${dmy[1].padStart(2, '0')}`;
  }

  const ymd = text.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  if (ymd) {
    return `${ymd[1]}-${ymd[2].padStart(2, '0')}-${ymd[3].padStart(2, '0')}`;
  }

  return text;
}

function normalizeAddDesaKode(value) {
  const raw = toText(value).replace(/\.+$/g, '');
  if (/^\d{2}\.\d{4}$/.test(raw)) return `32.01.${raw}`;
  if (/^32\.01\.\d{2}\.\d{4}$/.test(raw)) return raw;
  return raw;
}

function extractRtRwInfo(keterangan) {
  const text = toUpper(keterangan).replace(/\s+/g, ' ');
  const slash = text.match(/\bRT\.?\s*0*(\d{1,3})\s*\/\s*0*(\d{1,3})\b/);
  const rtMatch = slash || text.match(/\bRT\.?\s*0*(\d{1,3})\b/);
  const rwMatch = slash
    ? [, slash[2]]
    : text.match(/\bRW\.?\s*0*(\d{1,3})\b/);

  const rtNomor = rtMatch ? padNomor(rtMatch[1]) : null;
  const rwNomor = rwMatch ? padNomor(rwMatch[1]) : null;
  let jenis = null;

  if (rtNomor) jenis = 'RT';
  else if (rwNomor) jenis = 'RW';
  else if (/\bRT\s*\/\s*RW\b|\bRT\s+RW\b|\bRTRW\b/.test(text)) jenis = 'RT/RW';
  else if (/\bKETUA\s+RW\b|\bINSENTIF\s+RW\b/.test(text)) jenis = 'RW';
  else if (/\bKETUA\s+RT\b|\bINSENTIF\s+RT\b/.test(text)) jenis = 'RT';

  return { jenis, rtNomor, rwNomor };
}

function fileMeta(filePath) {
  const stat = fs.statSync(filePath);
  return {
    name: path.basename(filePath),
    size: stat.size,
    mtimeMs: stat.mtimeMs,
  };
}

function parseAddData() {
  const workbook = XLSX.readFile(ADD_FILE);
  const sheetName = workbook.Sheets.Sheet2 ? 'Sheet2' : workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });
  const grouped = new Map();
  let filteredRows = 0;

  rows.forEach((row) => {
    const sumberDana = toUpper(row.Sumberdana);
    const kdKeg = toText(row.Kd_Keg);

    if (sumberDana !== 'ADD' || !kdKeg.includes('.01.01.07.')) return;

    const nama = normalizeName(row.Nm_Penerima);
    const desaKode = normalizeAddDesaKode(row.Kd_Desa);
    if (!nama || !desaKode) return;

    filteredRows += 1;
    const info = extractRtRwInfo(row.Keterangan);
    const nilai = numberValue(row[' Nilai '] ?? row[' Nilai'] ?? row.Nilai);
    const key = [
      desaKode,
      nama,
      info.jenis || '',
      info.rwNomor || '',
      info.rtNomor || '',
    ].join('|');

    const detail = {
      tahun: toText(row.Tahun),
      kdDesa: toText(row.Kd_Desa),
      nmDesa: toText(row.Nm_Desa),
      noSpp: toText(row.No_SPP),
      noBukti: toText(row.No_Bukti),
      tglBukti: dateToStr(row.Tgl_Bukti),
      kdKeg: toText(row.Kd_Keg),
      kdRincian: toText(row.Kd_Rincian),
      sumberDana,
      rekBank: toText(row.Rek_Bank),
      nmBank: toText(row.Nm_Bank),
      keterangan: toText(row.Keterangan),
      nilai,
      idDn: toText(row.Id_DN),
      linkBukti: toText(row.link_bukti),
    };

    if (!grouped.has(key)) {
      grouped.set(key, {
        source: 'add',
        nama,
        normalized: nama,
        desaKode,
        desaNamaExcel: toText(row.Nm_Desa),
        jenis: info.jenis,
        rwNomor: info.rwNomor,
        rtNomor: info.rtNomor,
        totalNilai: 0,
        details: [],
      });
    }

    const item = grouped.get(key);
    item.totalNilai += nilai;
    item.details.push(detail);
  });

  return {
    sheetName,
    data: Array.from(grouped.values()),
    meta: {
      totalRows: rows.length,
      filteredRows,
      totalPenerima: grouped.size,
      totalDesa: new Set(Array.from(grouped.values()).map((item) => item.desaKode)).size,
    },
  };
}

function parseBpjsData() {
  const workbook = XLSX.readFile(BPJS_FILE);
  const sheetName = workbook.Sheets.DATABASE ? 'DATABASE' : workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });
  const grouped = new Map();

  rows.forEach((row) => {
    const desaKode = toText(row.ID_PEGAWAI || row.ID_Pegawai || row['ID Pegawai']);
    const nama = normalizeName(row.NAMA_LENGKAP);
    if (!desaKode || !nama) return;

    const nik = normalizeNik(row.NIK);
    const key = `${desaKode}|${nik || nama}`;
    const detail = {
      nik,
      idPegawai: desaKode,
      kpj: toText(row.KPJ),
      kodeTk: toText(row.KODE_TK),
      namaLengkap: nama,
      tglLahir: dateToStr(row.TGL_LAHIR),
      upah: numberValue(row.UPAH),
      rapel: numberValue(row.RAPEL),
      blth: dateToStr(row.BLTH),
      npp: toText(row.NPP),
    };

    if (!grouped.has(key)) {
      grouped.set(key, {
        source: 'bpjs',
        nama,
        normalized: nama,
        nik,
        desaKode,
        totalUpah: 0,
        details: [],
      });
    }

    const item = grouped.get(key);
    item.totalUpah += detail.upah;
    item.details.push(detail);
  });

  return {
    sheetName,
    data: Array.from(grouped.values()),
    meta: {
      totalRows: rows.length,
      totalPenerima: grouped.size,
      totalDesa: new Set(Array.from(grouped.values()).map((item) => item.desaKode)).size,
    },
  };
}

function writeCache(targetFile, sourceFile, parsed) {
  const payload = {
    version: CACHE_VERSION,
    generatedAt: new Date().toISOString(),
    source: fileMeta(sourceFile),
    sheetName: parsed.sheetName,
    meta: parsed.meta,
    data: parsed.data,
  };

  fs.writeFileSync(targetFile, JSON.stringify(payload));
  return fileMeta(targetFile);
}

function formatBytes(value) {
  return `${(value / 1024 / 1024).toFixed(2)} MB`;
}

function main() {
  const startedAt = Date.now();
  const add = parseAddData();
  const addMeta = writeCache(ADD_JSON_FILE, ADD_FILE, add);

  const bpjs = parseBpjsData();
  const bpjsMeta = writeCache(BPJS_JSON_FILE, BPJS_FILE, bpjs);

  console.log(JSON.stringify({
    ms: Date.now() - startedAt,
    add: {
      target: path.relative(process.cwd(), ADD_JSON_FILE),
      size: formatBytes(addMeta.size),
      ...add.meta,
    },
    bpjs: {
      target: path.relative(process.cwd(), BPJS_JSON_FILE),
      size: formatBytes(bpjsMeta.size),
      ...bpjs.meta,
    },
  }, null, 2));
}

main();
