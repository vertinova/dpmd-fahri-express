/**
 * RT/RW Incentive Comparison Controller
 * Compares RT/RW recipient data from database, rtrwadd.xlsx, and rtrwbpjs.xlsx.
 */

const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');
const { prisma } = require('./base.controller');

const DATA_DIR = path.join(__dirname, '..', '..', '..', 'data');
const ADD_FILE = path.join(DATA_DIR, 'rtrwadd.xlsx');
const BPJS_FILE = path.join(DATA_DIR, 'rtrwbpjs.xlsx');
const RT_RW_TYPES = ['rw', 'rt', 'rws', 'rts'];

let sourceCache = {
  key: null,
  addData: [],
  bpjsData: [],
  addMeta: {},
  bpjsMeta: {},
};

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

function compactName(value) {
  return normalizeName(value).replace(/\s+/g, '');
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

function levenshtein(a, b) {
  const m = a.length;
  const n = b.length;
  const dp = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}

function nameTokens(value) {
  return normalizeName(value)
    .split(' ')
    .filter((token) => token.length > 1 && !['BIN', 'BINTI'].includes(token));
}

function primaryToken(value) {
  return nameTokens(value)[0] || '';
}

function isSimilarName(a, b) {
  const n1 = normalizeName(a);
  const n2 = normalizeName(b);
  if (!n1 || !n2) return false;
  if (n1 === n2) return true;

  const c1 = compactName(n1);
  const c2 = compactName(n2);
  if (c1 === c2) return true;

  const maxLen = Math.max(c1.length, c2.length);
  if (maxLen < 7) return false;

  const first1 = primaryToken(n1);
  const first2 = primaryToken(n2);
  if (first1 && first2 && first1 !== first2 && c1.slice(0, 4) !== c2.slice(0, 4)) {
    return false;
  }

  const distance = levenshtein(c1, c2);
  const similarity = 1 - distance / maxLen;
  if (similarity >= 0.9) return true;

  const t1 = nameTokens(n1);
  const t2 = nameTokens(n2);
  if (t1.length >= 2 && t2.length >= 2) {
    const set2 = new Set(t2);
    const overlap = t1.filter((token) => set2.has(token)).length;
    const ratio = overlap / Math.min(t1.length, t2.length);
    return ratio >= 0.8 && similarity >= 0.74;
  }

  return false;
}

function getSourceCacheKey() {
  const addStat = fs.statSync(ADD_FILE);
  const bpjsStat = fs.statSync(BPJS_FILE);
  return `${addStat.mtimeMs}:${addStat.size}|${bpjsStat.mtimeMs}:${bpjsStat.size}`;
}

function parseAddData() {
  const workbook = XLSX.readFile(ADD_FILE);
  const sheet = workbook.Sheets.Sheet2 || workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });
  const grouped = new Map();
  let filteredRows = 0;

  rows.forEach((row) => {
    const sumberDana = toUpper(row.Sumberdana);
    const kdKeg = toText(row.Kd_Keg);

    // In this workbook the RT/RW incentive rows are under *.01.01.07.*.
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
  const sheet = workbook.Sheets.DATABASE || workbook.Sheets[workbook.SheetNames[0]];
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
    data: Array.from(grouped.values()),
    meta: {
      totalRows: rows.length,
      totalPenerima: grouped.size,
      totalDesa: new Set(Array.from(grouped.values()).map((item) => item.desaKode)).size,
    },
  };
}

function readSourceData() {
  const key = getSourceCacheKey();
  if (sourceCache.key === key) return sourceCache;

  const add = parseAddData();
  const bpjs = parseBpjsData();
  sourceCache = {
    key,
    addData: add.data,
    bpjsData: bpjs.data,
    addMeta: add.meta,
    bpjsMeta: bpjs.meta,
  };

  return sourceCache;
}

function groupBy(items, keyGetter) {
  return items.reduce((acc, item) => {
    const key = keyGetter(item);
    if (!acc[key]) acc[key] = [];
    acc[key].push(item);
    return acc;
  }, {});
}

