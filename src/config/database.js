/**
 * Koneksi SQL mentah (pengganti Sequelize).
 *
 * Kode lama memanggil `sequelize.query(sql, { replacements, type, transaction })` dan
 * `sequelize.transaction()`. Modul ini menyediakan antarmuka yang sama di atas driver mysql2
 * yang selama ini dipakai Sequelize, dengan perilaku yang disalin dari Sequelize 6.37.7:
 * sesi MySQL `+00:00`, DATETIME dibaca sebagai UTC, DATE sebagai string, cara mengisi
 * replacements, bentuk hasil, transaksi, dan nama galat. Tujuannya: data yang tersimpan dan
 * bentuk respons API tidak berubah sama sekali. Query baru sebaiknya memakai Prisma.
 */
const mysql = require('mysql2');
const logger = require('../utils/logger');

const QueryTypes = Object.freeze({
  SELECT: 'SELECT', INSERT: 'INSERT', UPDATE: 'UPDATE', BULKUPDATE: 'BULKUPDATE', BULKDELETE: 'BULKDELETE',
  DELETE: 'DELETE', UPSERT: 'UPSERT', VERSION: 'VERSION', SHOWTABLES: 'SHOWTABLES', SHOWINDEXES: 'SHOWINDEXES',
  DESCRIBE: 'DESCRIBE', RAW: 'RAW', FOREIGNKEYS: 'FOREIGNKEYS', SHOWCONSTRAINTS: 'SHOWCONSTRAINTS',
});

const ZONA = '+00:00';
const ER_DUP_ENTRY = 1062;
const ER_DEADLOCK = 1213;
const ER_ROW_IS_REFERENCED = 1451;
const ER_NO_REFERENCED_ROW = 1452;

// ---------- Galat: nama & properti sama dengan Sequelize agar penanganan lama tetap jalan ----------
class DatabaseError extends Error {
  constructor(parent, stack) {
    super(parent.message);
    this.name = 'SequelizeDatabaseError';
    this.parent = parent;
    this.original = parent;
    this.sql = parent.sql;
    this.parameters = parent.parameters ?? {};
    if (stack) this.stack = stack;
  }
}
class UniqueConstraintError extends Error {
  constructor({ message, errors, parent, fields, stack }) {
    super(message);
    this.name = 'SequelizeUniqueConstraintError';
    this.errors = errors;
    this.fields = fields;
    this.parent = parent;
    this.original = parent;
    this.sql = parent.sql;
    if (stack) this.stack = stack;
  }
}
class ForeignKeyConstraintError extends DatabaseError {
  constructor({ parent, stack, table, fields, index, reltype }) {
    super(parent, stack);
    this.name = 'SequelizeForeignKeyConstraintError';
    this.message = parent.message || 'Database Error';
    this.fields = fields;
    this.table = table;
    this.value = undefined;
    this.index = index;
    this.reltype = reltype;
  }
}

