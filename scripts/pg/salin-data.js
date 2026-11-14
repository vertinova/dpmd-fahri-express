#!/usr/bin/env node
/**
 * Memindahkan data MySQL -> PostgreSQL lalu membuktikan tanpa data hilang (jumlah baris + perbandingan nilai per baris).
 *   node scripts/pg/salin-data.js --mysql <url> --pg <url> [--tabel a,b] [--hanya-verifikasi]
 * MySQL dibaca (hanya baca) dalam satu snapshot konsisten; PG ditulis dalam satu transaksi dan di-ROLLBACK bila ada galat.
 * Target PG wajib kosong (kecuali --hanya-verifikasi). Tidak ada opsi hapus otomatis.
 * Exit 0 = salinan identik; 1 = ada selisih/galat; 2 = salah pakai.
 * shortcut: hanya tabel ber-PK tunggal (semua tabel produksi begitu); tabel tanpa PK / PK gabungan ditolak sebelum menyalin.
 */
const mysql = require('mysql2/promise');
const { Client } = require('pg');

const args = process.argv.slice(2);
const opt = (n) => { const i = args.indexOf('--' + n); return i < 0 ? null : args[i + 1]; };
const mysqlUrl = opt('mysql'); const pgUrl = opt('pg');
const hanyaVerifikasi = args.includes('--hanya-verifikasi');
const filter = opt('tabel') ? opt('tabel').split(',').map((s) => s.trim()).filter(Boolean) : null;
if (!mysqlUrl || !pgUrl) { console.error('pakai: salin-data.js --mysql <url> --pg <url> [--tabel a,b] [--hanya-verifikasi]'); process.exit(2); }