function statusFromSources(hasDb, hasAdd, hasBpjs) {
  if (hasDb && hasAdd && hasBpjs) return 'all_three';
  if (hasDb && hasAdd) return 'db_add';
  if (hasDb && hasBpjs) return 'db_bpjs';
  if (hasAdd && hasBpjs) return 'add_bpjs';
  if (hasDb) return 'only_db';
  if (hasAdd) return 'only_add';
  return 'only_bpjs';
}

function buildKeterangan(hasDb, hasAdd, hasBpjs) {
  const present = [];
  const missing = [];
  if (hasDb) present.push('Database'); else missing.push('Database');
  if (hasAdd) present.push('ADD'); else missing.push('ADD');
  if (hasBpjs) present.push('BPJS'); else missing.push('BPJS');

  if (missing.length === 0) return 'Ada di Database, ADD, dan BPJS';
  if (present.length === 1) return `Hanya ada di ${present[0]}, tidak ada di ${missing.join(' dan ')}`;
  return `Ada di ${present.join(' dan ')}, tidak ada di ${missing[0]}`;
}

function sourceItems(entry, source) {
  if (source === 'db') return entry.dbItems;
  if (source === 'add') return entry.addItems;
  return entry.bpjsItems;
}

function createMatchIndexes() {
  return {
    nikIndex: new Map(),
    nameIndex: new Map(),
    sourceKeys: {
      db: new Set(),
      add: new Set(),
      bpjs: new Set(),
    },
  };
}

function indexEntry(indexes, key, source, item) {
  indexes.sourceKeys[source].add(key);

  if (item.nik && !indexes.nikIndex.has(item.nik)) {
    indexes.nikIndex.set(item.nik, key);
  }

  if (item.normalized) {
    if (!indexes.nameIndex.has(item.normalized)) {
      indexes.nameIndex.set(item.normalized, []);
    }
    const keys = indexes.nameIndex.get(item.normalized);
    if (!keys.includes(key)) keys.push(key);
  }
}

function hasDifferentSource(entry, source) {
  if (source !== 'db' && entry.dbItems.length > 0) return true;
  if (source !== 'add' && entry.addItems.length > 0) return true;
  if (source !== 'bpjs' && entry.bpjsItems.length > 0) return true;
  return false;
}

function addToCanonMap(canonMap, indexes, source, item, enableFuzzy) {
  const sourceKey = source === 'bpjs' ? 'bpjsItems' : `${source}Items`;

  const findByNik = () => {
    if (!item.nik) return null;
    return indexes.nikIndex.get(item.nik) || null;
  };

  const findByExactName = () => {
    const keys = indexes.nameIndex.get(item.normalized) || [];
    for (const key of keys) {
      const entry = canonMap.get(key);
      if (entry && hasDifferentSource(entry, source)) return key;
    }
    return null;
  };

  const findByFuzzyName = () => {
    if (!enableFuzzy) return null;

    const candidateKeys = source === 'db'
      ? new Set([...indexes.sourceKeys.add, ...indexes.sourceKeys.bpjs])
      : source === 'add'
        ? new Set([...indexes.sourceKeys.db, ...indexes.sourceKeys.bpjs])
        : new Set([...indexes.sourceKeys.db, ...indexes.sourceKeys.add]);

    for (const key of candidateKeys) {
      const entry = canonMap.get(key);
      if (!entry) continue;
      if (sourceItems(entry, source).length > 0) continue;
      for (const name of entry.names) {
        if (isSimilarName(item.normalized, name)) return key;
      }
    }
    return null;
  };

  const key = findByNik()
    || findByExactName()
    || findByFuzzyName()
    || `${source}:${item.nik || item.normalized}:${canonMap.size}`;

  if (!canonMap.has(key)) {
    canonMap.set(key, {
      names: new Set(),
      niks: new Set(),
      dbItems: [],
      addItems: [],
      bpjsItems: [],
    });
  }

  const entry = canonMap.get(key);
  entry.names.add(item.normalized);
  if (item.nik) entry.niks.add(item.nik);
  entry[sourceKey].push(item);
  indexEntry(indexes, key, source, item);
}

