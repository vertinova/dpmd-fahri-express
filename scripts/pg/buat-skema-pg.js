#!/usr/bin/env node
/**
 * Membangkitkan skema PostgreSQL dari prisma/schema.prisma (MySQL):
 *   - prisma/postgres/schema.prisma
 *   - prisma/postgres/baseline.sql
 * Deterministik. Gagal keras (exit 1) bila menemui atribut @db.* / dbgenerated()
 * yang tidak ada di tabel pemetaan.
 *
 * Bagian e/f/g baseline dibangkitkan dari information_schema MySQL lokal:
 *   node scripts/pg/buat-skema-pg.js [mysqlUrl]   (atau env MYSQL_URL; bawaan root@localhost/dpmd)
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const SRC = path.join(ROOT, 'prisma', 'schema.prisma');
const OUT_DIR = path.join(ROOT, 'prisma', 'postgres');
const MYSQL_URL = process.argv[2] || process.env.MYSQL_URL || 'mysql://root:@localhost:3306/dpmd';

const fail = (m) => { console.error('GAGAL: ' + m); process.exit(1); };
const q = (s) => '"' + String(s).replace(/"/g, '""') + '"';
const lit = (s) => "'" + String(s).replace(/'/g, "''") + "'";
// Nama objek PG maksimal 63 karakter; bila terpotong tambahkan hash pendek agar unik.
const nama63 = (n) => (n.length <= 63 ? n : n.slice(0, 54) + '_' + crypto.createHash('md5').update(n).digest('hex').slice(0, 8));

// ---------- 1. Pemetaan atribut native ----------
const STRING_NATIVE = new Set(['VarChar', 'Char', 'Text', 'LongText', 'MediumText', 'TinyText']);
function petakanNative(baseType, nama, args) {
  const a = args ? `(${args})` : '';
  if (baseType === 'String') {
    if (STRING_NATIVE.has(nama)) return '@db.Citext';
    fail(`@db.${nama} pada String tidak dikenal`);
  }
  const tabel = {
    UnsignedBigInt: null, BigInt: null,
    UnsignedInt: '@db.Integer', UnsignedSmallInt: '@db.Integer', MediumInt: '@db.Integer',
    UnsignedMediumInt: '@db.Integer', Year: '@db.Integer', Int: '@db.Integer',
    UnsignedTinyInt: '@db.SmallInt', SmallInt: '@db.SmallInt',
    DateTime: `@db.Timestamp${a || '(0)'}`, Timestamp: `@db.Timestamp${a}`,
    Date: '@db.Date', Time: `@db.Time${a}`, Decimal: `@db.Decimal${a}`,
    Double: null, Float: null,
    Blob: null, LongBlob: null, MediumBlob: null, TinyBlob: null, Binary: null, VarBinary: null,
  };
  if (nama === 'TinyInt') return baseType === 'Boolean' ? null : '@db.SmallInt';
  if (!(nama in tabel)) fail(`@db.${nama}${a} pada ${baseType} tidak ada di tabel pemetaan`);
  return tabel[nama];
}
const DBGEN = { '(now())': '@default(now())', 'now()': '@default(now())', '(curdate())': '@default(dbgenerated("CURRENT_DATE"))', '(curtime())': '@default(dbgenerated("CURRENT_TIME"))' };

// ---------- 2. Baca & ubah schema ----------
const src = fs.readFileSync(SRC, 'utf8');
if (src.includes('\r')) fail('schema.prisma ber-CRLF; generator mengira LF');
const lines = src.split('\n');

// lintasan 1: nama model, tabel, bidang
const modelNames = new Set();
for (const l of lines) { const m = /^model\s+(\w+)\s*\{/.exec(l); if (m) modelNames.add(m[1]); }
const models = []; // {name, table, columns:Set, start, end}
{
  let cur = null;
  lines.forEach((l, i) => {
    const m = /^model\s+(\w+)\s*\{/.exec(l);
    if (m) { cur = { name: m[1], table: m[1], columns: new Set(), opsional: new Set(), fieldMap: new Map(), start: i }; return; }
    if (!cur) return;
    if (l.startsWith('}')) { cur.end = i; models.push(cur); cur = null; return; }
    const mm = /^\s*@@map\("([^"]+)"\)/.exec(l);
    if (mm) { cur.table = mm[1]; return; }
    const f = /^\s+(\w+)\s+(\w+)(\[\]|\?)?/.exec(l);
    if (f && !l.trim().startsWith('@@') && !l.trim().startsWith('//') && !modelNames.has(f[2])) {
      const mp = /@map\("([^"]+)"\)/.exec(l);
      cur.columns.add(mp ? mp[1] : f[1]);
      if (f[3] === '?') cur.opsional.add(mp ? mp[1] : f[1]);
      if (mp) cur.fieldMap.set(f[1], mp[1]);
    }
  });
}
const modelOf = new Map(); // nomor baris -> model
for (const m of models) for (let i = m.start; i <= m.end; i++) modelOf.set(i, m);

// nama indeks (bukan FK) yang dipakai >1 model
const isIndexMapLine = (l) => /map:\s*"/.test(l) && !/@relation\(/.test(l);
const namaDipakai = new Map();
lines.forEach((l, i) => {
  if (!isIndexMapLine(l) || !modelOf.has(i)) return;
  for (const m of l.matchAll(/map:\s*"([^"]+)"/g)) {
    if (!namaDipakai.has(m[1])) namaDipakai.set(m[1], new Set());
    namaDipakai.get(m[1]).add(modelOf.get(i).name);
  }
});
const kembar = new Set([...namaDipakai].filter(([, s]) => s.size > 1).map(([n]) => n));

const checkPanjang = []; // {table, column, n}
const namaSetelah = new Map(); // nama indeks akhir -> model (cek tabrakan)
const out = [];
lines.forEach((l, i) => {
  const mod = modelOf.get(i);
  if (!mod || i === mod.start || i === mod.end) { out.push(l); return; }
  const t = l.trim();
  if (t.startsWith('//')) { out.push(l); return; }
  // nama indeks kembar
  if (isIndexMapLine(l)) {
    l = l.replace(/map:\s*"([^"]+)"/g, (all, n) => (kembar.has(n) ? `map: "${nama63(`${mod.table}_${n}`)}"` : all));
    for (const m of l.matchAll(/map:\s*"([^"]+)"/g)) {
      const k = m[1];
      if (namaSetelah.has(k) && namaSetelah.get(k) !== mod.name) fail(`nama indeks ${k} masih kembar (${namaSetelah.get(k)}, ${mod.name})`);
      namaSetelah.set(k, mod.name);
    }
  }
  const f = /^(\s+)(\w+)(\s+)(\w+)(\[\]|\?)?(.*)$/.exec(l);
  if (!f || t.startsWith('@@') || modelNames.has(f[4])) { out.push(l); return; }
  const [, ind, fname, sp, base, mod2 = '', rest0] = f;
  let rest = rest0, komentar = '';
  const ck = / \/\/.*$/.exec(rest);
  if (ck) { komentar = ck[0]; rest = rest.slice(0, ck.index); }
  // dbgenerated
  rest = rest.replace(/@default\(dbgenerated\("((?:[^"\\]|\\.)*)"\)\)/g, (all, e) => {
    if (!(e in DBGEN)) fail(`dbgenerated("${e}") tidak ada di tabel pemetaan (${mod.name}.${fname})`);
    return DBGEN[e];
  });
  // atribut native
  let ditulis = false;
  rest = rest.replace(/\s*@db\.(\w+)(?:\(([^)]*)\))?/g, (all, nama, args) => {
    if (base === 'String') {
      const mm = /^(VarChar|Char)$/.test(nama) && args ? Number(args) : null;
      if (mm) checkPanjang.push({ table: mod.table, column: (/@map\("([^"]+)"\)/.exec(rest0) || [])[1] || fname, n: mm });
    }
    const hasil = petakanNative(base, nama, args);
    if (hasil) { ditulis = true; return ' ' + hasil; }
    return '';
  });
  if (base === 'String' && !ditulis) rest += ' @db.Citext';
  out.push(`${ind}${fname}${sp}${base}${mod2}${rest.replace(/\s+$/, '')}${komentar}`);
});

// Validator Prisma menolak nama FK sama dengan nama indeks pada model yang sama: FK diberi sufiks _fk.
const fkDiganti = [];
for (const m of models) {
  const idxNama = new Set();
  for (let i = m.start; i <= m.end; i++) if (isIndexMapLine(out[i])) for (const x of out[i].matchAll(/map:\s*"([^"]+)"/g)) idxNama.add(x[1]);
  for (let i = m.start; i <= m.end; i++) {
    if (!/@relation\(/.test(out[i])) continue;
    const fl = /fields:\s*\[([^\]]*)\]/.exec(out[i]);
    if (fl && !/map:\s*"/.test(out[i])) { // nama FK bawaan Prisma: <tabel>_<kolom>_fkey
      const kolom = fl[1].split(',').map((x) => x.trim()).map((x) => m.fieldMap.get(x) || x);
      const bawaan = `${m.table}_${kolom.join('_')}_fkey`;
      if (idxNama.has(bawaan)) {
        fkDiganti.push(`${m.table}.${bawaan}`);
        out[i] = out[i].replace(/(@relation\([^)]*)\)/, `$1, map: "${nama63(bawaan + '_fk')}")`);
      }
      continue;
    }
    out[i] = out[i].replace(/map:\s*"([^"]+)"/, (all, n) => {
      if (!idxNama.has(n)) return all;
      fkDiganti.push(`${m.table}.${n}`);
      return `map: "${nama63(n + '_fk')}"`;
    });
  }
}

// header: generator + datasource
let skema = out.join('\n');
if (!/generator client \{/.test(skema)) fail('blok generator tidak ditemukan'); // tanpa output: lokasi bawaan
skema = skema.replace(/(datasource db \{[^}]*?provider\s*=\s*)"mysql"/, '$1"postgresql"');
if (!/provider\s*=\s*"postgresql"/.test(skema)) fail('blok datasource tidak ditemukan');
fs.mkdirSync(OUT_DIR, { recursive: true });
const SKEMA_PG = path.join(OUT_DIR, 'schema.prisma');
fs.writeFileSync(SKEMA_PG, skema);

// ---------- 3. DDL Prisma ----------
const prismaJs = require.resolve('prisma/build/index.js', { paths: [ROOT] });
const ddlPrisma = execFileSync(process.execPath, [prismaJs, 'migrate', 'diff', '--from-empty', '--to-schema-datamodel', 'prisma/postgres/schema.prisma', '--script'],
  { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 28 }).replace(/\r\n/g, '\n');
if (!/CREATE TABLE/.test(ddlPrisma)) fail('prisma migrate diff tidak menghasilkan DDL');

// ---------- 4. Bagian dari MySQL ----------
function petakanKolom(c) {
  // c: {dt, ct, len, prec, scale, dtp, def, extra, nullable}
  const unsigned = /unsigned/.test(c.ct);
  let tipe, cek = null, enumVals = null;
  switch (c.dt) {
    case 'varchar': case 'char': tipe = 'citext'; cek = c.len; break;
    case 'text': case 'tinytext': case 'mediumtext': case 'longtext': tipe = 'citext'; break;
    case 'enum': tipe = 'citext'; enumVals = [...c.ct.slice(5, -1).matchAll(/'((?:[^']|'')*)'/g)].map((m) => m[1].replace(/''/g, "'")); break;
    case 'tinyint': tipe = /^tinyint\(1\)/.test(c.ct) ? 'boolean' : 'smallint'; break;
    case 'smallint': tipe = unsigned ? 'integer' : 'smallint'; break;
    case 'mediumint': case 'int': case 'year': tipe = 'integer'; break;
    case 'bigint': tipe = 'bigint'; break;
    case 'datetime': case 'timestamp': tipe = `timestamp(${c.dtp || 0})`; break;
    case 'date': tipe = 'date'; break;
    case 'time': tipe = `time(${c.dtp || 0})`; break;
    case 'decimal': tipe = `decimal(${c.prec},${c.scale})`; break;
    case 'double': case 'float': tipe = 'double precision'; break;
    case 'json': tipe = 'jsonb'; break;
    case 'blob': case 'tinyblob': case 'mediumblob': case 'longblob': case 'binary': case 'varbinary': tipe = 'bytea'; break;
    default: fail(`tipe MySQL ${c.dt} (${c.ct}) tidak dikenal`);
  }
  let sql = tipe;
  if (/auto_increment/.test(c.extra)) {
    if (!/int/.test(c.dt)) fail('auto_increment pada non-integer');
    sql += ' GENERATED BY DEFAULT AS IDENTITY';
  }
  if (!c.nullable) sql += ' NOT NULL';
  const gen = /DEFAULT_GENERATED/.test(c.extra);
  if (c.def !== null && c.def !== undefined) {
    if (gen) {
      if (/^CURRENT_TIMESTAMP/i.test(c.def) && /^timestamp/.test(tipe)) sql += ' DEFAULT CURRENT_TIMESTAMP';
      else fail(`default ekspresi tidak dikenal: ${c.def}`);
    } else if (tipe === 'boolean') sql += ` DEFAULT ${c.def === '0' ? 'false' : 'true'}`;
    else if (/^(smallint|integer|bigint|decimal|double)/.test(tipe)) sql += ` DEFAULT ${c.def}`;
    else sql += ` DEFAULT ${lit(c.def)}`;
  }
  return { sql, cek, enumVals };
}

(async () => {
  const mysql = require('mysql2/promise');
  const u = new URL(MYSQL_URL);
  const db = u.pathname.slice(1);
  const conn = await mysql.createConnection({ host: u.hostname, port: Number(u.port) || 3306, user: decodeURIComponent(u.username), password: decodeURIComponent(u.password), database: db });
  const [cols] = await conn.query(
    `SELECT TABLE_NAME t, COLUMN_NAME c, DATA_TYPE dt, COLUMN_TYPE ct, CHARACTER_MAXIMUM_LENGTH len, NUMERIC_PRECISION prec,
            NUMERIC_SCALE scale, DATETIME_PRECISION dtp, COLUMN_DEFAULT def, EXTRA extra, IS_NULLABLE nl
       FROM information_schema.COLUMNS c JOIN information_schema.TABLES tb USING (TABLE_SCHEMA, TABLE_NAME)
      WHERE TABLE_SCHEMA = ? AND TABLE_TYPE = 'BASE TABLE' ORDER BY TABLE_NAME, ORDINAL_POSITION`, [db]);
  const [stat] = await conn.query(
    `SELECT TABLE_NAME t, INDEX_NAME i, NON_UNIQUE nu, SEQ_IN_INDEX s, COLUMN_NAME c, COLLATION co, INDEX_TYPE ty, SUB_PART sp
       FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = ? ORDER BY TABLE_NAME, INDEX_NAME, SEQ_IN_INDEX`, [db]);
  const [fks] = await conn.query(
    `SELECT TABLE_NAME t, CONSTRAINT_NAME n, COLUMN_NAME c, REFERENCED_TABLE_NAME rt, REFERENCED_COLUMN_NAME rc
       FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA = ? AND REFERENCED_TABLE_NAME IS NOT NULL ORDER BY TABLE_NAME, CONSTRAINT_NAME, ORDINAL_POSITION`, [db]);
  await conn.end();

  const byTable = new Map();
  for (const r of cols) {
    if (!byTable.has(r.t)) byTable.set(r.t, []);
    byTable.get(r.t).push({ name: r.c, dt: String(r.dt).toLowerCase(), ct: String(r.ct), len: r.len === null ? null : Number(r.len), prec: r.prec, scale: r.scale, dtp: r.dtp, def: r.def, extra: String(r.extra), nullable: r.nl === 'YES' });
  }
  const prismaTabel = new Map(models.map((m) => [m.table, m]));
  const luarPrisma = [...byTable.keys()].filter((t) => !prismaTabel.has(t));

  const sql = [];
  const P = (s = '') => sql.push(s);
  P('-- Baseline PostgreSQL DPMD. DIBANGKITKAN oleh scripts/pg/buat-skema-pg.js; jangan disunting tangan.');
  P('-- (a) citext + operator citext/text (spike E4)');
  P('CREATE EXTENSION IF NOT EXISTS citext;');
  P(`CREATE FUNCTION citext_eq_text(citext, text) RETURNS boolean LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE AS 'SELECT $1 = $2::citext';
CREATE FUNCTION text_eq_citext(text, citext) RETURNS boolean LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE AS 'SELECT $1::citext = $2';
CREATE FUNCTION citext_ne_text(citext, text) RETURNS boolean LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE AS 'SELECT $1 <> $2::citext';
CREATE OPERATOR = (LEFTARG = citext, RIGHTARG = text, FUNCTION = citext_eq_text, COMMUTATOR = =, NEGATOR = <>, RESTRICT = eqsel, JOIN = eqjoinsel);
CREATE OPERATOR = (LEFTARG = text, RIGHTARG = citext, FUNCTION = text_eq_citext, COMMUTATOR = =, RESTRICT = eqsel, JOIN = eqjoinsel);
CREATE OPERATOR <> (LEFTARG = citext, RIGHTARG = text, FUNCTION = citext_ne_text, NEGATOR = =, RESTRICT = neqsel, JOIN = neqjoinsel);`);
  P();
  P('-- (b) fungsi trigger pengganti ON UPDATE CURRENT_TIMESTAMP (dibuat per nama kolom pada bagian (f))');
  const fungsiTrigger = new Map(); // kolom -> nama fungsi
  const trigger = []; // {t, c}
  for (const [t, cs] of byTable) for (const c of cs) if (/on update/i.test(c.extra)) trigger.push({ t, c: c.name });
  const kolomTrigger = [...new Set(trigger.map((x) => x.c))].sort();
  for (const c of kolomTrigger) {
    const fn = c === 'updated_at' ? 'set_updated_at' : `set_${c}`;
    fungsiTrigger.set(c, fn);
    P(`CREATE FUNCTION ${fn}() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF ROW(NEW.*) IS DISTINCT FROM ROW(OLD.*)
     AND NEW.${q(c)} IS NOT DISTINCT FROM OLD.${q(c)} THEN
    NEW.${q(c)} := CURRENT_TIMESTAMP;
  END IF;
  RETURN NEW;
END $$;`);
  }
  P();
  P('-- (c) DDL Prisma (prisma migrate diff --from-empty)');
  P(ddlPrisma.trimEnd());
  P();

  const dipakai = new Set([...ddlPrisma.matchAll(/(?:CREATE (?:UNIQUE )?INDEX|CONSTRAINT) "([^"]+)"/g)].map((m) => m[1]));
  const namaCek = new Set();
  const cekSql = (t, c, ekspr, sufiks) => {
    const n = nama63(`${t}_${c}_${sufiks}`);
    if (namaCek.has(t + '|' + n)) fail(`nama CHECK kembar: ${n}`);
    namaCek.add(t + '|' + n);
    return `ALTER TABLE ${q(t)} ADD CONSTRAINT ${q(n)} CHECK (${ekspr});`;
  };

  P('-- (d) CHECK panjang untuk kolom VarChar(n)/Char(n) model Prisma (citext tidak punya batas)');
  for (const c of checkPanjang) P(cekSql(c.table, c.column, `char_length(${q(c.column)}) <= ${c.n}`, 'len'));
  P();

  P('-- (e) TABEL DI LUAR PRISMA (dibangkitkan dari information_schema MySQL lokal; FK dilewati)');
  const idxPerTabel = new Map();
  for (const r of stat) { const k = r.t; if (!idxPerTabel.has(k)) idxPerTabel.set(k, new Map()); const m = idxPerTabel.get(k); if (!m.has(r.i)) m.set(r.i, []); m.get(r.i).push(r); }
  const lewati = [];
  for (const t of luarPrisma) {
    const cs = byTable.get(t);
    const idx = idxPerTabel.get(t) || new Map();
    const pk = idx.get('PRIMARY');
    const baris = []; const tambahan = [];
    for (const c of cs) {
      const m = petakanKolom(c);
      baris.push(`  ${q(c.name)} ${m.sql}`);
      if (m.cek) tambahan.push(cekSql(t, c.name, `char_length(${q(c.name)}) <= ${m.cek}`, 'len'));
      if (m.enumVals) tambahan.push(cekSql(t, c.name, `${q(c.name)} IN (${m.enumVals.map(lit).join(', ')})`, 'enum'));
    }
    if (pk) baris.push(`  PRIMARY KEY (${pk.map((r) => q(r.c)).join(', ')})`);
    P(`CREATE TABLE ${q(t)} (\n${baris.join(',\n')}\n);`);
    tambahan.forEach((s) => P(s));
    for (const [nama, rs] of idx) {
      if (nama === 'PRIMARY') continue;
      if (rs.some((r) => r.c === null) || rs[0].ty === 'FULLTEXT' || rs[0].ty === 'SPATIAL') { lewati.push(`${t}.${nama} (${rs[0].ty})`); continue; }
      let n = nama;
      if (dipakai.has(n)) n = nama63(`${t}_${nama}`);
      if (dipakai.has(n)) fail(`nama indeks ${n} bentrok`);
      dipakai.add(n);
      P(`CREATE ${rs[0].nu === 0 || rs[0].nu === '0' ? 'UNIQUE ' : ''}INDEX ${q(n)} ON ${q(t)} (${rs.map((r) => q(r.c) + (r.co === 'D' ? ' DESC' : '')).join(', ')});`);
    }
  }
  const fkLuar = fks.filter((f) => !prismaTabel.has(f.t));
  if (fkLuar.length) P(`-- FK dilewati pada tabel di luar Prisma: ${[...new Set(fkLuar.map((f) => `${f.t}.${f.n}`))].join(', ')}`);
  if (lewati.length) P(`-- Indeks dilewati (fulltext/fungsional): ${lewati.join(', ')}`);
  P();

  P('-- (f) trigger pengganti ON UPDATE CURRENT_TIMESTAMP (menurut EXTRA MySQL lokal)');
  for (const x of trigger) P(`CREATE TRIGGER ${q(nama63(`trg_${x.t}_${x.c}`))} BEFORE UPDATE ON ${q(x.t)} FOR EACH ROW EXECUTE FUNCTION ${fungsiTrigger.get(x.c)}();`);
  P();

  P('-- (g) KOLOM YATIM: ada di MySQL tetapi tidak ada di model Prisma (agar tidak ada data hilang)');
  const yatim = []; const notNull = [];
  for (const m of [...models].sort((a, b) => (a.table < b.table ? -1 : 1))) {
    for (const c of byTable.get(m.table) || []) {
      if (m.columns.has(c.name)) {
        // NOT NULL di MySQL tetapi opsional di Prisma: samakan perilaku tulis dengan MySQL
        if (!c.nullable && m.opsional.has(c.name)) { notNull.push(`${m.table}.${c.name}`); P(`ALTER TABLE ${q(m.table)} ALTER COLUMN ${q(c.name)} SET NOT NULL;`); }
        continue;
      }
      const pm = petakanKolom(c);
      yatim.push(`${m.table}.${c.name}`);
      P(`ALTER TABLE ${q(m.table)} ADD COLUMN ${q(c.name)} ${pm.sql};`);
      if (pm.cek) P(cekSql(m.table, c.name, `char_length(${q(c.name)}) <= ${pm.cek}`, 'len'));
      if (pm.enumVals) P(cekSql(m.table, c.name, `${q(c.name)} IN (${pm.enumVals.map(lit).join(', ')})`, 'enum'));
    }
  }
  fs.writeFileSync(path.join(OUT_DIR, 'baseline.sql'), sql.join('\n') + '\n');

  console.error(`model Prisma: ${models.length}; CHECK panjang: ${checkPanjang.length}; nama indeks kembar diganti: ${kembar.size}; FK diganti nama: ${fkDiganti.length}`);
  console.error(`tabel di luar Prisma (${luarPrisma.length}): ${luarPrisma.join(', ')}`);
  console.error(`trigger: ${trigger.length}; kolom bukan updated_at: ${kolomTrigger.filter((c) => c !== 'updated_at').join(', ') || '-'}`);
  console.error(`kolom yatim (${yatim.length}): ${yatim.join(', ') || '-'}`);
  console.error(`SET NOT NULL (${notNull.length}): ${notNull.join(', ') || '-'}`);
  console.error(`FK dilewati: ${new Set(fkLuar.map((f) => `${f.t}.${f.n}`)).size}; indeks dilewati: ${lewati.length}`);
})().catch((e) => fail(e.stack || e.message));
