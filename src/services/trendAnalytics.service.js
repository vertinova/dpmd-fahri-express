// src/services/trendAnalytics.service.js
// Analisis trend lintas modul Core Dashboard.
//
// Prinsip: setiap angka berasal dari tanggal kejadian aslinya di database
// (SK pengangkatan, tanggal penetapan, tanggal input lembaga, dst) — bukan
// total yang dibagi rata per bulan. Modul yang memang tidak punya dimensi
// waktu (KKD/Bankeu dari file rekap, BUMDes, kelengkapan profil) disajikan
// terpisah pada bagiannya sendiri dan diberi label apa adanya.
const fs = require('fs');
const path = require('path');
const prisma = require('../config/prisma');
const logger = require('../utils/logger');

const PUBLIC_DIR = path.join(__dirname, '../../public');

// ============================================================
// Definisi sumber data
// ============================================================

// Semua nama tabel/kolom di bawah ini konstanta — tidak pernah dari input
// user — sehingga aman dipakai di $queryRawUnsafe. Nilai tanggal tetap
// dikirim sebagai parameter terikat.
const LKD_TABLES = [
  { table: 'rws', column: 'created_at', label: 'RW' },
  { table: 'rts', column: 'created_at', label: 'RT' },
  { table: 'posyandus', column: 'created_at', label: 'Posyandu' },
  { table: 'karang_tarunas', column: 'created_at', label: 'Karang Taruna' },
  { table: 'lpms', column: 'created_at', label: 'LPM' },
  { table: 'pkks', column: 'created_at', label: 'PKK' },
  { table: 'satlinmas', column: 'created_at', label: 'Satlinmas' },
  { table: 'lembaga_lainnyas', column: 'created_at', label: 'Lembaga Lainnya' },
];

// Urutan `slot` mengikuti palet kategorikal tervalidasi (blue, orange, aqua,
// yellow, magenta, green, violet, red). Jangan diacak — urutannya yang
// menjaga jarak antar warna tetap aman untuk buta warna.
const MONTHLY_SOURCES = [
  {
    key: 'aparatur',
    slot: 1,
    module: 'pemerintahan',
    label: 'Pengangkatan Aparatur',
    short_label: 'Aparatur',
    unit: 'orang',
    basis: 'tanggal SK pengangkatan',
    description:
      'Perangkat desa & BPD yang diangkat, dihitung dari tanggal SK pengangkatan.',
    tables: [{ table: 'aparatur_desa', column: 'tanggal_pengangkatan' }],
  },
  {
    key: 'produk_hukum',
    slot: 2,
    module: 'pemerintahan',
    label: 'Produk Hukum Ditetapkan',
    short_label: 'Produk Hukum',
    unit: 'dokumen',
    basis: 'tanggal penetapan',
    description:
      'Perdes/Perkades/SK yang ditetapkan desa, dihitung dari tanggal penetapan.',
    tables: [{ table: 'produk_hukums', column: 'tanggal_penetapan' }],
  },
  {
    key: 'perjadin',
    slot: 3,
    module: 'internal',
    label: 'Perjalanan Dinas',
    short_label: 'Perjadin',
    unit: 'kegiatan',
    basis: 'tanggal mulai kegiatan',
    description: 'Kegiatan perjalanan dinas, dihitung dari tanggal mulai kegiatan.',
    tables: [{ table: 'kegiatan', column: 'tanggal_mulai' }],
  },
  {
    key: 'kelembagaan',
    slot: 4,
    module: 'kelembagaan',
    label: 'Pendataan Lembaga Desa',
    short_label: 'Kelembagaan',
    unit: 'lembaga',
    basis: 'tanggal pendataan',
    description:
      'RW, RT, Posyandu, Karang Taruna, LPM, PKK, Satlinmas & lembaga lainnya yang masuk ke sistem.',
    tables: LKD_TABLES.map(({ table, column }) => ({ table, column })),
  },
  {
    key: 'pengurus',
    slot: 5,
    module: 'kelembagaan',
    label: 'Pengurus Lembaga Terdata',
    short_label: 'Pengurus',
    unit: 'orang',
    basis: 'tanggal pendataan',
    description: 'Pengurus dari seluruh lembaga kemasyarakatan desa yang terdata.',
    tables: [{ table: 'pengurus', column: 'created_at' }],
  },
  {
    key: 'bankeu',
    slot: 6,
    module: 'keuangan',
    label: 'Usulan Bankeu',
    short_label: 'Bankeu',
    unit: 'usulan',
    basis: 'tanggal usulan dibuat',
    description:
      'Usulan bantuan keuangan yang diajukan desa, beserta nilai anggaran yang diusulkan.',
    tables: [
      { table: 'bankeu_proposals', column: 'created_at', amountColumn: 'anggaran_usulan' },
    ],
    amount_label: 'Nilai anggaran diusulkan',
  },
  {
    key: 'bankeu_perubahan',
    slot: 7,
    module: 'keuangan',
    label: 'Usulan Bankeu Perubahan',
    short_label: 'Bankeu Perubahan',
    unit: 'usulan',
    basis: 'tanggal usulan dibuat',
    description:
      'Usulan bantuan keuangan pada anggaran perubahan, beserta nilai yang diusulkan.',
    tables: [
      {
        table: 'bankeu_perubahan_proposals',
        column: 'created_at',
        amountColumn: 'anggaran_usulan',
      },
    ],
    amount_label: 'Nilai anggaran diusulkan',
  },
  {
    key: 'bankeu_lpj',
    slot: 8,
    module: 'keuangan',
    label: 'LPJ Bankeu Masuk',
    short_label: 'LPJ Bankeu',
    unit: 'laporan',
    basis: 'tanggal LPJ dibuat',
    description:
      'Laporan pertanggungjawaban bantuan keuangan (reguler & perubahan) yang masuk dari desa.',
    tables: [
      { table: 'bankeu_lpj', column: 'created_at' },
      { table: 'bankeu_perubahan_lpj', column: 'created_at' },
    ],
  },
];

