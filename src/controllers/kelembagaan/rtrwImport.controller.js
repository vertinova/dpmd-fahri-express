/**
 * Import Excel untuk sumber data Persandingan RT/RW (BPJS & ADD).
 *
 * Mengganti file Excel saja TIDAK cukup: controller rtrwComparison membaca
 * `data/rtrwbpjs.json` / `data/rtrwadd.json` selama kedua file itu ada
 * (lihat hasPreparedJsonCache), jadi setiap penggantian Excel wajib diikuti
 * regenerasi cache JSON. Regenerasi butuh ~3 dtk (BPJS) s/d ~25 dtk (ADD),
 * terlalu lama untuk satu request sinkron — karena itu dijalankan sebagai job
 * latar di child process, dan frontend polling endpoint /import/status.
 */
const fs = require('fs');
const path = require('path');
const { fork } = require('child_process');
const XLSX = require('xlsx');
const ActivityLogger = require('../../utils/activityLogger');

const DATA_DIR = path.join(__dirname, '..', '..', '..', 'data');
const BACKUP_DIR = path.join(DATA_DIR, 'backups');
const IMPORT_JOB = path.join(__dirname, '..', '..', '..', 'scripts', 'rtrw-import-job.js');

// Kolom wajib per jenis sumber, disamakan dengan apa yang benar-benar dibaca
// generator (generate-rtrw-json-cache.js) supaya validasi di sini tidak pernah
// meloloskan file yang nanti gagal diparse. Nama sheet mengikuti urutan
// prioritas generator. Satu entri boleh berupa array = daftar alternatif
// (kolom Nilai di ekspor Siskeudes kadang bernama " Nilai " dengan spasi).
const SOURCES = {
  bpjs: {
    label: 'Data BPJS',
    targetFile: path.join(DATA_DIR, 'rtrwbpjs.xlsx'),
    jsonFile: path.join(DATA_DIR, 'rtrwbpjs.json'),
    sheetCandidates: ['DATABASE', 'data_upah'],
    requiredColumns: [
      ['NIK'],
      ['ID_PEGAWAI', 'ID_Pegawai', 'ID Pegawai'],
      ['KPJ'],
      ['NAMA_LENGKAP'],
      ['UPAH'],
      ['BLTH'],
    ],
    periodeColumn: 'BLTH',
  },
  add: {
    label: 'Data ADD',
    targetFile: path.join(DATA_DIR, 'rtrwadd.xlsx'),
    jsonFile: path.join(DATA_DIR, 'rtrwadd.json'),
    sheetCandidates: ['Sheet2'],
    requiredColumns: [
      ['Kd_Desa'],
      ['Nm_Desa'],
      ['Nm_Penerima'],
      ['Kd_Keg'],
      ['Sumberdana'],
      ['Keterangan'],
      ['Nilai', ' Nilai ', ' Nilai'],
    ],
    periodeColumn: null,
  },
};

const toText = (value) => String(value ?? '').trim();

// Satu job sekaligus. Regenerasi menulis file JSON yang sedang dibaca
// controller lain, jadi dua job paralel bisa saling menimpa.
let activeJob = null;
let lastJob = null;

function sourceConfig(jenis) {
  return SOURCES[toText(jenis).toLowerCase()] || null;
}

function pickSheet(workbook, candidates) {
  const found = candidates.find((name) => workbook.Sheets[name]);
  return found || workbook.SheetNames[0];
}

/**
 * Validasi murah di jalur request: baca header + 1 baris data saja.
 *
 * XLSX.readFile sinkron dan memblokir event loop — membaca rtrwadd.xlsx utuh
 * butuh ~19 detik, sedangkan dengan sheetRows:2 hanya ~2 detik. Penghitungan
 * baris & periode yang butuh parse penuh dikerjakan child process
 * (scripts/rtrw-import-job.js), bukan di sini.
 */
function inspectWorkbook(filePath, config) {
  let workbook;
  try {
    workbook = XLSX.readFile(filePath, { sheetRows: 2 });
  } catch (error) {
    return { ok: false, message: `File Excel tidak bisa dibaca: ${error.message}` };
  }

  if (!workbook.SheetNames.length) {
    return { ok: false, message: 'File Excel tidak punya sheet apa pun.' };
  }

  const sheetName = pickSheet(workbook, config.sheetCandidates);
  const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], {
    header: 1,
    defval: '',
    blankrows: false,
  });
  const header = rows[0] || [];

  if (rows.length < 2) {
    return { ok: false, message: `Sheet "${sheetName}" tidak punya baris data (hanya header).`, sheetName };
  }

  // Header dibandingkan apa adanya DAN setelah di-trim, karena sheet_to_json
  // memakai nama kolom mentah sebagai key sehingga spasi di tepi berpengaruh.
  const headerSet = new Set();
  header.forEach((cell) => {
    headerSet.add(String(cell ?? ''));
    headerSet.add(toText(cell));
  });

  const missing = config.requiredColumns
    .filter((alternatives) => !alternatives.some((column) => headerSet.has(column)))
    .map((alternatives) => alternatives[0]);

  if (missing.length) {
    return {
      ok: false,
      message: `Kolom wajib tidak ditemukan di sheet "${sheetName}": ${missing.join(', ')}. `
        + `Pastikan file memakai format ${config.label} (sheet ${config.sheetCandidates.join(' atau ')}).`,
      sheetName,
      header: header.map((cell) => toText(cell)).filter(Boolean),
    };
  }

  return { ok: true, sheetName, header: header.map((cell) => toText(cell)).filter(Boolean) };
}

