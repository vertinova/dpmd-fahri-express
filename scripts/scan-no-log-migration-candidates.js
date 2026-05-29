const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const TABLES = [
  'rws',
  'rts',
  'posyandus',
  'karang_tarunas',
  'lpms',
  'satlinmas',
  'pkks',
  'pengurus'
];

const DELETE_ORDER = [
  'pengurus',
  'rts',
  'posyandus',
  'karang_tarunas',
  'lpms',
  'satlinmas',
  'pkks',
  'rws'
];

const DEFAULT_DESA_IDS = [51, 52, 53, 54, 55, 59];
const DEFAULT_KECAMATAN_NAMES = [];
const DEFAULT_START = '2026-04-18 18:50:00';
const DEFAULT_END = '2026-04-18 19:20:00';

const args = parseArgs(process.argv.slice(2));
const requestedKecamatanNames = args.kecamatanNames
  ? args.kecamatanNames.split(',').map((value) => value.trim()).filter(Boolean)
  : DEFAULT_KECAMATAN_NAMES;
let desaIds = args.desaIds
  ? parseNumberList(args.desaIds)
  : [];
const windowStart = args.start || DEFAULT_START;
const windowEnd = args.end || DEFAULT_END;
const outputDir = path.resolve(process.cwd(), args.outputDir || 'logs');

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