// Rekap penyaluran per tahap. Sumber berupa file rekap tanpa kolom tanggal,
// jadi yang bisa dibaca adalah progresi antar tahap — bukan deret bulanan.
const STAGE_GROUPS = [
  {
    key: 'add',
    module: 'keuangan',
    slot: 1,
    label: 'Alokasi Dana Desa (ADD)',
    stages: [{ label: 'ADD 2025', file: 'add2025.json' }],
  },
  {
    key: 'bhprd',
    module: 'keuangan',
    slot: 5,
    label: 'Bagi Hasil Pajak & Retribusi Daerah',
    stages: [
      { label: 'Tahap 1', file: 'bhprd-tahap1.json' },
      { label: 'Tahap 2', file: 'bhprd-tahap2.json' },
      { label: 'Tahap 3', file: 'bhprd-tahap3.json' },
    ],
  },
  {
    key: 'dd',
    module: 'keuangan',
    slot: 7,
    label: 'Dana Desa (DD)',
    stages: [
      { label: 'Earmarked T1', file: 'dd-earmarked-tahap1.json' },
      { label: 'Earmarked T2', file: 'dd-earmarked-tahap2.json' },
      { label: 'Non-Earmarked T1', file: 'dd-nonearmarked-tahap1.json' },
      { label: 'Non-Earmarked T2', file: 'dd-nonearmarked-tahap2.json' },
      { label: 'Insentif', file: 'insentif-dd.json' },
    ],
  },
  {
    key: 'bankeu_salur',
    module: 'keuangan',
    slot: 6,
    label: 'Penyaluran Bankeu',
    stages: [
      { label: 'Tahap 1', file: 'bankeu-tahap1.json' },
      { label: 'Tahap 2', file: 'bankeu-tahap2.json' },
    ],
  },
];

// Kolom profil desa yang dihitung kelengkapannya.
const PROFIL_FIELDS = [
  { column: 'klasifikasi_desa', label: 'Klasifikasi Desa' },
  { column: 'status_desa', label: 'Status Desa' },
  { column: 'tipologi_desa', label: 'Tipologi Desa' },
  { column: 'jumlah_penduduk', label: 'Jumlah Penduduk' },
  { column: 'luas_wilayah', label: 'Luas Wilayah' },
  { column: 'alamat_kantor', label: 'Alamat Kantor' },
  { column: 'no_telp', label: 'Nomor Telepon' },
  { column: 'email', label: 'Email' },
  { column: 'latitude', label: 'Titik Koordinat' },
  { column: 'foto_kantor_desa_path', label: 'Foto Kantor' },
  { column: 'sejarah_desa', label: 'Sejarah Desa' },
  { column: 'potensi_desa', label: 'Potensi Desa' },
];

// ============================================================
// Utilitas
// ============================================================

const toNumber = (value) => {
  if (value === null || value === undefined) return 0;
  const numeric = typeof value === 'bigint' ? Number(value) : Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
};

/** Persentase pertumbuhan, dibulatkan 1 desimal. */
const growth = (current, previous) => {
  if (!previous) return current > 0 ? 100 : 0;
  return Math.round(((current - previous) / previous) * 1000) / 10;
};