function readJsonMeta(jsonFile) {
  if (!fs.existsSync(jsonFile)) return null;
  try {
    const payload = JSON.parse(fs.readFileSync(jsonFile, 'utf8'));
    return {
      generatedAt: payload.generatedAt || null,
      sheetName: payload.sheetName || null,
      meta: payload.meta || null,
      source: payload.source || null,
    };
  } catch (error) {
    return { error: `Cache JSON tidak bisa dibaca: ${error.message}` };
  }
}

function fileInfo(filePath) {
  if (!fs.existsSync(filePath)) return null;
  const stat = fs.statSync(filePath);
  return {
    name: path.basename(filePath),
    size: stat.size,
    modifiedAt: stat.mtime.toISOString(),
  };
}

function backupCurrent(config, stamp) {
  if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const created = [];

  [config.targetFile, config.jsonFile].forEach((filePath) => {
    if (!fs.existsSync(filePath)) return;
    const ext = path.extname(filePath);
    const base = path.basename(filePath, ext);
    const dest = path.join(BACKUP_DIR, `${base}_${stamp}${ext}`);
    fs.copyFileSync(filePath, dest);
    created.push(path.basename(dest));
  });

  return created;
}

/** Jalankan job di child process agar parsing berat tidak memblokir event loop. */
function startRegenerate(jenis, config, context) {
  const job = {
    id: `${jenis}-${Date.now()}`,
    jenis,
    label: config.label,
    status: 'running',
    startedAt: new Date().toISOString(),
    finishedAt: null,
    durationMs: null,
    result: null,
    summary: null,
    error: null,
    backups: context.backups,
    uploadedFile: context.uploadedFile,
    archivedAs: context.archivedAs,
    before: context.before,
    after: null,
    user: context.user,
  };

  activeJob = job;
  const startedAt = Date.now();
  const args = [`--only=${jenis}`];
  if (config.periodeColumn) args.push(`--periode-column=${config.periodeColumn}`);
  const child = fork(IMPORT_JOB, args, { silent: true });
  let stdout = '';
  let stderr = '';

  child.stdout?.on('data', (chunk) => { stdout += chunk.toString(); });
  child.stderr?.on('data', (chunk) => { stderr += chunk.toString(); });

  // 'error' dan 'close' bisa dua-duanya menyala untuk satu child; tanpa guard
  // ini activity log tertulis dua kali dan lastJob tertimpa hasil yang salah.
  let settled = false;
  const settle = (apply) => {
    if (settled) return;
    settled = true;
    apply();
    job.finishedAt = new Date().toISOString();
    job.durationMs = Date.now() - startedAt;
    activeJob = null;
    lastJob = job;
    writeImportLog(job, context.logMeta);
  };

  child.on('error', (error) => settle(() => {
    job.status = 'failed';
    job.error = `Gagal menjalankan job import: ${error.message}`;
  }));

  child.on('close', (code) => settle(() => {
    if (code === 0) {
      job.status = 'done';
      try {
        const payload = JSON.parse(stdout);
        job.result = payload;
        job.summary = payload.summary || null;
      } catch {
        job.result = { raw: stdout.trim() };
      }
      job.after = { cache: readJsonMeta(config.jsonFile), periode: job.summary?.periode || [] };
    } else {
      job.status = 'failed';
      job.error = (stderr || stdout || `Job import keluar dengan kode ${code}`).trim().slice(0, 2000);
      console.error(`[rtrw-import] regenerasi ${jenis} gagal (exit ${code}):`, job.error);
    }
  }));

  return job;
}

/**
 * Satu baris activity log per import, ditulis setelah hasilnya diketahui agar
 * memuat angka sebelum→sesudah dan status akhir (bukan sekadar "file diterima").
 */