const BATCH = 2000;
const MAX_PARAM = 60000;
const qm = (s) => '`' + String(s).replace(/`/g, '``') + '`';
const qp = (s) => '"' + String(s).replace(/"/g, '""') + '"';
const BINER = new Set(['tinyblob', 'blob', 'mediumblob', 'longblob', 'binary', 'varbinary', 'bit']);
const detik = (t0) => ((Date.now() - t0) / 1000).toFixed(1);

function stabil(v) { // JSON dengan kunci terurut
  if (Array.isArray(v)) return '[' + v.map(stabil).join(',') + ']';
  if (v && typeof v === 'object') return '{' + Object.keys(v).sort().map((k) => JSON.stringify(k) + ':' + stabil(v[k])).join(',') + '}';
  return JSON.stringify(v);
}
const trimPecahan = (s) => (s.includes('.') ? s.replace(/0+$/, '').replace(/\.$/, '') : s);

// bentuk kanonik nilai; lado 'my' = dari MySQL (string/Buffer), 'pg' = dari PG (teks, bytea sudah hex)
function kanon(udt, v, lado) {
  if (v === null || v === undefined) return null;
  switch (udt) {
    case 'bool': return lado === 'my' ? (v === '1' ? 'true' : v === '0' ? 'false' : '?' + v) : v;
    case 'bytea': return Buffer.isBuffer(v) ? v.toString('hex') : v;
    case 'timestamp': case 'timestamptz': case 'time': return trimPecahan(v);
    case 'float8': case 'float4': return String(Number(v));
    case 'json': case 'jsonb': try { return stabil(JSON.parse(v)); } catch { return '!json:' + v; }
    default: return v;
  }
}

async function bukaMysql(url) {
  const u = new URL(url);
  const conn = await mysql.createConnection({ host: u.hostname, port: Number(u.port) || 3306, user: decodeURIComponent(u.username), password: decodeURIComponent(u.password), database: u.pathname.slice(1), timezone: '+00:00' });
  await conn.query("SET time_zone = '+00:00'");
  try { await conn.query('SET SESSION information_schema_stats_expiry = 0'); } catch { /* bukan MySQL 8 */ }
  await conn.query('SET SESSION TRANSACTION ISOLATION LEVEL REPEATABLE READ');
  await conn.query('START TRANSACTION WITH CONSISTENT SNAPSHOT');
  return { conn, db: u.pathname.slice(1) };
}

async function metadata(my, pg) {
  const [cols] = await my.conn.query(`SELECT c.TABLE_NAME t, c.COLUMN_NAME c, c.DATA_TYPE dt, c.COLUMN_KEY k, tb.AUTO_INCREMENT ai
      FROM information_schema.COLUMNS c JOIN information_schema.TABLES tb ON tb.TABLE_SCHEMA=c.TABLE_SCHEMA AND tb.TABLE_NAME=c.TABLE_NAME
      WHERE c.TABLE_SCHEMA=? AND tb.TABLE_TYPE='BASE TABLE' ORDER BY c.TABLE_NAME, c.ORDINAL_POSITION`, [my.db]);
  const [pks] = await my.conn.query(`SELECT TABLE_NAME t, COLUMN_NAME c FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=? AND INDEX_NAME='PRIMARY' ORDER BY TABLE_NAME, SEQ_IN_INDEX`, [my.db]);
  const pgc = (await pg.query(`SELECT c.table_name t, c.column_name c, c.udt_name u FROM information_schema.columns c JOIN information_schema.tables tb USING (table_schema, table_name)
      WHERE c.table_schema='public' AND tb.table_type='BASE TABLE'`)).rows;
  const seqs = (await pg.query(`SELECT table_name t, column_name c, pg_get_serial_sequence(quote_ident(table_name), column_name) s FROM information_schema.columns
      WHERE table_schema='public' AND (is_identity='YES' OR column_default LIKE 'nextval(%')`)).rows;
  const pgTab = new Map();
  for (const r of pgc) { if (!pgTab.has(r.t)) pgTab.set(r.t, new Map()); pgTab.get(r.t).set(r.c, r.u); }
  const tabel = new Map();
  for (const r of cols) {
    if (!tabel.has(r.t)) tabel.set(r.t, { nama: r.t, kolom: [], pk: [], ai: r.ai });
    tabel.get(r.t).kolom.push({ nama: r.c, biner: BINER.has(String(r.dt).toLowerCase()) });
  }
  for (const r of pks) if (tabel.has(r.t)) tabel.get(r.t).pk.push(r.c);
  const seqMap = new Map(seqs.map((r) => [r.t + '\0' + r.c, r.s]));
  return { tabel, pgTab, seqMap };
}

// pra-syarat: tabel & kolom MySQL harus ada di PG, PK tunggal
function praSyarat(tabel, pgTab) {
  const galat = [];
  for (const t of tabel.values()) {
    const p = pgTab.get(t.nama);
    if (!p) { galat.push(`tabel hilang di PG: ${t.nama}`); continue; }
    for (const k of t.kolom) { if (!p.has(k.nama)) galat.push(`kolom hilang di PG: ${t.nama}.${k.nama}`); else k.udt = p.get(k.nama); }
    if (t.pk.length !== 1) galat.push(`PK tidak tunggal (${t.pk.length} kolom), tidak didukung: ${t.nama}`);
    else if (t.kolom.find((k) => k.nama === t.pk[0]).biner) galat.push(`PK biner tidak didukung: ${t.nama}`);
  }
  return galat;
}

async function bacaBatch(my, t, terakhir) {
  const sql = `SELECT ${t.kolom.map((k) => qm(k.nama)).join(',')} FROM ${qm(t.nama)}${terakhir === null ? '' : ` WHERE ${qm(t.pk[0])} > ?`} ORDER BY ${qm(t.pk[0])} LIMIT ${BATCH}`;
  const biner = new Map(t.kolom.map((k) => [k.nama, k.biner]));
  const [rows] = await my.conn.query({ sql, values: terakhir === null ? [] : [terakhir], rowsAsArray: true,
    typeCast: (f) => { if (f.type === 'JSON') { const b = f.buffer(); return b === null ? null : b.toString('utf8'); } return biner.get(f.name) ? f.buffer() : f.string(); } });
  return rows;
}

function konversi(t, k, v, pk) {
  if (v === null) return null;
  if (k.udt === 'bool') {
    if (v === '1') return 'true';
    if (v === '0') return 'false';
    throw new Error(`nilai boolean tak dikenal '${v}' di ${t.nama}.${k.nama} (PK ${pk})`);
  }
  if (k.udt === 'bytea' && typeof v === 'string') return Buffer.from(v, 'utf8');
  return v;
}

async function sisipBatch(pg, t, rows, ip) {
  const per = Math.max(1, Math.min(rows.length, Math.floor(MAX_PARAM / t.kolom.length)));
  const nama = t.kolom.map((k) => qp(k.nama)).join(',');
  for (let i = 0; i < rows.length; i += per) {
    const potong = rows.slice(i, i + per);
    const sisip = async (rs) => {
      const vals = []; const tuple = [];
      for (const r of rs) {
        tuple.push('(' + r.map((v, j) => { vals.push(konversi(t, t.kolom[j], v, r[ip])); return '$' + vals.length; }).join(',') + ')');
      }
      await pg.query(`INSERT INTO ${qp(t.nama)} (${nama}) VALUES ${tuple.join(',')}`, vals);
    };
    await pg.query('SAVEPOINT sp');
    try { await sisip(potong); await pg.query('RELEASE SAVEPOINT sp'); continue; } catch (e) {
      await pg.query('ROLLBACK TO SAVEPOINT sp');
      // cari baris penyebab satu per satu
      for (const r of potong) {
        await pg.query('SAVEPOINT sp1');
        try { await sisip([r]); await pg.query('RELEASE SAVEPOINT sp1'); } catch (e2) {
          throw new Error(`gagal menyisip ke ${t.nama} (PK ${r[ip]}): ${e2.message}${e2.column ? ' kolom=' + e2.column : ''}${e2.constraint ? ' constraint=' + e2.constraint : ''}${e2.detail ? ' detail=' + e2.detail : ''}`);
        }
      }
      throw e; // batch gagal tetapi baris tunggal lolos: jangan lanjut diam-diam
    }
  }
}

async function salinTabel(my, pg, t) {
  const ip = t.kolom.findIndex((k) => k.nama === t.pk[0]);
  let terakhir = null; let n = 0;
  for (;;) {
    const rows = await bacaBatch(my, t, terakhir);
    if (!rows.length) break;
    await sisipBatch(pg, t, rows, ip);
    n += rows.length; terakhir = rows[rows.length - 1][ip];
    if (rows.length < BATCH) break;
  }
  return n;
}

async function atasSequence(pg, tabelList, seqMap, ai) {
  const lapor = [];
  for (const t of tabelList) {
    for (const k of t.kolom) {
      const s = seqMap.get(t.nama + '\0' + k.nama);
      if (!s) continue;
      const mx = (await pg.query(`SELECT MAX(${qp(k.nama)}) m FROM ${qp(t.nama)}`)).rows[0].m;
      const maxPlus1 = mx === null ? 1n : BigInt(mx) + 1n;
      const aiMy = t.ai === null || t.ai === undefined ? 1n : BigInt(t.ai);
      const next = aiMy > maxPlus1 ? aiMy : maxPlus1;
      if (aiMy > maxPlus1) lapor.push(`${t.nama}.${k.nama}: AUTO_INCREMENT MySQL ${aiMy} > MAX+1 ${maxPlus1}, dipakai ${aiMy}`);
      if (next > 1n) await pg.query('SELECT setval($1::regclass, $2, true)', [s, (next - 1n).toString()]);
      else await pg.query('SELECT setval($1::regclass, 1, false)', [s]);
    }
  }
  return lapor;
}

async function verifikasiTabel(my, pg, t) {
  const ip = t.kolom.findIndex((k) => k.nama === t.pk[0]);
  const udtPk = t.kolom[ip].udt;
  const sel = t.kolom.map((k) => (k.udt === 'bytea' ? `encode(${qp(k.nama)},'hex')` : `${qp(k.nama)}::text`)).join(',');
  const nMy = Number((await my.conn.query(`SELECT COUNT(*) n FROM ${qm(t.nama)}`))[0][0].n);
  const nPg = Number((await pg.query(`SELECT COUNT(*) n FROM ${qp(t.nama)}`)).rows[0].n);
  const beda = []; let nBeda = 0;
  const catat = (pk, kolom, a, b) => { nBeda++; if (beda.length < 20) beda.push({ pk, kolom, mysql: a, pg: b }); };
  if (nMy !== nPg) catat('-', '(jumlah baris)', nMy, nPg);
  let terakhir = null;
  for (;;) {
    const rows = await bacaBatch(my, t, terakhir);
    if (!rows.length) break;
    const res = (await pg.query({ text: `SELECT ${sel} FROM ${qp(t.nama)} WHERE ${qp(t.pk[0])} = ANY($1::${udtPk}[])`, values: [rows.map((r) => r[ip])], rowMode: 'array' })).rows;
    const peta = new Map(res.map((r) => [r[ip], r]));
    for (const r of rows) {
      const pk = r[ip]; const p = peta.get(pk);
      if (!p) { catat(pk, '(baris)', 'ada', 'tidak ada'); continue; }
      t.kolom.forEach((k, j) => {
        const a = kanon(k.udt, r[j], 'my'); const b = kanon(k.udt, p[j], 'pg');
        if (a !== b) catat(pk, k.nama, Buffer.isBuffer(r[j]) ? r[j].toString('hex') : r[j], p[j]);
      });
    }
    terakhir = rows[rows.length - 1][ip];
    if (rows.length < BATCH) break;
  }
  return { nMy, nPg, nBeda, beda };
}

(async () => {
  const t0 = Date.now();
  const my = await bukaMysql(mysqlUrl);
  const pg = new Client({ connectionString: pgUrl });
  await pg.connect();
  let selesai = false;
  try {
    await pg.query(hanyaVerifikasi ? 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY' : 'BEGIN');
    await pg.query("SET LOCAL TimeZone = 'UTC'");
    await pg.query("SET LOCAL DateStyle = 'ISO'");
    const { tabel, pgTab, seqMap } = await metadata(my, pg);
    if (filter) {
      const hilang = filter.filter((f) => !tabel.has(f));
      if (hilang.length) throw new Error('tabel tidak ada di MySQL: ' + hilang.join(','));
      for (const n of [...tabel.keys()]) if (!filter.includes(n)) tabel.delete(n);
    }
    const galat = praSyarat(tabel, pgTab);
    if (galat.length) throw new Error('pra-syarat skema gagal:\n  ' + galat.join('\n  '));
    const daftar = [...tabel.values()];
    console.log(`MySQL ${my.db}: ${daftar.length} tabel; mode ${hanyaVerifikasi ? 'verifikasi' : 'salin+verifikasi'}`);

    if (!hanyaVerifikasi) {
      const tidakKosong = [];
      for (const t of daftar) { const n = Number((await pg.query(`SELECT COUNT(*) n FROM ${qp(t.nama)}`)).rows[0].n); if (n) tidakKosong.push(`${t.nama}=${n}`); }
      if (tidakKosong.length) throw new Error('target PG tidak kosong (kosongkan/buat ulang DB dulu): ' + tidakKosong.join(', '));
      await pg.query('SET LOCAL session_replication_role = replica');
      let total = 0;
      for (const t of daftar) {
        const t1 = Date.now();
        const n = await salinTabel(my, pg, t);
        total += n; console.log(`salin ${t.nama}: ${n} baris, ${detik(t1)} dtk`);
      }
      const lapor = await atasSequence(pg, daftar, seqMap, null);
      lapor.forEach((l) => console.log('SEQUENCE ' + l));
      console.log(`salinan selesai: ${total} baris, ${detik(t0)} dtk (belum COMMIT; verifikasi dulu)`);
    }

    // verifikasi (pada transaksi yang sama: yang diperiksa adalah isi yang akan di-COMMIT)
    const tv = Date.now(); let totMy = 0; let totPg = 0; let totBeda = 0;
    for (const t of daftar) {
      const r = await verifikasiTabel(my, pg, t);
      totMy += r.nMy; totPg += r.nPg; totBeda += r.nBeda;
      if (r.nBeda) { console.log(`BEDA ${t.nama}: ${r.nBeda} selisih (mysql=${r.nMy} pg=${r.nPg} baris)`); r.beda.forEach((b) => console.log('   ' + JSON.stringify(b))); }
    }
    console.log(`verifikasi: ${daftar.length} tabel, baris MySQL=${totMy} PG=${totPg}, selisih=${totBeda}, ${detik(tv)} dtk`);
    if (totBeda || totMy !== totPg) throw new Error('verifikasi menemukan selisih');
    await pg.query(hanyaVerifikasi ? 'ROLLBACK' : 'COMMIT');
    selesai = true;
    console.log(`SUKSES${hanyaVerifikasi ? ' (verifikasi saja)' : ' (COMMIT)'} total ${detik(t0)} dtk`);
  } catch (e) {
    console.error('GAGAL: ' + (e.message || e));
    if (!selesai) { try { await pg.query('ROLLBACK'); console.error('PG di-ROLLBACK, tidak ada perubahan.'); } catch { /* koneksi putus */ } }
    process.exitCode = 1;
  } finally {
    await pg.end().catch(() => {}); await my.conn.end().catch(() => {});
  }
})();