/** '1,234,567' / '1.234.567,00' -> 1234567 */
const parseRupiah = (raw) => {
  if (raw === null || raw === undefined) return 0;
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : 0;
  const cleaned = String(raw).replace(/[^0-9.,-]/g, '');
  // Format rekap memakai koma sebagai pemisah ribuan.
  const numeric = parseFloat(cleaned.replace(/,/g, ''));
  return Number.isFinite(numeric) ? numeric : 0;
};

const readJsonArray = (fileName) => {
  try {
    const filePath = path.join(PUBLIC_DIR, fileName);
    if (!fs.existsSync(filePath)) return [];
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (Array.isArray(parsed)) return parsed;
    return Array.isArray(parsed?.data) ? parsed.data : [];
  } catch (error) {
    logger.warn(`Trend: gagal membaca ${fileName} — ${error.message}`);
    return [];
  }
};

/** Deretan label bulan 'YYYY-MM' sepanjang `count`, mulai dari `from`. */
const monthLabels = (from, count) => {
  const labels = [];
  for (let i = 0; i < count; i += 1) {
    const date = new Date(from.getFullYear(), from.getMonth() + i, 1);
    labels.push(`${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`);
  }
  return labels;
};

const asSqlDate = (date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-01`;

// ============================================================
// Bagian 1 — deret bulanan dari tanggal kejadian
// ============================================================

const fetchBuckets = async (tables, fromDate, toDate) => {
  const parts = tables.map((source) => {
    const amount = source.amountColumn
      ? `COALESCE(SUM(\`${source.amountColumn}\`), 0)`
      : '0';
    return `SELECT DATE_FORMAT(\`${source.column}\`, '%Y-%m') AS bucket,
                   COUNT(*) AS total,
                   ${amount} AS amount
            FROM \`${source.table}\`
            WHERE \`${source.column}\` >= ? AND \`${source.column}\` < ?
            GROUP BY bucket`;
  });

  const sql =
    parts.length === 1
      ? parts[0]
      : `SELECT bucket, SUM(total) AS total, SUM(amount) AS amount
         FROM (${parts.join(' UNION ALL ')}) AS gabungan
         GROUP BY bucket`;

  const params = tables.flatMap(() => [fromDate, toDate]);
  return prisma.$queryRawUnsafe(sql, ...params);
};

const buildMonthlySeries = async (source, ctx) => {
  const rows = await fetchBuckets(source.tables, ctx.fromDate, ctx.toDate);

  const counts = new Map();
  const amounts = new Map();
  for (const row of rows) {
    counts.set(row.bucket, toNumber(row.total));
    amounts.set(row.bucket, toNumber(row.amount));
  }

  const points = ctx.labels.map((month) => ({ month, value: counts.get(month) || 0 }));
  const previousPoints = ctx.previousLabels.map((month) => counts.get(month) || 0);

  const total = points.reduce((sum, point) => sum + point.value, 0);
  const previousTotal = previousPoints.reduce((sum, value) => sum + value, 0);
  const peak = points.reduce(
    (best, point) => (point.value > best.value ? point : best),
    { month: ctx.labels[0], value: 0 }
  );

  const hasAmount = source.tables.some((table) => table.amountColumn);
  const amountPoints = hasAmount
    ? ctx.labels.map((month) => ({ month, value: amounts.get(month) || 0 }))
    : null;

  return {
    key: source.key,
    slot: source.slot,
    module: source.module,
    label: source.label,
    short_label: source.short_label,
    unit: source.unit,
    basis: source.basis,
    description: source.description,
    points,
    // sejajar indeks dengan `points`, untuk overlay pembanding periode lalu
    previous_points: previousPoints,
    amount_points: amountPoints,
    amount_label: hasAmount ? source.amount_label : null,
    amount_total: amountPoints
      ? amountPoints.reduce((sum, point) => sum + point.value, 0)
      : null,
    total,
    previous_total: previousTotal,
    growth: growth(total, previousTotal),
    // Modul yang baru online (mis. Bankeu) tidak punya pembanding di periode
    // lalu. Tanpa penanda ini frontend akan menampilkannya sebagai "+100%".
    has_baseline: previousTotal > 0,
    average: points.length ? Math.round(total / points.length) : 0,
    peak,
    latest: points.length ? points[points.length - 1].value : 0,
    active_months: points.filter((point) => point.value > 0).length,
  };
};

// ============================================================
// Bagian 2 — progresi penyaluran per tahap (rekap tanpa tanggal)
// ============================================================