function writeImportLog(job, logMeta) {
  if (!logMeta) return;

  const before = job.before?.cache?.meta || null;
  const after = job.result?.[job.jenis] || null;
  const periode = job.summary?.periode?.length ? `, periode ${job.summary.periode.join(', ')}` : '';
  const description = job.status === 'done'
    ? `Import Excel ${job.label} (${job.uploadedFile}): `
      + `${before?.totalRows ?? '?'} → ${after?.totalRows ?? '?'} baris, `
      + `${before?.totalDesa ?? '?'} → ${after?.totalDesa ?? '?'} desa${periode}`
    : `Import Excel ${job.label} (${job.uploadedFile}) GAGAL saat regenerasi cache: ${job.error}`;

  ActivityLogger.log({
    userId: logMeta.userId,
    userName: logMeta.userName,
    userRole: logMeta.userRole,
    bidangId: logMeta.bidangId,
    module: 'kelembagaan',
    action: 'import',
    entityType: 'rtrw_comparison_source',
    entityName: job.label,
    description,
    oldValue: before ? JSON.stringify(before) : null,
    newValue: after ? JSON.stringify({ ...after, periode: job.summary?.periode || [] }) : null,
    ipAddress: logMeta.ipAddress,
    userAgent: logMeta.userAgent,
  }).catch((error) => console.error('[rtrw-import] gagal mencatat activity log:', error.message));
}

function publicJob(job) {
  if (!job) return null;
  const { user, ...rest } = job;
  return { ...rest, userName: user?.name || null };
}

class RtrwImportController {
  /**
   * GET /api/kelembagaan/rtrw-comparison/import/info
   * Info sumber data yang sedang aktif + status job terakhir.
   */
  async getInfo(req, res) {
    try {
      const sources = Object.entries(SOURCES).map(([jenis, config]) => ({
        jenis,
        label: config.label,
        sheetCandidates: config.sheetCandidates,
        requiredColumns: config.requiredColumns,
        excel: fileInfo(config.targetFile),
        cache: readJsonMeta(config.jsonFile),
      }));

      res.json({
        success: true,
        data: {
          sources,
          activeJob: publicJob(activeJob),
          lastJob: publicJob(lastJob),
        },
      });
    } catch (error) {
      console.error('Error getInfo rtrw import:', error);
      res.status(500).json({ success: false, message: 'Gagal memuat info sumber data', error: error.message });
    }
  }

  /**
   * GET /api/kelembagaan/rtrw-comparison/import/status
   */
  async getStatus(req, res) {
    res.json({
      success: true,
      data: {
        activeJob: publicJob(activeJob),
        lastJob: publicJob(lastJob),
      },
    });
  }

  /**
   * POST /api/kelembagaan/rtrw-comparison/import
   * field: file (xlsx), jenis (bpjs|add)
   */
  async importExcel(req, res) {
    const cleanup = () => {
      if (req.file?.path && fs.existsSync(req.file.path)) {
        try { fs.unlinkSync(req.file.path); } catch { /* abaikan */ }
      }
    };

    try {
      if (!req.file) {
        return res.status(400).json({ success: false, message: 'File Excel tidak ditemukan. Silakan pilih file.' });
      }

      const config = sourceConfig(req.body?.jenis);
      if (!config) {
        cleanup();
        return res.status(400).json({
          success: false,
          message: `Jenis data tidak dikenal. Pilihan: ${Object.keys(SOURCES).join(', ')}.`,
        });
      }

      if (activeJob) {
        cleanup();
        return res.status(409).json({
          success: false,
          message: `Masih ada proses import ${activeJob.label} yang berjalan. Tunggu sampai selesai.`,
          data: { activeJob: publicJob(activeJob) },
        });
      }

      const jenis = toText(req.body.jenis).toLowerCase();
      const inspection = inspectWorkbook(req.file.path, config);
      if (!inspection.ok) {
        cleanup();
        return res.status(400).json({ success: false, message: inspection.message, data: inspection });
      }

      const before = {
        excel: fileInfo(config.targetFile),
        cache: readJsonMeta(config.jsonFile),
      };

      const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      const backups = backupCurrent(config, stamp);

      // Simpan salinan bertanggal sebagai arsip, lalu pasang sebagai file aktif.
      const archivedAs = `${path.basename(config.targetFile, '.xlsx')}${stamp.slice(0, 10).replace(/-/g, '')}.xlsx`;
      fs.copyFileSync(req.file.path, path.join(DATA_DIR, archivedAs));
      fs.copyFileSync(req.file.path, config.targetFile);
      cleanup();

      // Activity log ditulis saat job selesai, bukan sekarang: jumlah baris &
      // periode baru diketahui setelah child process mem-parse file penuh.
      const job = startRegenerate(jenis, config, {
        backups,
        archivedAs,
        uploadedFile: req.file.originalname,
        before,
        user: { id: req.user?.id, name: req.user?.name },
        logMeta: {
          userId: req.user?.id,
          userName: req.user?.name,
          userRole: req.user?.role,
          bidangId: req.user?.bidang_id || null,
          ipAddress: req.ip,
          userAgent: req.get?.('user-agent') || null,
        },
      });

      res.status(202).json({
        success: true,
        message: `File ${config.label} diterima. Cache sedang diregenerasi.`,
        data: { job: publicJob(job) },
      });
    } catch (error) {
      cleanup();
      console.error('Error import Excel RT/RW:', error);
      res.status(500).json({ success: false, message: 'Gagal memproses file import', error: error.message });
    }
  }
}

module.exports = new RtrwImportController();