function compareItems(dbList, addList, bpjsList, enableFuzzy = false) {
  const canonMap = new Map();
  const indexes = createMatchIndexes();

  dbList.forEach((item) => addToCanonMap(canonMap, indexes, 'db', item, enableFuzzy));
  addList.forEach((item) => addToCanonMap(canonMap, indexes, 'add', item, enableFuzzy));
  bpjsList.forEach((item) => addToCanonMap(canonMap, indexes, 'bpjs', item, enableFuzzy));

  const items = [];

  canonMap.forEach((entry, key) => {
    const hasDb = entry.dbItems.length > 0;
    const hasAdd = entry.addItems.length > 0;
    const hasBpjs = entry.bpjsItems.length > 0;
    const status = statusFromSources(hasDb, hasAdd, hasBpjs);
    const dbNiks = [...new Set(entry.dbItems.map((item) => item.nik).filter(Boolean))];
    const bpjsNiks = [...new Set(entry.bpjsItems.map((item) => item.nik).filter(Boolean))];
    const nikMatch = dbNiks.some((nik) => bpjsNiks.includes(nik));
    const nikMismatch = dbNiks.length > 0 && bpjsNiks.length > 0 && !nikMatch;
    const sourceNames = new Set();

    entry.dbItems.forEach((item) => sourceNames.add(item.nama));
    entry.addItems.forEach((item) => sourceNames.add(item.nama));
    entry.bpjsItems.forEach((item) => sourceNames.add(item.nama));

    const normalizedNames = new Set([
      ...entry.dbItems.map((item) => item.normalized),
      ...entry.addItems.map((item) => item.normalized),
      ...entry.bpjsItems.map((item) => item.normalized),
    ]);
    const isFuzzy = normalizedNames.size > 1 && (hasDb || hasAdd) && (hasBpjs || hasAdd);

    items.push({
      key,
      nama: Array.from(sourceNames).join(' / '),
      normalized: Array.from(normalizedNames)[0] || '',
      dbNama: [...new Set(entry.dbItems.map((item) => item.nama))],
      addNama: [...new Set(entry.addItems.map((item) => item.nama))],
      bpjsNama: [...new Set(entry.bpjsItems.map((item) => item.nama))],
      inDb: hasDb,
      inAdd: hasAdd,
      inBpjs: hasBpjs,
      status,
      keterangan: buildKeterangan(hasDb, hasAdd, hasBpjs),
      isFuzzy,
      nikMatch,
      nikMismatch,
      nik: [...new Set([...dbNiks, ...bpjsNiks])],
      jenis: entry.dbItems[0]?.jenis || entry.addItems[0]?.jenis || null,
      rwNomor: entry.dbItems[0]?.rwNomor || entry.addItems[0]?.rwNomor || null,
      rtNomor: entry.dbItems[0]?.rtNomor || entry.addItems[0]?.rtNomor || null,
      dbDetails: entry.dbItems,
      addDetails: entry.addItems.flatMap((item) => item.details || []),
      bpjsDetails: entry.bpjsItems.flatMap((item) => item.details || []),
      addNilai: entry.addItems.reduce((sum, item) => sum + (item.totalNilai || 0), 0),
      bpjsUpah: entry.bpjsItems.reduce((sum, item) => sum + (item.totalUpah || 0), 0),
    });
  });

  const order = {
    all_three: 0,
    db_add: 1,
    db_bpjs: 2,
    add_bpjs: 3,
    only_db: 4,
    only_add: 5,
    only_bpjs: 6,
  };

  return items.sort((a, b) => {
    return (order[a.status] - order[b.status])
      || (a.rwNomor || '').localeCompare(b.rwNomor || '')
      || (a.rtNomor || '').localeCompare(b.rtNomor || '')
      || a.nama.localeCompare(b.nama);
  });
}

