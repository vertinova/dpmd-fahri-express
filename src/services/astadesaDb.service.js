/**
 * Akses BACA-SAJA langsung ke database ASTA DESA.
 *
 * MENGAPA ADA. Database ASTA DESA (PostgreSQL, CT 104) berada di server yang
 * sama dengan backend ini. API-nya hanya menyediakan daftar berpaginasi OFFSET:
 * menyusuri 1,09 juta keluarga dan 2,56 juta anggota lewat API berbiaya
 * kuadratik (tiap halaman memindai ulang semua baris sebelumnya). Diukur
 * 21 Nov 2026: satu siklus penyusuran 6–8 jam, ratusan halaman gagal, dan
 * server ASTA DESA ikut jenuh. Lewat SQL, agregat demografi lengkap selesai
 * ±15 detik dan satu batch keyset 5.000 keluarga ±90 ms di posisi mana pun.
 *
 * BATASNYA ADA DI DATABASE, BUKAN DI SINI. Role `dpmd_baca` dibuat dengan
 * transaksi wajib read-only, statement_timeout 180 dtk, batas 4 koneksi, dan
 * hak SELECT PER KOLOM: NIK, nomor KK, telepon, alamat, dan koordinat tidak
 * bisa dibaca sama sekali. pg_hba hanya mengizinkannya dari CT 100.
 *
 * Bila ASTADESA_DB_URL kosong, `aktif()` false dan seluruh fitur kembali ke
 * penyusuran API seperti sebelumnya.
 */

const { Pool } = require('pg');

const URL_DB = process.env.ASTADESA_DB_URL || '';
// Baris per batch keyset. Tiap batch diolah sinkron di event loop; 2.000 baris
// x ±85 kolom menjaga satu jeda di bawah ±100 ms.
const BATCH = 2000;

let kolam = null;

const aktif = () => Boolean(URL_DB);

const pool = () => {
  if (!kolam) {
    kolam = new Pool({
      connectionString: URL_DB,
      max: 3,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
      application_name: 'dpmd-core-dashboard'
    });
    // Koneksi idle yang putus (DB restart) tidak boleh menjatuhkan proses.
    kolam.on('error', (err) => console.error('[asta-desa-db] koneksi idle galat:', err.message));
  }
  return kolam;
};

const kueri = (sql, params) => pool().query(sql, params);

// ── Cache: sajikan yang ada, perbarui di latar ───────────────────────────────
const simpanan = new Map(); // kunci -> { nilai, pada }
const berjalan = new Map(); // kunci -> Promise

/**
 * Nilai terakhir untuk `kunci`, TANPA PERNAH MENUNGGU perhitungan baru.
 *
 * Perhitungan penuh bisa memakan puluhan detik, sedangkan frontend menyerah
 * di detik ke-30. Jadi: yang sudah ada langsung dijawab (pembaruan berjalan di
 * latar bila lewat `ttlMs` atau `force`), dan yang belum ada menjawab null —
 * pemanggil jatuh ke sumber lama sampai perhitungan pertama selesai.
 */
const ambilAtauMulai = (kunci, ttlMs, hitung, { force = false } = {}) => {
  const ada = simpanan.get(kunci);
  const segar = ada && Date.now() - ada.pada < ttlMs;
  if ((force || !segar) && !berjalan.has(kunci)) {
    const mulai = Date.now();
    const p = Promise.resolve()
      .then(hitung)
      .then((nilai) => {
        simpanan.set(kunci, { nilai, pada: Date.now() });
        console.log(`[asta-desa-db] ${kunci} disusun dalam ${Math.round((Date.now() - mulai) / 1000)} dtk`);
        return nilai;
      })
      .catch((err) => {
        console.error(`[asta-desa-db] ${kunci} gagal:`, err.message);
        return null;
      })
      .finally(() => berjalan.delete(kunci));
    berjalan.set(kunci, p);
  }
  return ada ? { nilai: ada.nilai, pada: ada.pada, basi: !segar } : null;
};

/** Tunggu perhitungan `kunci` yang sedang berjalan (dipakai pemanasan). */
const tungguBerjalan = (kunci) => berjalan.get(kunci) || Promise.resolve(null);

// ── Kolom ────────────────────────────────────────────────────────────────────

let kolomSensus = null;

/**
 * Kolom `sensuses` yang boleh dibaca role ini, dibaca dari hak aksesnya
 * sendiri. Dengan begitu daftar kolom tidak pernah dikodekan di dua tempat:
 * mencabut satu kolom di database cukup untuk menghilangkannya di sini.
 */
const daftarKolomSensus = async () => {
  if (kolomSensus) return kolomSensus;
  const r = await kueri(
    `select column_name from information_schema.column_privileges
      where grantee = current_user and table_schema = 'public' and table_name = 'sensuses' and privilege_type = 'SELECT'`
  );
  kolomSensus = new Set(r.rows.map((x) => x.column_name));
  return kolomSensus;
};

const kutip = (nama) => `"${String(nama).replace(/"/g, '""')}"`;

// ── Kueri ────────────────────────────────────────────────────────────────────

