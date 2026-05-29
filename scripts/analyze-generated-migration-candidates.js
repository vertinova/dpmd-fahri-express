const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const KNOWN_TABLES = new Set([
  'rws',
  'rts',
  'posyandus',
  'karang_tarunas',
  'lpms',
  'satlinmas',
  'pkks',
  'pengurus'
]);

const LEMBAGA_TABLES = [
  'rts',
  'rws',
  'posyandus',
  'karang_tarunas',
  'lpms',
  'satlinmas',
  'pkks'
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

const args = parseArgs(process.argv.slice(2));
const sqlPath = path.resolve(process.cwd(), args.sql || 'import_babakan_madang.sql');
const outputDir = path.resolve(process.cwd(), args.outputDir || 'logs');

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

async function main() {
  if (!fs.existsSync(sqlPath)) {
    throw new Error(`SQL file not found: ${sqlPath}`);
  }

  fs.mkdirSync(outputDir, { recursive: true });

  const generatedRows = parseGeneratedSql(sqlPath);
  const generatedById = new Map(generatedRows.map((row) => [row.id, row]));
  const generatedIds = new Set(generatedRows.map((row) => row.id));

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
    const existingRows = await loadExistingRows(connection, groupIdsByTable(generatedRows));
    const allRelevantIds = collectRelevantIds(generatedRows);
    const logsById = await loadLogsById(connection, Array.from(allRelevantIds));
    const childPengurusByParent = await loadChildPengurus(connection, generatedRows);
    const childRtsByRw = await loadChildRts(connection, generatedRows);

    const details = generatedRows.map((row) => {
      const dbRow = existingRows.get(row.id) || null;
      const ownLogs = logsById.get(row.id) || emptyLogInfo();
      const parentLogs = row.table === 'pengurus'
        ? (logsById.get(row.pengurusable_id) || emptyLogInfo())
        : emptyLogInfo();

      const detail = {
        source: {
          table: row.table,
          id: row.id,
          desa_id: row.desa_id,
          name: row.name || null,
          jabatan: row.jabatan || null,
          nik: row.nik || null,
          pengurusable_type: row.pengurusable_type || null,
          pengurusable_id: row.pengurusable_id || null
        },
        found_in_db: Boolean(dbRow),
        db: dbRow,
        own_logs: ownLogs,
        parent_logs: parentLogs,
        status: 'safe_candidate',
        reason: 'generated_id_found_and_no_activity_log'
      };

      if (!dbRow) {
        detail.status = 'missing_in_db';
        detail.reason = 'generated_id_not_found_in_restored_database';
      } else if (ownLogs.count > 0) {
        detail.status = 'skipped_logged';
        detail.reason = 'record_has_kelembagaan_activity_log';
      } else if (row.table === 'pengurus' && parentLogs.count > 0) {
        detail.status = 'skipped_parent_logged';
        detail.reason = 'pengurus_parent_lembaga_has_activity_log';
      }

      return detail;
    });

    const detailsById = new Map(details.map((detail) => [detail.source.id, detail]));

    // First protect lembaga that have non-generated or already-protected pengurus.
    for (const detail of details) {
      if (detail.status !== 'safe_candidate' || detail.source.table === 'pengurus') {
        continue;
      }

      const children = childPengurusByParent.get(parentKey(detail.source.table, detail.source.id)) || [];
      const unsafeChildren = children.filter((child) => {
        if (!generatedIds.has(child.id)) {
          return true;
        }

        const childDetail = detailsById.get(child.id);
        return !childDetail || childDetail.status !== 'safe_candidate';
      });

      if (unsafeChildren.length > 0) {
        detail.status = 'skipped_child_pengurus';
        detail.reason = `parent_has_${unsafeChildren.length}_pengurus_not_safe_to_delete`;
        detail.blocking_children = unsafeChildren.map((child) => ({
          table: 'pengurus',
          id: child.id,
          name: child.nama_lengkap || null,
          generated: generatedIds.has(child.id),
          status: detailsById.get(child.id)?.status || 'not_generated'
        }));
      }
    }

    // Then protect RW that would keep RT children behind.
    for (const detail of details) {
      if (detail.status !== 'safe_candidate' || detail.source.table !== 'rws') {
        continue;
      }

      const children = childRtsByRw.get(detail.source.id) || [];
      const unsafeChildren = children.filter((child) => {
        if (!generatedIds.has(child.id)) {
          return true;
        }

        const childDetail = detailsById.get(child.id);
        return !childDetail || childDetail.status !== 'safe_candidate';
      });

      if (unsafeChildren.length > 0) {
        detail.status = 'skipped_child_rt';
        detail.reason = `rw_has_${unsafeChildren.length}_rt_not_safe_to_delete`;
        detail.blocking_children = unsafeChildren.map((child) => ({
          table: 'rts',
          id: child.id,
          name: child.nomor || null,
          generated: generatedIds.has(child.id),
          status: detailsById.get(child.id)?.status || 'not_generated'
        }));
      }
    }

    const summary = summarize(details);
    const timestamp = makeTimestamp();
    const base = path.join(outputDir, `generated-migration-revert-candidates-${timestamp}`);

    const report = {
      generated_sql: sqlPath,
      database: {
        host: process.env.DB_HOST || '127.0.0.1',
        port: Number(process.env.DB_PORT || 3306),
        name: process.env.DB_NAME || 'dpmd'
      },
      rules: [
        'Only IDs found in the generated import SQL are considered.',
        'Records with any kelembagaan_activity_logs entry on entity_id or kelembagaan_id are skipped.',
        'Pengurus are skipped when their parent lembaga has any activity log.',
        'Lembaga are skipped when they contain child pengurus that are not safe candidates.',
        'RW records are skipped when they contain child RT records that are not safe candidates.'
      ],
      summary,
      details
    };

    const jsonPath = `${base}.json`;
    const csvPath = `${base}.csv`;
    const rollbackSqlPath = `${base}.sql`;

    fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2));
    fs.writeFileSync(csvPath, toCsv(details));
    fs.writeFileSync(rollbackSqlPath, buildRollbackSql(details));

    printSummary(summary, { jsonPath, csvPath, rollbackSqlPath });
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

