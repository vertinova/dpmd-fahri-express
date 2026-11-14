#!/usr/bin/env node
/**
 * Membandingkan skema MySQL dengan PostgreSQL: tabel, kolom, kategori tipe, nullability, indeks UNIQUE.
 *   node scripts/pg/cek-skema.js <mysqlUrl> <pgUrl> [dump.sql]
 * dump.sql (opsional): dump mysqldump; hanya tabel/kolomnya yang diperiksa keberadaannya di PG.
 * Exit 1 bila ada tabel/kolom/unique MySQL yang tidak punya tempat di PG. Perbedaan tipe/nullability dilaporkan
 * sebagai selisih juga dan ikut menggagalkan.
 * PG dibaca lewat psql (modul `pg` tidak terpasang): env PSQL menimpa jalur bawaan Laragon.
 */
const fs = require('fs');
const { execFileSync } = require('child_process');

const [mysqlUrl, pgUrl, dumpPath] = process.argv.slice(2);
if (!mysqlUrl || !pgUrl) { console.error('pakai: cek-skema.js <mysqlUrl> <pgUrl> [dump.sql]'); process.exit(2); }
const PSQL = process.env.PSQL || (process.platform === 'win32' ? 'C:/laragon/bin/postgresql/postgresql-16.4/bin/psql.exe' : 'psql');

function psqlJson(sql) {
  const u = new URL(pgUrl);
  const out = execFileSync(PSQL, ['-h', u.hostname, '-p', u.port || '5432', '-U', decodeURIComponent(u.username || 'postgres'), '-d', u.pathname.slice(1), '-Atq', '-c', sql],
    { encoding: 'utf8', maxBuffer: 1 << 28, env: { ...process.env, PGPASSWORD: decodeURIComponent(u.password) } });
  return JSON.parse(out.trim() || '[]');
}

const KAT = { // kategori tipe MySQL -> udt_name PG yang diterima
  teks: ['citext', 'text', 'varchar', 'bpchar'], bool: ['bool'], int: ['int2', 'int4', 'int8'], waktu: ['timestamp'], date: ['date'],
  time: ['time'], decimal: ['numeric'], dbl: ['float8'], json: ['jsonb', 'json'], blob: ['bytea'],
};
function kategori(dt, ct) {
  if (/^(var)?char$|text$/.test(dt)) return 'teks';
  if (dt === 'enum') return 'enum';
  if (dt === 'tinyint' && /^tinyint\(1\)/.test(ct)) return 'bool';
  if (/int$|^year$/.test(dt)) return 'int';
  if (dt === 'datetime' || dt === 'timestamp') return 'waktu';
  if (dt === 'date') return 'date';
  if (dt === 'time') return 'time';
  if (dt === 'decimal') return 'decimal';
  if (dt === 'double' || dt === 'float') return 'dbl';
  if (dt === 'json') return 'json';
  if (/blob$|binary$/.test(dt)) return 'blob';
  return '?' + dt;
}