const buildStageGroups = () =>
  STAGE_GROUPS.map((group) => {
    const stages = group.stages.map((stage) => {
      const rows = readJsonArray(stage.file);
      const amount = rows.reduce((sum, row) => sum + parseRupiah(row.Realisasi ?? row.realisasi), 0);
      const cair = rows.filter((row) =>
        String(row.sts || '').toLowerCase().includes('dicairkan')
      ).length;
      return {
        label: stage.label,
        desa: rows.length,
        cair,
        belum: rows.length - cair,
        amount,
      };
    });

    const totalAmount = stages.reduce((sum, stage) => sum + stage.amount, 0);
    const totalDesa = stages.reduce((sum, stage) => sum + stage.desa, 0);
    const totalCair = stages.reduce((sum, stage) => sum + stage.cair, 0);

    return {
      key: group.key,
      slot: group.slot,
      module: group.module,
      label: group.label,
      stages,
      total_amount: totalAmount,
      total_desa: totalDesa,
      total_cair: totalCair,
      persen_cair: totalDesa ? Math.round((totalCair / totalDesa) * 1000) / 10 : 0,
    };
  }).filter((group) => group.total_desa > 0);

// ============================================================
// Bagian 3 — deret tahunan (modul tanpa granularitas bulanan)
// ============================================================

const yearlyFromColumn = async ({ table, column, years }) => {
  const currentYear = new Date().getFullYear();
  // GROUP BY ekspresi (bukan alias) — beberapa tabel punya kolom bernama
  // `tahun` sendiri yang akan menang atas alias dan memicu ONLY_FULL_GROUP_BY.
  const rows = await prisma.$queryRawUnsafe(
    `SELECT YEAR(\`${column}\`) AS tahun, COUNT(*) AS total
     FROM \`${table}\`
     WHERE \`${column}\` IS NOT NULL
       AND YEAR(\`${column}\`) BETWEEN ? AND ?
     GROUP BY YEAR(\`${column}\`)
     ORDER BY YEAR(\`${column}\`) ASC`,
    currentYear - years + 1,
    currentYear
  );
  const byYear = new Map(rows.map((row) => [String(row.tahun), toNumber(row.total)]));
  return Array.from({ length: years }, (_, index) => {
    const year = String(currentYear - years + 1 + index);
    return { year, value: byYear.get(year) || 0 };
  });
};

const buildYearlySeries = async (years = 10) => {
  const result = [];

  // BUMDes hanya menyimpan tahun pendirian, bukan tanggal.
  try {
    const rows = await prisma.$queryRawUnsafe(
      `SELECT TahunPendirian AS tahun, COUNT(*) AS total
       FROM bumdes
       WHERE TahunPendirian REGEXP '^[0-9]{4}$'
         AND CAST(TahunPendirian AS UNSIGNED) BETWEEN 1990 AND YEAR(CURDATE())
       GROUP BY TahunPendirian
       ORDER BY TahunPendirian ASC`
    );
    const points = rows.slice(-years).map((row) => ({
      year: String(row.tahun),
      value: toNumber(row.total),
    }));
    if (points.length) {
      result.push({
        key: 'bumdes',
        slot: 7,
        module: 'ekonomi',
        label: 'Pendirian BUMDes',
        unit: 'BUMDes',
        description:
          'BUMDes hanya mencatat tahun pendirian, bukan tanggal — jadi disajikan tahunan.',
        points,
      });
    }
  } catch (error) {
    logger.warn(`Trend: BUMDes per tahun gagal — ${error.message}`);
  }

  const yearlySources = [
    {
      key: 'aparatur_tahunan',
      slot: 1,
      module: 'pemerintahan',
      label: 'Pengangkatan Aparatur per Tahun',
      unit: 'orang',
      description: 'Pandangan jangka panjang dari tanggal SK pengangkatan aparatur.',
      table: 'aparatur_desa',
      column: 'tanggal_pengangkatan',
    },
    {
      key: 'produk_hukum_tahunan',
      slot: 2,
      module: 'pemerintahan',
      label: 'Produk Hukum per Tahun',
      unit: 'dokumen',
      description: 'Pandangan jangka panjang dari tanggal penetapan produk hukum.',
      table: 'produk_hukums',
      column: 'tanggal_penetapan',
    },
  ];

  for (const source of yearlySources) {
    try {
      const points = await yearlyFromColumn({
        table: source.table,
        column: source.column,
        years,
      });
      result.push({
        key: source.key,
        slot: source.slot,
        module: source.module,
        label: source.label,
        unit: source.unit,
        description: source.description,
        points,
      });
    } catch (error) {
      logger.warn(`Trend tahunan ${source.key} gagal — ${error.message}`);
    }
  }

  return result;
};