function parseGeneratedSql(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const rows = [];
  const insertPattern = /INSERT IGNORE INTO `([^`]+)` \(([^)]+)\) VALUES \((.*)\);/g;
  let match;

  while ((match = insertPattern.exec(content)) !== null) {
    const [, table, columnsSql, valuesSql] = match;
    if (!KNOWN_TABLES.has(table)) {
      continue;
    }

    const columns = columnsSql.split(',').map((column) => column.trim().replace(/`/g, ''));
    const values = splitSqlValues(valuesSql).map(normalizeSqlValue);
    const row = {};

    columns.forEach((column, index) => {
      row[column] = values[index];
    });

    if (!row.id) {
      continue;
    }

    rows.push({
      table,
      id: row.id,
      desa_id: row.desa_id ? Number(row.desa_id) : null,
      name: row.nama || row.nomor || row.nama_lengkap || null,
      jabatan: row.jabatan || null,
      nik: row.nik || null,
      pengurusable_type: row.pengurusable_type || null,
      pengurusable_id: row.pengurusable_id || null
    });
  }

  return rows;
}

function splitSqlValues(sql) {
  const values = [];
  let current = '';
  let inQuote = false;

  for (let i = 0; i < sql.length; i += 1) {
    const char = sql[i];
    const next = sql[i + 1];

    if (char === "'" && inQuote && next === "'") {
      current += "''";
      i += 1;
      continue;
    }

    if (char === "'" && sql[i - 1] !== '\\') {
      inQuote = !inQuote;
      current += char;
      continue;
    }

    if (char === ',' && !inQuote) {
      values.push(current.trim());
      current = '';
      continue;
    }

    current += char;
  }

  if (current.trim() !== '') {
    values.push(current.trim());
  }

  return values;
}