function formatError(err, stack) {
  const kode = err.errno || err.code;
  if (kode === ER_DUP_ENTRY) {
    const match = err.message.match(/Duplicate entry '([\s\S]*)' for key '?((.|\s)*?)'?$/);
    const fieldKey = match ? match[2].split('.').pop() : undefined;
    const fields = { [fieldKey]: match ? match[1] : undefined };
    const errors = Object.entries(fields).map(([path, value]) => ({
      message: `${path} must be unique`, type: 'unique violation', path, value, origin: 'DB',
      instance: undefined, validatorKey: 'not_unique', validatorName: null, validatorArgs: [],
    }));
    return new UniqueConstraintError({ message: 'Validation error', errors, parent: err, fields, stack });
  }
  if (kode === ER_ROW_IS_REFERENCED || kode === ER_NO_REFERENCED_ROW) {
    const match = err.message.match(/CONSTRAINT ([`"])(.*)\1 FOREIGN KEY \(\1(.*)\1\) REFERENCES \1(.*)\1 \(\1(.*)\1\)/);
    const kutip = match ? match[1] : '`';
    return new ForeignKeyConstraintError({
      parent: err, stack,
      reltype: String(kode) === String(ER_ROW_IS_REFERENCED) ? 'parent' : 'child',
      table: match ? match[4] : undefined,
      fields: match ? match[3].split(new RegExp(`${kutip}, *${kutip}`)) : undefined,
      index: match ? match[2] : undefined,
    });
  }
  return new DatabaseError(err, stack);
}

// ---------- Escape & replacements (salinan sql-string.js + utils/sql.js Sequelize, dialek mysql) ----------
const dua = (n) => String(n).padStart(2, '0');
// Sequelize memformat Date pada replacements memakai zona proses (bukan zona sesi).
function formatTanggal(d) {
  if (Number.isNaN(d.getTime())) return 'Invalid date';
  return `${String(d.getFullYear()).padStart(4, '0')}-${dua(d.getMonth() + 1)}-${dua(d.getDate())} ${dua(d.getHours())}:${dua(d.getMinutes())}:${dua(d.getSeconds())}`;
}

function escape(val) {
  if (val === undefined || val === null) return 'NULL';
  switch (typeof val) {
    case 'boolean': return (!!val).toString();
    case 'number':
    case 'bigint': return val.toString();
    default: break;
  }
  if (val instanceof Date) val = formatTanggal(val);
  if (Buffer.isBuffer(val)) return `X'${val.toString('hex')}'`;
  if (Array.isArray(val)) return arrayToList(val);
  if (!val.replace) throw new Error(`Invalid value ${String(val)}`);
  val = val.replace(/[\0\n\r\b\t\\'"\x1a]/g, (s) => {
    switch (s) {
      case '\0': return '\\0';
      case '\n': return '\\n';
      case '\r': return '\\r';
      case '\b': return '\\b';
      case '\t': return '\\t';
      case '\x1a': return '\\Z';
      default: return `\\${s}`;
    }
  });
  return `'${val}'`;
}
function arrayToList(arr) {
  return arr.map((v) => (Array.isArray(v) ? `(${arrayToList(v)})` : escape(v))).join(', ');
}

const bisaMendahului = (c) => c === undefined || /[\s(>,=]/.test(c);
function lolosBackslash(s, pos) {
  let lolos = false;
  for (let i = pos; i >= 0 && s[i] === '\\'; i--) lolos = !lolos;
  return lolos;
}
const isPlainObject = (v) => v !== null && typeof v === 'object' && (Object.getPrototypeOf(v) === Object.prototype || Object.getPrototypeOf(v) === null);

function injectReplacements(sql, replacements) {
  if (replacements == null) return sql;
  if (!Array.isArray(replacements) && !isPlainObject(replacements)) {
    throw new TypeError(`"replacements" must be an array or a plain object, but received ${JSON.stringify(replacements)} instead.`);
  }
  const bernama = isPlainObject(replacements);
  let posisi = -1;
  let out = '';
  let dolar = null;
  let diString = false;
  let diKolom = false;
  let akhirPotong = 0;
  let komentarBaris = false;
  let komentarBlok = false;
  for (let i = 0; i < sql.length; i++) {
    const c = sql[i];
    if (diKolom) { if (c === '`') diKolom = false; continue; }
    if (diString) { if (c === "'" && !lolosBackslash(sql, i - 1)) diString = false; continue; }
    if (dolar !== null) {
      if (c !== '$') continue;
      const m = sql.slice(i).match(/^\$(?<name>[a-z_][0-9a-z_]*)?(\$)/i);
      if (dolar === (m?.groups?.name || '')) dolar = null;
      continue;
    }
    if (komentarBaris) { if (c === '\n') komentarBaris = false; continue; }
    if (komentarBlok) { if (c === '*' && sql[i + 1] === '/') komentarBlok = false; continue; }
    if (c === '`') { diKolom = true; continue; }
    if (c === "'") { diString = true; continue; }
    if (c === '-' && sql.slice(i, i + 3) === '-- ') { komentarBaris = true; continue; }
    if (c === '/' && sql.slice(i, i + 2) === '/*') { komentarBlok = true; continue; }
    if (c === '$') {
      if (/[0-9a-z_]/i.test(sql[i - 1])) continue;
      const m = sql.slice(i).match(/^\$(?<name>[a-z_][0-9a-z_]*)?(\$)/i);
      if (m) { dolar = m.groups?.name ?? ''; i += m[0].length - 1; }
      continue;
    }
    if (bernama && c === ':') {
      if (!bisaMendahului(sql[i - 1]) && sql[i - 1] !== '[') continue;
      const nama = sql.slice(i).match(/^:(?<name>[a-z_][0-9a-z_]*)(?:\)|,|$|\s|::|;|])/i)?.groups?.name;
      if (!nama) continue;
      const nilai = replacements[nama];
      if (!Object.prototype.hasOwnProperty.call(replacements, nama) || nilai === undefined) {
        throw new Error(`Named replacement ":${nama}" has no entry in the replacement map.`);
      }
      out += sql.slice(akhirPotong, i) + escape(nilai);
      akhirPotong = i + nama.length + 1;
      continue;
    }
    if (!bernama && c === '?') {
      if (!bisaMendahului(sql[i - 1]) && sql[i - 1] !== '[') continue;
      if (sql[i + 1] === '|' || sql[i + 1] === '&') continue;
      const idx = ++posisi;
      const nilai = replacements[idx];
      if (nilai === undefined) {
        throw new Error(`Positional replacement (?) ${idx} has no entry in the replacement map (replacements[${idx}] is undefined).`);
      }
      out += sql.slice(akhirPotong, i) + escape(nilai);
      akhirPotong = i + 1;
    }
  }
  if (diString) throw new Error(`The following SQL query includes an unterminated string literal:\n${sql}`);
  return out + sql.slice(akhirPotong);
}

// ---------- Pool: setelan sama dengan connection-manager Sequelize ----------
const produksi = process.env.NODE_ENV === 'production';
const pool = mysql.createPool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT || 3306,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  flags: '-FOUND_ROWS',
  timezone: ZONA,
  supportBigNumbers: true,
  bigNumberStrings: false,
  connectionLimit: produksi ? 30 : 10,
  maxIdle: 2,
  idleTimeout: 10000,
  // Parser Sequelize: DATETIME → Date (dibaca UTC), DATE → string. Tipe lain: bawaan mysql2.
  typeCast(field, next) {
    if (field.type === 'DATETIME') {
      const v = field.string();
      return v === null ? v : new Date(`${v} ${ZONA}`);
    }
    if (field.type === 'DATE') return field.string();
    return next();
  },
});
// Sesi MySQL di UTC seperti Sequelize; NOW() dan DEFAULT CURRENT_TIMESTAMP bergantung padanya.
pool.on('connection', (conn) => { conn.query(`SET time_zone = '${ZONA}'`); });