// ============================================================
// Bagian 4 — komposisi & kelengkapan (foto keadaan, bukan deret waktu)
// ============================================================

const buildKelembagaanComposition = async () => {
  const parts = LKD_TABLES.map(
    (source) =>
      `SELECT '${source.label}' AS jenis,
              COUNT(*) AS total,
              SUM(status_kelembagaan = 'aktif') AS aktif,
              SUM(status_verifikasi = 'verified') AS terverifikasi
       FROM \`${source.table}\``
  );

  try {
    const rows = await prisma.$queryRawUnsafe(parts.join(' UNION ALL '));
    return rows
      .map((row) => ({
        label: row.jenis,
        total: toNumber(row.total),
        aktif: toNumber(row.aktif),
        terverifikasi: toNumber(row.terverifikasi),
      }))
      .sort((a, b) => b.total - a.total);
  } catch (error) {
    logger.warn(`Trend: komposisi kelembagaan gagal — ${error.message}`);
    return [];
  }
};

const buildProfilCoverage = async () => {
  const selects = PROFIL_FIELDS.map(
    (field) =>
      `SUM(\`${field.column}\` IS NOT NULL AND TRIM(\`${field.column}\`) <> '') AS \`${field.column}\``
  ).join(', ');

  try {
    const [totalDesaRow] = await prisma.$queryRawUnsafe(
      `SELECT COUNT(*) AS total FROM desas`
    );
    const [row] = await prisma.$queryRawUnsafe(
      `SELECT COUNT(*) AS profil, ${selects} FROM profil_desas`
    );

    const totalDesa = toNumber(totalDesaRow?.total);
    const fields = PROFIL_FIELDS.map((field) => ({
      label: field.label,
      terisi: toNumber(row?.[field.column]),
    }))
      .map((field) => ({
        ...field,
        persen: totalDesa ? Math.round((field.terisi / totalDesa) * 1000) / 10 : 0,
      }))
      .sort((a, b) => b.terisi - a.terisi);

    return {
      total_desa: totalDesa,
      total_profil: toNumber(row?.profil),
      fields,
    };
  } catch (error) {
    logger.warn(`Trend: kelengkapan profil desa gagal — ${error.message}`);
    return { total_desa: 0, total_profil: 0, fields: [] };
  }
};

// ============================================================
// Entry point
// ============================================================

/**
 * @param {{ months?: number }} options
 * @returns {Promise<object>} payload analisis trend lintas modul
 */
const getTrendAnalytics = async ({ months = 12 } = {}) => {
  const span = Math.min(Math.max(parseInt(months, 10) || 12, 3), 36);

  const now = new Date();
  const monthStart = (offset) => new Date(now.getFullYear(), now.getMonth() + offset, 1);

  const currentStart = monthStart(-(span - 1));
  const previousStart = monthStart(-(span * 2 - 1));
  const endExclusive = monthStart(1);

  const ctx = {
    labels: monthLabels(currentStart, span),
    previousLabels: monthLabels(previousStart, span),
    fromDate: asSqlDate(previousStart),
    toDate: asSqlDate(endExclusive),
  };

  const series = [];
  for (const source of MONTHLY_SOURCES) {
    try {
      series.push(await buildMonthlySeries(source, ctx));
    } catch (error) {
      logger.warn(`Trend source ${source.key} gagal — ${error.message}`);
    }
  }

  const [yearly, kelembagaan, profil] = await Promise.all([
    buildYearlySeries(10),
    buildKelembagaanComposition(),
    buildProfilCoverage(),
  ]);

  const stages = buildStageGroups();
  const bumdesSeries = yearly.find((item) => item.key === 'bumdes');

  return {
    range: {
      months: span,
      start: ctx.labels[0],
      end: ctx.labels[ctx.labels.length - 1],
      previous_start: ctx.previousLabels[0],
      previous_end: ctx.previousLabels[ctx.previousLabels.length - 1],
    },
    labels: ctx.labels,
    series,
    stages,
    yearly,
    composition: {
      kelembagaan,
      profil_desa: profil,
    },
    // Dipertahankan agar pemakai lama endpoint ini tidak patah.
    bumdes_per_tahun: bumdesSeries ? bumdesSeries.points : [],
    generated_at: new Date().toISOString(),
  };
};

module.exports = { getTrendAnalytics };