async function main() {
  fs.mkdirSync(outputDir, { recursive: true });

  const connection = await mysql.createConnection({
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'dpmd',
    dateStrings: true,
    multipleStatements: false
  });

  try {
    const kecamatanMatches = requestedKecamatanNames.length > 0
      ? await resolveKecamatanNames(connection, requestedKecamatanNames)
      : [];

    if (desaIds.length === 0 && kecamatanMatches.length > 0) {
      desaIds = await loadDesaIdsForKecamatans(
        connection,
        kecamatanMatches.map((match) => match.id)
      );
    }

    if (desaIds.length === 0) {
      desaIds = DEFAULT_DESA_IDS;
    }

    const desaNames = await loadDesaNames(connection, desaIds);
    const rows = await loadWindowRows(connection, desaIds, windowStart, windowEnd);
    const logsById = await loadLogsById(connection, rows.map((row) => row.id));
    const details = rows.map((row) => {
      const logs = logsById.get(row.id) || emptyLogInfo();
      return {
        table: row.table_name,
        id: row.id,
        desa_id: Number(row.desa_id),
        desa_name: desaNames.get(Number(row.desa_id)) || null,
        display_name: row.display_name || null,
        jabatan: row.jabatan || null,
        nik: row.nik || null,
        pengurusable_type: row.pengurusable_type || null,
        pengurusable_id: row.pengurusable_id || null,
        status_jabatan: row.status_jabatan || null,
        status_kelembagaan: row.status_kelembagaan || null,
        status_verifikasi: row.status_verifikasi || null,
        created_at: formatDate(row.created_at),
        updated_at: formatDate(row.updated_at),
        own_logs: logs,
        status: logs.count > 0 ? 'skipped_logged' : 'safe_candidate',
        reason: logs.count > 0
          ? 'record_has_kelembagaan_activity_log'
          : 'created_in_migration_window_and_no_activity_log'
      };
    });

    const detailsById = new Map(details.map((detail) => [detail.id, detail]));
    const safeIds = () => new Set(details.filter((detail) => detail.status === 'safe_candidate').map((detail) => detail.id));

    const childPengurusByParent = await loadChildPengurus(connection, details);
    for (const detail of details) {
      if (detail.status !== 'safe_candidate' || detail.table === 'pengurus') {
        continue;
      }

      const childRows = childPengurusByParent.get(parentKey(detail.table, detail.id)) || [];
      const currentSafeIds = safeIds();
      const unsafeChildren = childRows.filter((child) => !currentSafeIds.has(child.id));

      if (unsafeChildren.length > 0) {
        detail.status = 'skipped_child_pengurus';
        detail.reason = `parent_has_${unsafeChildren.length}_pengurus_not_safe_to_delete`;
        detail.blocking_children = unsafeChildren.map((child) => ({
          table: 'pengurus',
          id: child.id,
          name: child.nama_lengkap || null,
          created_at: formatDate(child.created_at),
          status: detailsById.get(child.id)?.status || 'not_in_migration_window'
        }));
      }
    }

    const childRtsByRw = await loadChildRts(connection, details);
    for (const detail of details) {
      if (detail.status !== 'safe_candidate' || detail.table !== 'rws') {
        continue;
      }

      const childRows = childRtsByRw.get(detail.id) || [];
      const currentSafeIds = safeIds();
      const unsafeChildren = childRows.filter((child) => !currentSafeIds.has(child.id));

      if (unsafeChildren.length > 0) {
        detail.status = 'skipped_child_rt';
        detail.reason = `rw_has_${unsafeChildren.length}_rt_not_safe_to_delete`;
        detail.blocking_children = unsafeChildren.map((child) => ({
          table: 'rts',
          id: child.id,
          name: child.nomor || null,
          created_at: formatDate(child.created_at),
          status: detailsById.get(child.id)?.status || 'not_in_migration_window'
        }));
      }
    }

    const summary = summarize(details);
    const timestamp = makeTimestamp();
    const base = path.join(outputDir, `no-log-migration-candidates-${timestamp}`);
    const report = {
      database: {
        host: process.env.DB_HOST || '127.0.0.1',
        port: Number(process.env.DB_PORT || 3306),
        name: process.env.DB_NAME || 'dpmd'
      },
      filters: {
        requested_kecamatan_names: requestedKecamatanNames,
        resolved_kecamatan_names: kecamatanMatches,
        desa_ids: desaIds,
        migration_window_start: windowStart,
        migration_window_end: windowEnd
      },
      rules: [
        'Only records in the target desa IDs and migration timestamp window are scanned.',
        'Records with any kelembagaan_activity_logs entry on entity_id or kelembagaan_id are skipped.',
        'Pengurus are evaluated by their own activity log only, so imported pengurus under an organic/logged lembaga can still be reverted safely.',
        'Lembaga are skipped if they have child pengurus that are not safe candidates.',
        'RW records are skipped if they have child RT records that are not safe candidates.'
      ],
      summary,
      details
    };

    const jsonPath = `${base}.json`;
    const csvPath = `${base}.csv`;
    const sqlPath = `${base}.sql`;

    fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2));
    fs.writeFileSync(csvPath, toCsv(details));
    fs.writeFileSync(sqlPath, buildRollbackSql(details));

    printSummary(summary, { jsonPath, csvPath, sqlPath });
  } finally {
    await connection.end();
  }
}

function parseArgs(argv) {
  const parsed = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (!next || next.startsWith('--')) {
        parsed[key] = true;
      } else {
        parsed[key] = next;
        i += 1;
      }
    }
  }
  return parsed;
}

function parseNumberList(value) {
  return value
    .split(',')
    .map((item) => Number(item.trim()))
    .filter(Boolean);
}

async function resolveKecamatanNames(connection, requestedNames) {
  const [rows] = await connection.execute('SELECT id, nama FROM kecamatans ORDER BY id');
  const byNormalizedName = new Map();

  for (const row of rows) {
    byNormalizedName.set(normalizeName(row.nama), {
      id: Number(row.id),
      nama: row.nama
    });
  }

  const matches = [];
  const missing = [];

  for (const requestedName of requestedNames) {
    const match = byNormalizedName.get(normalizeName(requestedName));
    if (match) {
      matches.push({
        requested: requestedName,
        id: match.id,
        nama: match.nama
      });
    } else {
      missing.push(requestedName);
    }
  }

  if (missing.length > 0) {
    throw new Error(`Kecamatan not found: ${missing.join(', ')}`);
  }

  return matches;
}