function normalizeSqlValue(value) {
  const trimmed = value.trim();
  if (/^NULL$/i.test(trimmed)) {
    return null;
  }

  if (/^NOW\(\)$/i.test(trimmed)) {
    return 'NOW()';
  }

  if (trimmed.startsWith("'") && trimmed.endsWith("'")) {
    return trimmed
      .slice(1, -1)
      .replace(/''/g, "'")
      .replace(/\\\\/g, '\\');
  }

  if (/^-?\d+$/.test(trimmed)) {
    return Number(trimmed);
  }

  return trimmed;
}

function groupIdsByTable(rows) {
  const grouped = new Map();
  for (const row of rows) {
    if (!grouped.has(row.table)) {
      grouped.set(row.table, []);
    }
    grouped.get(row.table).push(row.id);
  }
  return grouped;
}

async function loadExistingRows(connection, idsByTable) {
  const rowsById = new Map();

  for (const [table, ids] of idsByTable.entries()) {
    const select = table === 'pengurus'
      ? 'id, desa_id, nama_lengkap AS display_name, jabatan, nik, pengurusable_type, pengurusable_id, status_jabatan, status_verifikasi, produk_hukum_id, created_at, updated_at'
      : `${table === 'rws' || table === 'rts' ? 'nomor' : 'nama'} AS display_name, id, desa_id, alamat, status_kelembagaan, status_verifikasi, produk_hukum_id, created_at, updated_at`;

    for (const chunk of chunks(ids, 500)) {
      const [rows] = await connection.execute(
        `SELECT '${table}' AS table_name, ${select} FROM \`${table}\` WHERE id IN (${placeholders(chunk.length)})`,
        chunk
      );

      for (const row of rows) {
        rowsById.set(row.id, convertDates(row));
      }
    }
  }

  return rowsById;
}

function collectRelevantIds(rows) {
  const ids = new Set(rows.map((row) => row.id));
  for (const row of rows) {
    if (row.table === 'pengurus' && row.pengurusable_id) {
      ids.add(row.pengurusable_id);
    }
  }
  return ids;
}