const ambilKoneksi = () => new Promise((resolve, reject) => pool.getConnection((e, c) => (e ? reject(e) : resolve(c))));

function bentukHasil(sql, type, opsi, data) {
  let hasil;
  const sisip = type === QueryTypes.INSERT
    || (sql.toLowerCase().startsWith('insert into') && (!data || Object.prototype.hasOwnProperty.call(data, 'insertId')));
  if (sisip) hasil = data.insertId;
  if (type === QueryTypes.SELECT) {
    const baris = data.map((r) => Object.assign({}, r));
    return opsi.plain ? (baris.length === 0 ? null : baris[0]) : baris;
  }
  if (sql.toLowerCase().startsWith('call')) return data[0];
  if (type === QueryTypes.BULKUPDATE || type === QueryTypes.BULKDELETE) return data.affectedRows;
  if (type === QueryTypes.UPSERT) return [hasil, data.affectedRows === 1];
  if (sisip || type === QueryTypes.UPDATE) return [hasil, data.affectedRows];
  if (type === QueryTypes.RAW) return [data, data];
  return hasil;
}

async function query(sql, options = {}) {
  const opsi = { ...options };
  if (!opsi.type) opsi.type = opsi.nest || opsi.plain ? QueryTypes.SELECT : QueryTypes.RAW;
  if (typeof sql === 'object') {
    if (sql.values !== undefined) opsi.replacements = sql.values;
    if (sql.query !== undefined) sql = sql.query;
  }
  sql = sql.trim();
  if (opsi.bind) throw new Error('Opsi `bind` tidak didukung; gunakan `replacements`.');
  if (opsi.replacements) sql = injectReplacements(sql, opsi.replacements);

  const trx = opsi.transaction;
  if (trx && trx.finished && !opsi.completesTransaction) {
    const e = new Error(`${trx.finished} has been called on this transaction(${trx.id}), you can no longer use it. (The rejected query is attached as the 'sql' property of this error)`);
    e.sql = sql;
    throw e;
  }
  const conn = trx ? trx.connection : await ambilKoneksi();
  const tumpukan = new Error().stack;
  try {
    const data = await new Promise((resolve, reject) => {
      conn.query({ sql }, (e, r) => (e ? reject(e) : resolve(r)));
    });
    return bentukHasil(sql, opsi.type, opsi, data);
  } catch (err) {
    if (trx && err.errno === ER_DEADLOCK) {
      try { await trx.rollback(); } catch { /* sama dengan Sequelize: diabaikan */ }
      trx.finished = 'rollback';
    }
    err.sql = sql;
    err.parameters = undefined;
    throw formatError(err, tumpukan);
  } finally {
    if (!trx) conn.release();
  }
}