async function loadDesaIdsForKecamatans(connection, kecamatanIds) {
  if (kecamatanIds.length === 0) {
    return [];
  }

  const [rows] = await connection.execute(
    `
      SELECT id
      FROM desas
      WHERE kecamatan_id IN (${placeholders(kecamatanIds.length)})
      ORDER BY kecamatan_id, nama
    `,
    kecamatanIds
  );

  return rows.map((row) => Number(row.id));
}

function normalizeName(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

async function loadDesaNames(connection, ids) {
  const names = new Map();
  const [rows] = await connection.execute(
    `
      SELECT d.id, CONCAT(d.nama, ' - ', COALESCE(k.nama, '-')) AS label
      FROM desas d
      LEFT JOIN kecamatans k ON k.id = d.kecamatan_id
      WHERE d.id IN (${placeholders(ids.length)})
    `,
    ids
  );

  for (const row of rows) {
    names.set(Number(row.id), row.label);
  }

  return names;
}

async function loadWindowRows(connection, ids, start, end) {
  const rows = [];

  for (const table of TABLES) {
    const select = table === 'pengurus'
      ? "'pengurus' AS table_name, id, desa_id, nama_lengkap AS display_name, jabatan, nik, pengurusable_type, pengurusable_id, status_jabatan, NULL AS status_kelembagaan, status_verifikasi, created_at, updated_at"
      : `'${table}' AS table_name, id, desa_id, ${table === 'rws' || table === 'rts' ? 'nomor' : 'nama'} AS display_name, NULL AS jabatan, NULL AS nik, NULL AS pengurusable_type, NULL AS pengurusable_id, NULL AS status_jabatan, status_kelembagaan, status_verifikasi, created_at, updated_at`;

    const [tableRows] = await connection.execute(
      `
        SELECT ${select}
        FROM \`${table}\`
        WHERE desa_id IN (${placeholders(ids.length)})
          AND created_at BETWEEN ? AND ?
      `,
      [...ids, start, end]
    );

    rows.push(...tableRows);
  }

  rows.sort((a, b) => {
    const desaCompare = Number(a.desa_id) - Number(b.desa_id);
    if (desaCompare !== 0) return desaCompare;
    const tableCompare = String(a.table_name).localeCompare(String(b.table_name));
    if (tableCompare !== 0) return tableCompare;
    return String(a.display_name || '').localeCompare(String(b.display_name || ''));
  });

  return rows;
}

async function loadLogsById(connection, ids) {
  const logs = new Map();
  if (ids.length === 0) {
    return logs;
  }

  for (const chunk of chunks(ids, 400)) {
    const [rows] = await connection.execute(
      `
        SELECT
          CASE
            WHEN entity_id IN (${placeholders(chunk.length)}) THEN entity_id
            WHEN kelembagaan_id IN (${placeholders(chunk.length)}) THEN kelembagaan_id
          END AS matched_id,
          COUNT(*) AS count,
          MIN(created_at) AS first_log_at,
          MAX(created_at) AS last_log_at,
          GROUP_CONCAT(DISTINCT activity_type ORDER BY activity_type SEPARATOR ',') AS activity_types,
          GROUP_CONCAT(DISTINCT user_role ORDER BY user_role SEPARATOR ',') AS user_roles
        FROM kelembagaan_activity_logs
        WHERE entity_id IN (${placeholders(chunk.length)})
           OR kelembagaan_id IN (${placeholders(chunk.length)})
        GROUP BY matched_id
      `,
      [...chunk, ...chunk, ...chunk, ...chunk]
    );

    for (const row of rows) {
      if (!row.matched_id) {
        continue;
      }

      logs.set(row.matched_id, {
        count: Number(row.count || 0),
        first_log_at: formatDate(row.first_log_at),
        last_log_at: formatDate(row.last_log_at),
        activity_types: row.activity_types ? row.activity_types.split(',') : [],
        user_roles: row.user_roles ? row.user_roles.split(',') : []
      });
    }
  }

  return logs;
}

async function loadChildPengurus(connection, details) {
  const parentIdsByTable = new Map();
  for (const detail of details) {
    if (detail.table === 'pengurus') {
      continue;
    }
    if (!parentIdsByTable.has(detail.table)) {
      parentIdsByTable.set(detail.table, []);
    }
    parentIdsByTable.get(detail.table).push(detail.id);
  }

  const byParent = new Map();
  for (const [table, ids] of parentIdsByTable.entries()) {
    for (const chunk of chunks(ids, 400)) {
      const [rows] = await connection.execute(
        `
          SELECT id, desa_id, pengurusable_type, pengurusable_id, nama_lengkap, jabatan, created_at
          FROM pengurus
          WHERE pengurusable_type = ?
            AND pengurusable_id IN (${placeholders(chunk.length)})
        `,
        [table, ...chunk]
      );

      for (const row of rows) {
        const key = parentKey(row.pengurusable_type, row.pengurusable_id);
        if (!byParent.has(key)) {
          byParent.set(key, []);
        }
        byParent.get(key).push(row);
      }
    }
  }

  return byParent;
}

async function loadChildRts(connection, details) {
  const rwIds = details
    .filter((detail) => detail.table === 'rws')
    .map((detail) => detail.id);
  const byRw = new Map();

  for (const chunk of chunks(rwIds, 400)) {
    const [rows] = await connection.execute(
      `
        SELECT id, rw_id, desa_id, nomor, created_at
        FROM rts
        WHERE rw_id IN (${placeholders(chunk.length)})
      `,
      chunk
    );

    for (const row of rows) {
      if (!byRw.has(row.rw_id)) {
        byRw.set(row.rw_id, []);
      }
      byRw.get(row.rw_id).push(row);
    }
  }

  return byRw;
}

function summarize(details) {
  const summary = {
    scanned_window_rows: details.length,
    total_safe_candidates: details.filter((detail) => detail.status === 'safe_candidate').length,
    by_status: {},
    by_table: {},
    by_desa: {}
  };

  for (const detail of details) {
    increment(summary.by_status, detail.status);

    if (!summary.by_table[detail.table]) {
      summary.by_table[detail.table] = {};
    }
    increment(summary.by_table[detail.table], detail.status);

    const desaKey = `${detail.desa_id} ${detail.desa_name || ''}`.trim();
    if (!summary.by_desa[desaKey]) {
      summary.by_desa[desaKey] = {};
    }
    increment(summary.by_desa[desaKey], detail.status);
  }

  return summary;
}

function toCsv(details) {
  const headers = [
    'status',
    'reason',
    'table',
    'id',
    'desa_id',
    'desa_name',
    'display_name',
    'jabatan',
    'nik',
    'pengurusable_type',
    'pengurusable_id',
    'own_log_count',
    'own_log_types',
    'own_log_roles',
    'created_at',
    'updated_at'
  ];

  const lines = [headers.join(',')];
  for (const detail of details) {
    lines.push([
      detail.status,
      detail.reason,
      detail.table,
      detail.id,
      detail.desa_id,
      detail.desa_name || '',
      detail.display_name || '',
      detail.jabatan || '',
      detail.nik || '',
      detail.pengurusable_type || '',
      detail.pengurusable_id || '',
      detail.own_logs.count,
      detail.own_logs.activity_types.join('|'),
      detail.own_logs.user_roles.join('|'),
      detail.created_at || '',
      detail.updated_at || ''
    ].map(csvValue).join(','));
  }

  return `${lines.join('\n')}\n`;
}

function buildRollbackSql(details) {
  const safeIdsByTable = new Map();
  for (const detail of details) {
    if (detail.status !== 'safe_candidate') {
      continue;
    }
    if (!safeIdsByTable.has(detail.table)) {
      safeIdsByTable.set(detail.table, []);
    }
    safeIdsByTable.get(detail.table).push(detail.id);
  }

  const lines = [
    '-- No-log migration revert candidate SQL',
    '-- Review JSON/CSV first. This SQL rolls back by default.',
    `-- Filter window: ${windowStart} to ${windowEnd}`,
    `-- Desa IDs: ${desaIds.join(', ')}`,
    '',
    'START TRANSACTION;',
    ''
  ];

  for (const table of DELETE_ORDER) {
    const ids = safeIdsByTable.get(table) || [];
    if (ids.length === 0) {
      continue;
    }

    lines.push(`-- ${table}: ${ids.length} safe candidates`);
    const guard = [
      `id IN (${ids.map(sqlString).join(', ')})`,
      `created_at BETWEEN ${sqlString(windowStart)} AND ${sqlString(windowEnd)}`,
      `NOT EXISTS (SELECT 1 FROM kelembagaan_activity_logs l WHERE l.entity_id = \`${table}\`.id OR l.kelembagaan_id = \`${table}\`.id)`
    ].join(' AND ');
    lines.push(`SELECT '${table}' AS table_name, COUNT(*) AS rows_to_delete FROM \`${table}\` WHERE ${guard};`);
    lines.push(`DELETE FROM \`${table}\` WHERE ${guard};`);
    lines.push('');
  }

  lines.push('-- Safety default. Change ROLLBACK to COMMIT only after review.');
  lines.push('ROLLBACK;');
  lines.push('');

  return lines.join('\n');
}

function printSummary(summary, paths) {
  console.log('No-log migration candidate scan');
  console.log(`Scanned window rows : ${summary.scanned_window_rows}`);
  console.log(`Safe candidates     : ${summary.total_safe_candidates}`);
  console.log('');
  console.log('By status:');
  for (const [status, count] of Object.entries(summary.by_status).sort()) {
    console.log(`- ${status}: ${count}`);
  }
  console.log('');
  console.log('By table:');
  for (const [table, statuses] of Object.entries(summary.by_table).sort()) {
    const compact = Object.entries(statuses)
      .sort()
      .map(([status, count]) => `${status}=${count}`)
      .join(', ');
    console.log(`- ${table}: ${compact}`);
  }
  console.log('');
  console.log('By desa:');
  for (const [desa, statuses] of Object.entries(summary.by_desa).sort()) {
    const compact = Object.entries(statuses)
      .sort()
      .map(([status, count]) => `${status}=${count}`)
      .join(', ');
    console.log(`- ${desa}: ${compact}`);
  }
  console.log('');
  console.log(`JSON : ${paths.jsonPath}`);
  console.log(`CSV  : ${paths.csvPath}`);
  console.log(`SQL  : ${paths.sqlPath}`);
}

function increment(target, key) {
  target[key] = (target[key] || 0) + 1;
}

function emptyLogInfo() {
  return {
    count: 0,
    first_log_at: null,
    last_log_at: null,
    activity_types: [],
    user_roles: []
  };
}

function parentKey(table, id) {
  return `${table}:${id}`;
}

function parseArgs(argv) {
  const parsed = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (!next || next.startsWith('--')) {
        parsed[key] = true;
      } else {
        parsed[key] = next;
        i += 1;
      }
    }
  }
  return parsed;
}

function placeholders(count) {
  return Array.from({ length: count }, () => '?').join(', ');
}

function chunks(values, size) {
  const result = [];
  for (let i = 0; i < values.length; i += size) {
    result.push(values.slice(i, i + size));
  }
  return result;
}

function formatDate(value) {
  if (!value) {
    return null;
  }
  if (value instanceof Date) {
    return value.toISOString().replace('T', ' ').slice(0, 19);
  }
  return String(value);
}

function makeTimestamp() {
  return new Date()
    .toISOString()
    .replace(/[:.]/g, '-')
    .replace('T', '_')
    .slice(0, 19);
}

function csvValue(value) {
  const stringValue = value === null || value === undefined ? '' : String(value);
  if (/[",\n]/.test(stringValue)) {
    return `"${stringValue.replace(/"/g, '""')}"`;
  }
  return stringValue;
}

function sqlString(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}