async function loadLogsById(connection, ids) {
  const logs = new Map();

  for (const chunk of chunks(ids, 400)) {
    const params = [...chunk, ...chunk];
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
      [...params, ...params]
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

async function loadChildPengurus(connection, rows) {
  const byParent = new Map();
  const parentIdsByTable = new Map();

  for (const row of rows) {
    if (row.table === 'pengurus') {
      continue;
    }

    if (!parentIdsByTable.has(row.table)) {
      parentIdsByTable.set(row.table, []);
    }
    parentIdsByTable.get(row.table).push(row.id);
  }

  for (const [table, ids] of parentIdsByTable.entries()) {
    for (const chunk of chunks(ids, 400)) {
      const [children] = await connection.execute(
        `
          SELECT id, desa_id, pengurusable_type, pengurusable_id, nama_lengkap, jabatan
          FROM pengurus
          WHERE pengurusable_type = ?
            AND pengurusable_id IN (${placeholders(chunk.length)})
        `,
        [table, ...chunk]
      );

      for (const child of children) {
        const key = parentKey(child.pengurusable_type, child.pengurusable_id);
        if (!byParent.has(key)) {
          byParent.set(key, []);
        }
        byParent.get(key).push(child);
      }
    }
  }

  return byParent;
}

async function loadChildRts(connection, rows) {
  const rwIds = rows
    .filter((row) => row.table === 'rws')
    .map((row) => row.id);
  const byRw = new Map();

  for (const chunk of chunks(rwIds, 400)) {
    const [children] = await connection.execute(
      `
        SELECT id, rw_id, desa_id, nomor
        FROM rts
        WHERE rw_id IN (${placeholders(chunk.length)})
      `,
      chunk
    );

    for (const child of children) {
      if (!byRw.has(child.rw_id)) {
        byRw.set(child.rw_id, []);
      }
      byRw.get(child.rw_id).push(child);
    }
  }

  return byRw;
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

function summarize(details) {
  const summary = {
    total_generated_sql_rows: details.length,
    total_found_in_db: details.filter((detail) => detail.found_in_db).length,
    total_safe_candidates: details.filter((detail) => detail.status === 'safe_candidate').length,
    by_status: {},
    by_table: {},
    by_desa: {}
  };

  for (const detail of details) {
    increment(summary.by_status, detail.status);

    if (!summary.by_table[detail.source.table]) {
      summary.by_table[detail.source.table] = {};
    }
    increment(summary.by_table[detail.source.table], detail.status);

    const desaKey = String(detail.source.desa_id || 'unknown');
    if (!summary.by_desa[desaKey]) {
      summary.by_desa[desaKey] = {};
    }
    increment(summary.by_desa[desaKey], detail.status);
  }

  return summary;
}

function increment(target, key) {
  target[key] = (target[key] || 0) + 1;
}

function toCsv(details) {
  const headers = [
    'status',
    'reason',
    'table',
    'id',
    'desa_id',
    'name',
    'jabatan',
    'nik',
    'pengurusable_type',
    'pengurusable_id',
    'own_log_count',
    'own_log_types',
    'parent_log_count',
    'parent_log_types',
    'db_created_at',
    'db_updated_at'
  ];

  const lines = [headers.join(',')];

  for (const detail of details) {
    const row = [
      detail.status,
      detail.reason,
      detail.source.table,
      detail.source.id,
      detail.source.desa_id,
      detail.db?.display_name || detail.source.name || '',
      detail.source.jabatan || '',
      detail.source.nik || '',
      detail.source.pengurusable_type || '',
      detail.source.pengurusable_id || '',
      detail.own_logs.count,
      detail.own_logs.activity_types.join('|'),
      detail.parent_logs.count,
      detail.parent_logs.activity_types.join('|'),
      detail.db?.created_at || '',
      detail.db?.updated_at || ''
    ];

    lines.push(row.map(csvValue).join(','));
  }

  return `${lines.join('\n')}\n`;
}

function buildRollbackSql(details) {
  const safeIdsByTable = new Map();
  for (const detail of details) {
    if (detail.status !== 'safe_candidate') {
      continue;
    }

    if (!safeIdsByTable.has(detail.source.table)) {
      safeIdsByTable.set(detail.source.table, []);
    }
    safeIdsByTable.get(detail.source.table).push(detail.source.id);
  }

  const lines = [
    '-- Generated migration revert candidate SQL',
    '-- Review the JSON/CSV report before applying.',
    '-- This script rolls back by default. Replace ROLLBACK with COMMIT to apply after review.',
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
    lines.push(`SELECT '${table}' AS table_name, COUNT(*) AS rows_to_delete FROM \`${table}\` WHERE id IN (${ids.map(sqlString).join(', ')});`);
    lines.push(`DELETE FROM \`${table}\` WHERE id IN (${ids.map(sqlString).join(', ')});`);
    lines.push('');
  }

  lines.push('-- Safety default: no changes persist unless you change this to COMMIT.');
  lines.push('ROLLBACK;');
  lines.push('');

  return lines.join('\n');
}

function printSummary(summary, paths) {
  console.log('Generated migration candidate analysis');
  console.log(`Generated rows in SQL : ${summary.total_generated_sql_rows}`);
  console.log(`Found in database     : ${summary.total_found_in_db}`);
  console.log(`Safe candidates       : ${summary.total_safe_candidates}`);
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
  console.log(`JSON : ${paths.jsonPath}`);
  console.log(`CSV  : ${paths.csvPath}`);
  console.log(`SQL  : ${paths.rollbackSqlPath}`);
}

function convertDates(row) {
  const copy = { ...row };
  for (const key of ['created_at', 'updated_at']) {
    copy[key] = formatDate(copy[key]);
  }
  return copy;
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

function chunks(values, size) {
  const result = [];
  for (let i = 0; i < values.length; i += size) {
    result.push(values.slice(i, i + size));
  }
  return result;
}

function placeholders(count) {
  return Array.from({ length: count }, () => '?').join(', ');
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