class RtrwComparisonController {
  /**
   * GET /api/kelembagaan/rtrw-comparison
   */
  async getComparison(req, res) {
    try {
      const enableFuzzy = ['1', 'true', 'yes'].includes(toText(req.query?.fuzzy).toLowerCase());
      const debugTiming = ['1', 'true', 'yes'].includes(toText(req.query?.debugTiming).toLowerCase());
      const startedAt = Date.now();
      const logTiming = (label) => {
        if (debugTiming) console.log(`[rtrw-comparison] ${label}: ${Date.now() - startedAt}ms`);
      };
      const [allDesa, allPengurus, allRws, allRts] = await Promise.all([
        prisma.desas.findMany({
          select: {
            id: true,
            kode: true,
            nama: true,
            kecamatans: {
              select: { id: true, kode: true, nama: true },
            },
          },
          orderBy: [
            { kecamatans: { nama: 'asc' } },
            { nama: 'asc' },
          ],
        }),
        prisma.pengurus.findMany({
          where: { pengurusable_type: { in: RT_RW_TYPES } },
          select: {
            id: true,
            desa_id: true,
            pengurusable_id: true,
            pengurusable_type: true,
            jabatan: true,
            nama_lengkap: true,
            nik: true,
            no_telepon: true,
            nama_bank: true,
            nomor_rekening: true,
            nama_rekening: true,
            status_jabatan: true,
            status_verifikasi: true,
            tanggal_mulai_jabatan: true,
            tanggal_akhir_jabatan: true,
            desas: {
              select: {
                kode: true,
                nama: true,
                kecamatans: { select: { nama: true, kode: true } },
              },
            },
          },
        }),
        prisma.rws.findMany({
          select: { id: true, desa_id: true, nomor: true, status_kelembagaan: true },
        }),
        prisma.rts.findMany({
          select: {
            id: true,
            desa_id: true,
            nomor: true,
            status_kelembagaan: true,
            rws: { select: { id: true, nomor: true } },
          },
        }),
      ]);
      logTiming('database loaded');

      const { addData, bpjsData, addMeta, bpjsMeta } = readSourceData();
      logTiming('excel loaded');
      const desaByKode = new Map(allDesa.map((desa) => [desa.kode, desa]));
      const rwById = new Map(allRws.map((rw) => [rw.id, rw]));
      const rtById = new Map(allRts.map((rt) => [rt.id, rt]));

      const dbItems = allPengurus.map((p) => {
        const normalizedType = p.pengurusable_type === 'rt' ? 'rts'
          : p.pengurusable_type === 'rw' ? 'rws'
            : p.pengurusable_type;
        const rw = normalizedType === 'rws' ? rwById.get(p.pengurusable_id) : null;
        const rt = normalizedType === 'rts' ? rtById.get(p.pengurusable_id) : null;
        const nama = normalizeName(p.nama_lengkap);

        return {
          source: 'db',
          id: p.id,
          nama,
          normalized: nama,
          nik: normalizeNik(p.nik),
          desaId: p.desa_id.toString(),
          desaKode: p.desas?.kode || '',
          desaNama: p.desas?.nama || '',
          kecamatanNama: p.desas?.kecamatans?.nama || '',
          pengurusableId: p.pengurusable_id,
          pengurusableType: normalizedType,
          jenis: normalizedType === 'rts' ? 'RT' : 'RW',
          rwNomor: normalizedType === 'rts' ? rt?.rws?.nomor || null : rw?.nomor || null,
          rtNomor: normalizedType === 'rts' ? rt?.nomor || null : null,
          jabatan: p.jabatan,
          noTelepon: p.no_telepon || '',
          namaBank: p.nama_bank || '',
          nomorRekening: p.nomor_rekening || '',
          namaRekening: p.nama_rekening || '',
          statusJabatan: p.status_jabatan || '',
          statusVerifikasi: p.status_verifikasi || '',
          tanggalMulaiJabatan: dateToStr(p.tanggal_mulai_jabatan),
          tanggalAkhirJabatan: dateToStr(p.tanggal_akhir_jabatan),
        };
      }).filter((item) => item.nama && item.desaKode);

      const dbByKode = groupBy(dbItems, (item) => item.desaKode);
      const addByKode = groupBy(addData, (item) => item.desaKode);
      const bpjsByKode = groupBy(bpjsData, (item) => item.desaKode);
      logTiming('source grouped');

      const comparison = allDesa.map((desa) => {
        const desaKode = desa.kode;
        const dbList = dbByKode[desaKode] || [];
        const addList = addByKode[desaKode] || [];
        const bpjsList = bpjsByKode[desaKode] || [];
        const items = compareItems(dbList, addList, bpjsList, enableFuzzy);

        return {
          desaId: desa.id.toString(),
          desaNama: desa.nama,
          desaKode: desa.kode,
          kecamatanNama: desa.kecamatans.nama,
          kecamatanId: desa.kecamatans.id.toString(),
          totalDb: dbList.length,
          totalAdd: addList.length,
          totalBpjs: bpjsList.length,
          allThree: items.filter((item) => item.status === 'all_three').length,
          dbAdd: items.filter((item) => item.status === 'db_add').length,
          dbBpjs: items.filter((item) => item.status === 'db_bpjs').length,
          addBpjs: items.filter((item) => item.status === 'add_bpjs').length,
          onlyDb: items.filter((item) => item.status === 'only_db').length,
          onlyAdd: items.filter((item) => item.status === 'only_add').length,
          onlyBpjs: items.filter((item) => item.status === 'only_bpjs').length,
          fuzzyMatched: items.filter((item) => item.isFuzzy).length,
          nikMismatch: items.filter((item) => item.nikMismatch).length,
          items,
        };
      });
      logTiming('comparison built');

      const unmatchedAddDesa = [...new Set(addData.map((item) => item.desaKode))]
        .filter((kode) => !desaByKode.has(kode))
        .sort();
      const unmatchedBpjsDesa = [...new Set(bpjsData.map((item) => item.desaKode))]
        .filter((kode) => !desaByKode.has(kode))
        .sort();

      const desaWithoutDb = comparison
        .filter((desa) => desa.totalDb === 0)
        .map((desa) => `${desa.desaNama} (${desa.kecamatanNama})`);
      const desaWithoutAdd = comparison
        .filter((desa) => desa.totalAdd === 0)
        .map((desa) => `${desa.desaNama} (${desa.kecamatanNama})`);
      const desaWithoutBpjs = comparison
        .filter((desa) => desa.totalBpjs === 0)
        .map((desa) => `${desa.desaNama} (${desa.kecamatanNama})`);

      const summary = {
        totalDesa: allDesa.length,
        totalDbPengurus: dbItems.length,
        totalAddPenerima: addMeta.totalPenerima,
        totalAddRows: addMeta.filteredRows,
        totalBpjsPenerima: bpjsMeta.totalPenerima,
        totalDbDesa: new Set(dbItems.map((item) => item.desaKode)).size,
        totalAddDesa: addMeta.totalDesa,
        totalBpjsDesa: bpjsMeta.totalDesa,
        totalAllThree: comparison.reduce((sum, desa) => sum + desa.allThree, 0),
        totalDbAdd: comparison.reduce((sum, desa) => sum + desa.dbAdd, 0),
        totalDbBpjs: comparison.reduce((sum, desa) => sum + desa.dbBpjs, 0),
        totalAddBpjs: comparison.reduce((sum, desa) => sum + desa.addBpjs, 0),
        totalOnlyDb: comparison.reduce((sum, desa) => sum + desa.onlyDb, 0),
        totalOnlyAdd: comparison.reduce((sum, desa) => sum + desa.onlyAdd, 0),
        totalOnlyBpjs: comparison.reduce((sum, desa) => sum + desa.onlyBpjs, 0),
        totalFuzzyMatched: comparison.reduce((sum, desa) => sum + desa.fuzzyMatched, 0),
        totalNikMismatch: comparison.reduce((sum, desa) => sum + desa.nikMismatch, 0),
        fuzzyEnabled: enableFuzzy,
        unmatchedAddDesa,
        unmatchedBpjsDesa,
        desaWithoutDb,
        desaWithoutAdd,
        desaWithoutBpjs,
      };
      logTiming('summary built');

      res.json({
        success: true,
        data: { summary, comparison },
      });
    } catch (error) {
      console.error('Error in RT/RW comparison:', error);
      res.status(500).json({
        success: false,
        message: 'Gagal memproses perbandingan data RT/RW',
        error: error.message,
      });
    }
  }
}

module.exports = new RtrwComparisonController();