(async () => {
  const mysql = require('mysql2/promise');
  const u = new URL(mysqlUrl); const db = u.pathname.slice(1);
  const conn = await mysql.createConnection({ host: u.hostname, port: Number(u.port) || 3306, user: decodeURIComponent(u.username), password: decodeURIComponent(u.password), database: db });
  const [cols] = await conn.query(`SELECT c.TABLE_NAME t, COLUMN_NAME c, DATA_TYPE dt, COLUMN_TYPE ct, IS_NULLABLE nl, NUMERIC_PRECISION p, NUMERIC_SCALE sc
      FROM information_schema.COLUMNS c JOIN information_schema.TABLES tb ON tb.TABLE_SCHEMA=c.TABLE_SCHEMA AND tb.TABLE_NAME=c.TABLE_NAME
      WHERE c.TABLE_SCHEMA=? AND tb.TABLE_TYPE='BASE TABLE' ORDER BY c.TABLE_NAME, ORDINAL_POSITION`, [db]);
  const [stat] = await conn.query(`SELECT TABLE_NAME t, INDEX_NAME i, COLUMN_NAME c, SEQ_IN_INDEX s FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA=? AND NON_UNIQUE=0 ORDER BY TABLE_NAME, INDEX_NAME, SEQ_IN_INDEX`, [db]);
  await conn.end();

  const pgCols = psqlJson(`select coalesce(json_agg(r),'[]') from (select c.table_name t, c.column_name c, c.udt_name u, c.is_nullable nl, c.numeric_precision p, c.numeric_scale sc,
      (select coalesce(json_agg(e.enumlabel order by e.enumsortorder),'[]') from pg_enum e join pg_type ty on ty.oid=e.enumtypid where ty.typname=c.udt_name) ev
      from information_schema.columns c join information_schema.tables tb using (table_schema, table_name)
      where c.table_schema='public' and tb.table_type='BASE TABLE') r`);
  const pgUniq = psqlJson(`select coalesce(json_agg(r),'[]') from (select cl.relname t, (select json_agg(a.attname order by k.ord) from unnest(i.indkey) with ordinality k(attnum, ord)
      join pg_attribute a on a.attrelid=cl.oid and a.attnum=k.attnum) cs from pg_index i join pg_class cl on cl.oid=i.indrelid join pg_namespace n on n.oid=cl.relnamespace
      where n.nspname='public' and i.indisunique) r`);
  const pgChecks = psqlJson(`select coalesce(json_agg(r),'[]') from (select cl.relname t, pg_get_constraintdef(c.oid) d from pg_constraint c join pg_class cl on cl.oid=c.conrelid
      join pg_namespace n on n.oid=cl.relnamespace where n.nspname='public' and c.contype='c') r`);

  const pgTab = new Map();
  for (const r of pgCols) { if (!pgTab.has(r.t)) pgTab.set(r.t, new Map()); pgTab.get(r.t).set(r.c, r); }
  const uniq = new Map(); // t -> Set('a,b')
  for (const r of pgUniq) { if (!uniq.has(r.t)) uniq.set(r.t, new Set()); uniq.get(r.t).add([...r.cs].sort().join(',')); }
  const checks = new Map();
  for (const r of pgChecks) checks.set(r.t, (checks.get(r.t) || '') + r.d + '\n');

  const fatal = []; const lain = [];
  const myTab = new Set(cols.map((r) => r.t));
  for (const r of cols) {
    const pt = pgTab.get(r.t);
    if (!pt) { if (!fatal.includes(`tabel hilang: ${r.t}`)) fatal.push(`tabel hilang: ${r.t}`); continue; }
    const p = pt.get(r.c);
    if (!p) { fatal.push(`kolom hilang: ${r.t}.${r.c}`); continue; }
    const kat = kategori(String(r.dt).toLowerCase(), String(r.ct).toLowerCase());
    if (kat === 'enum') {
      const vals = [...String(r.ct).slice(5, -1).matchAll(/'((?:[^']|'')*)'/g)].map((m) => m[1].replace(/''/g, "'"));
      if (p.ev && p.ev.length) { if (JSON.stringify(p.ev) !== JSON.stringify(vals)) lain.push(`enum beda nilai: ${r.t}.${r.c} mysql=${vals} pg=${p.ev}`); }
      else if (p.u !== 'citext' || !vals.every((v) => (checks.get(r.t) || '').includes(`'${v.replace(/'/g, "''")}'`))) lain.push(`enum tanpa padanan: ${r.t}.${r.c} (pg ${p.u})`);
    } else if (!KAT[kat] || !KAT[kat].includes(p.u)) lain.push(`tipe beda: ${r.t}.${r.c} mysql=${r.ct} pg=${p.u}`);
    else if (kat === 'decimal' && (Number(r.p) !== p.p || Number(r.sc) !== p.sc)) lain.push(`decimal beda: ${r.t}.${r.c} mysql=${r.ct} pg=${p.p},${p.sc}`);
    if ((r.nl === 'YES') !== (p.nl === 'YES')) lain.push(`nullability beda: ${r.t}.${r.c} mysql=${r.nl} pg=${p.nl}`);
  }
  const mu = new Map();
  for (const r of stat) { const k = r.t + '|' + r.i; if (!mu.has(k)) mu.set(k, { t: r.t, i: r.i, cs: [] }); mu.get(k).cs.push(r.c); }
  for (const { t, i, cs } of mu.values()) {
    if (!myTab.has(t) || !pgTab.has(t)) continue;
    if (!(uniq.get(t) || new Set()).has([...cs].sort().join(','))) fatal.push(`unique hilang: ${t}.${i} (${cs})`);
  }

  console.log(`MySQL: ${myTab.size} tabel, ${cols.length} kolom, ${mu.size} indeks unik; PG: ${pgTab.size} tabel`);
  fatal.forEach((x) => console.log('FATAL ' + x));
  lain.forEach((x) => console.log('SELISIH ' + x));
  console.log(`ringkasan: fatal=${fatal.length} selisih-lain=${lain.length}`);

  let dumpHilang = 0;
  if (dumpPath) {
    const dump = fs.readFileSync(dumpPath, 'utf8'); let tabel = null; let nt = 0; let nk = 0;
    for (const l of dump.split(/\r?\n/)) {
      const m = /^CREATE TABLE `([^`]+)`/.exec(l);
      if (m) { tabel = m[1]; nt++; if (!pgTab.has(tabel)) { console.log(`DUMP tabel tidak ada di PG: ${tabel}`); dumpHilang++; tabel = null; } continue; }
      if (!tabel) continue;
      if (/^\) ENGINE/.test(l)) { tabel = null; continue; }
      const c = /^\s+`([^`]+)`\s/.exec(l);
      if (c) { nk++; if (!pgTab.get(tabel).has(c[1])) { console.log(`DUMP kolom tidak ada di PG: ${tabel}.${c[1]}`); dumpHilang++; } }
    }
    console.log(`dump: ${nt} tabel, ${nk} kolom diperiksa; hilang di PG: ${dumpHilang}`);
  }
  process.exit(fatal.length + lain.length + dumpHilang ? 1 : 0);
})().catch((e) => { console.error(e.stack || e.message); process.exit(2); });