let nomorTrx = 0;
class Transaction {
  constructor() {
    this.id = `trx-${Date.now()}-${++nomorTrx}`;
    this.connection = null;
    this.finished = undefined;
  }

  async mulai() {
    this.connection = await ambilKoneksi();
    try {
      await query('START TRANSACTION;', { transaction: this });
    } catch (e) {
      try { await this.rollback(); } finally { throw e; } // eslint-disable-line no-unsafe-finally
    }
  }

  lepas(hancurkan) {
    if (!this.connection || this.dilepas) return;
    this.dilepas = true;
    if (hancurkan) this.connection.destroy(); else this.connection.release();
  }

  async commit() {
    if (this.finished) throw new Error(`Transaction cannot be committed because it has been finished with state: ${this.finished}`);
    try {
      const janji = query('COMMIT;', { transaction: this, completesTransaction: true });
      this.finished = 'commit';
      await janji;
      this.lepas(false);
    } catch (e) {
      logger.warn(`Committing transaction ${this.id} failed with error ${JSON.stringify(e.message)}. Koneksinya diputus.`);
      this.lepas(true);
      throw e;
    } finally {
      this.finished = 'commit';
    }
  }

  async rollback() {
    if (this.finished) throw new Error(`Transaction cannot be rolled back because it has been finished with state: ${this.finished}`);
    if (!this.connection) throw new Error('Transaction cannot be rolled back because it never started');
    try {
      const janji = query('ROLLBACK;', { transaction: this, completesTransaction: true });
      this.finished = 'rollback';
      await janji;
      this.lepas(false);
    } catch (e) {
      logger.warn(`Rolling back transaction ${this.id} failed with error ${JSON.stringify(e.message)}. Koneksinya diputus.`);
      this.lepas(true);
      throw e;
    }
  }
}

// transaction() → transaksi manual; transaction(async (t) => ...) → commit/rollback otomatis.
async function transaction(options, callback) {
  if (typeof options === 'function') callback = options;
  const t = new Transaction();
  await t.mulai();
  if (!callback) return t;
  let hasil;
  try {
    hasil = await callback(t);
  } catch (err) {
    try { await t.rollback(); } catch { /* diabaikan, seperti Sequelize */ }
    throw err;
  }
  await t.commit();
  return hasil;
}

const authenticate = () => query('SELECT 1+1 AS result');
const close = () => new Promise((resolve, reject) => pool.end((e) => (e ? reject(e) : resolve())));

authenticate()
  .then(() => logger.info('✅ Database connection established successfully'))
  .catch((err) => logger.error('❌ Unable to connect to the database:', err));

module.exports = { query, transaction, authenticate, close, QueryTypes, injectReplacements, escape };