/**
 * Agregat anggota keluarga per desa dalam SATU pemindaian (GROUPING SETS).
 *
 * Aturan seragamnya sama dengan penyusuran API (lihat bacaAnggota/usiaDari di
 * controller): wilayah = trim(kecamatan/desa) keluarga induk, usia dari
 * tanggal_lahir dalam tahun 365,25 hari. Jenis kelamin dikirim mentah dan
 * diseragamkan di JS supaya aturannya tetap satu.
 */
const agregatAnggota = async () => {
  const r = await kueri(`
    with a as (
      select coalesce(nullif(trim(s.kecamatan), ''), 'Tidak diketahui') kec,
             coalesce(nullif(trim(s.desa), ''), 'Tidak diketahui') desa,
             trim(coalesce(a.jenis_kelamin, '')) jk,
             floor((extract(epoch from now())
                    - extract(epoch from (a.tanggal_lahir::timestamp at time zone 'UTC'))) / 31557600)::int usia,
             nullif(trim(a.pendidikan_terakhir), '') pend,
             nullif(trim(a.hubungan_kk), '') hub,
             nullif(trim(a.disabilitas), '') dis
        from sensus_anggotas a
        join sensuses s on s.id = a.sensus_id and s.deleted_at is null
    )
    select kec, desa, jk, usia, pend, hub, dis,
           grouping(jk) gj, grouping(pend) gp, grouping(hub) gh, grouping(dis) gd,
           count(*)::int n
      from a
     group by grouping sets ((kec, desa, jk, usia), (kec, desa, pend), (kec, desa, hub), (kec, desa, dis))`);
  return r.rows;
};

/**
 * Seluruh keluarga, batch demi batch lewat keyset (`id > terakhir`), bukan
 * OFFSET — biayanya linear. `olah(rows)` dipanggil per batch.
 */
const susuriKeluarga = async (olah) => {
  const kolom = Array.from(await daftarKolomSensus());
  const daftar = kolom.map(kutip).join(', ');
  let terakhir = 0;
  let jumlah = 0;
  for (;;) {
    const r = await kueri(
      `select ${daftar} from sensuses where deleted_at is null and id > $1 order by id limit ${BATCH}`,
      [terakhir]
    );
    if (!r.rows.length) break;
    olah(r.rows);
    jumlah += r.rows.length;
    terakhir = r.rows[r.rows.length - 1].id;
    if (r.rows.length < BATCH) break;
    // Beri giliran ke permintaan lain di antara batch.
    await new Promise((res) => setImmediate(res));
  }
  return jumlah;
};

// Ekspresi yang SAMA PERSIS dengan indeks `sensuses_wilayah_desa_index` milik
// ASTA DESA, supaya pencarian per desa memakai indeks itu, bukan memindai
// seluruh tabel. Pencocokan pastinya tetap lower(trim(...)) di bawahnya.
const EKS_KEC = (x) =>
  `lower(regexp_replace(regexp_replace((coalesce(${x}, ''))::text, '^\\s*(kec\\.|kecamatan\\s)\\s*', '', 'i'), '[^a-zA-Z0-9]', '', 'g'))`;
const EKS_DESA = (x) =>
  `lower(regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace((coalesce(${x}, ''))::text, '^\\s*(ds\\.|desa\\s|kel\\.|kelurahan\\s)\\s*', '', 'i'), '\\s+satu\\s*$', 'i', 'i'), '\\s+dua\\s*$', 'ii', 'i'), '\\s*1\\s*$', 'i', 'i'), '\\s*2\\s*$', 'ii', 'i'), '[^a-zA-Z0-9]', '', 'g'))`;
const SARING_DESA = (alias) =>
  `${EKS_KEC(`${alias}.kecamatan`)} = ${EKS_KEC('$1::varchar')}
   and ${EKS_DESA(`${alias}.desa`)} = ${EKS_DESA('$2::varchar')}
   and lower(trim(${alias}.kecamatan)) = lower(trim($1)) and lower(trim(${alias}.desa)) = lower(trim($2))
   and ${alias}.deleted_at is null`;

/** Anggota keluarga satu desa (untuk daftar nama). Tanpa NIK/alamat. */
const anggotaDesa = async (kecamatan, desa) => {
  const r = await kueri(
    `select a.nama, a.hubungan_kk, a.jenis_kelamin, a.tanggal_lahir::text tanggal_lahir,
            a.pendidikan_terakhir, a.disabilitas, a.sensus_id::text sensus_id, s.kk_nama
       from sensuses s
       join sensus_anggotas a on a.sensus_id = s.id
      where ${SARING_DESA('s')}`,
    [kecamatan, desa]
  );
  return r.rows;
};

/**
 * Keluarga satu desa, opsional beserta satu kolom kategori (`kolom` harus
 * sudah divalidasi pemanggil dan ada di `daftarKolomSensus`).
 */
const keluargaDesa = async (kecamatan, desa, kolom = null) => {
  const ekstra = kolom ? `, s.${kutip(kolom)} nilai` : '';
  const r = await kueri(
    `select s.id::text id, s.kk_nama${ekstra} from sensuses s where ${SARING_DESA('s')}`,
    [kecamatan, desa]
  );
  return r.rows;
};

module.exports = {
  aktif,
  ambilAtauMulai,
  tungguBerjalan,
  daftarKolomSensus,
  agregatAnggota,
  susuriKeluarga,
  anggotaDesa,
  keluargaDesa
};
