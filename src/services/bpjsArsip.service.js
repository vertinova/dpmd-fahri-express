/**
 * Arsip bulanan data BPJS RT/RW di database (tabel bpjs_periode & bpjs_peserta).
 *
 * Satu periode = satu bulan BLTH ('YYYY-MM'). Import ulang periode yang sama
 * mengganti isi periode itu saja; periode lain tetap utuh, jadi data bulan-bulan
 * lalu selalu bisa dilihat dan dibandingkan.
 *
 * Backfill file lama dari CLI:
 *   node src/services/bpjsArsip.service.js data/rtrwbpjs20260626.xlsx data/rtrwbpjs20261126.xlsx
 */
const path = require('path');
const XLSX = require('xlsx');
const { Prisma } = require('@prisma/client');
const prisma = require('../config/prisma');
const {
  toText, normalizeNik, normalizeName, numberValue, dateToStr, normalizeBpjsDesaKode,
} = require('../../scripts/generate-rtrw-json-cache');

const SHEET_CANDIDATES = ['DATABASE', 'data_upah'];
const CHUNK = 2000; // 2000 baris × 15 kolom tetap di bawah batas 65535 parameter Postgres
const PERIODE_RE = /^\d{4}-\d{2}$/;

/** Baca Excel BPJS menjadi baris siap-simpan, dikelompokkan per periode BLTH. */
function bacaExcelBpjs(filePath) {
  const workbook = XLSX.readFile(filePath);
  const sheetName = SHEET_CANDIDATES.find((name) => workbook.Sheets[name]) || workbook.SheetNames[0];
  const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { defval: '' });

  const baris = rows.map((row, index) => {
    const idPegawai = toText(row.ID_PEGAWAI || row.ID_Pegawai || row['ID Pegawai']);
    const desaKode = normalizeBpjsDesaKode(idPegawai);
    const nik = normalizeNik(row.NIK);
    const kpj = toText(row.KPJ);
    const blth = dateToStr(row.BLTH);
    return {
      periode: PERIODE_RE.test(blth.slice(0, 7)) ? blth.slice(0, 7) : null,
      baris_excel: index + 2,
      kunci: (nik || (kpj && `KPJ:${kpj}`) || `NAMA:${normalizeName(row.NAMA_LENGKAP)}|${desaKode}`).slice(0, 255),
      nik: nik || toText(row.NIK).slice(0, 32),
      id_pegawai: idPegawai.slice(0, 64),
      desa_kode: desaKode.slice(0, 32),
      kpj: kpj.slice(0, 32),
      kode_tk: toText(row.KODE_TK).slice(0, 64),
      nama_lengkap: toText(row.NAMA_LENGKAP).slice(0, 255),
      tgl_lahir: dateToStr(row.TGL_LAHIR).slice(0, 32),
      upah: numberValue(row.UPAH),
      rapel: numberValue(row.RAPEL),
      blth: blth.slice(0, 32),
      npp: toText(row.NPP).slice(0, 64),
    };
  });

  // Baris dengan BLTH kosong/rusak ikut periode mayoritas file.
  const hitung = {};
  baris.forEach((b) => { if (b.periode) hitung[b.periode] = (hitung[b.periode] || 0) + 1; });
  const mayoritas = Object.keys(hitung).sort((a, b) => hitung[b] - hitung[a])[0];
  if (!mayoritas) throw new Error(`Kolom BLTH di sheet "${sheetName}" kosong/tidak terbaca — periode tidak bisa ditentukan.`);
  baris.forEach((b) => { b.periode ||= mayoritas; });

  const perPeriode = {};
  baris.forEach((b) => { (perPeriode[b.periode] ||= []).push(b); });
  return { sheetName, totalRows: rows.length, perPeriode };
}

/**
 * Simpan Excel BPJS ke arsip. Mengembalikan ringkasan per periode yang ditulis.
 * Satu transaksi per periode: gagal di tengah tidak meninggalkan periode setengah terisi.
 */
async function simpanExcelBpjs(filePath, { namaFile, userId = null, userName = null } = {}) {
  const { sheetName, totalRows, perPeriode } = bacaExcelBpjs(filePath);
  const periode = [];

  for (const [p, baris] of Object.entries(perPeriode).sort()) {
    const totalDesa = new Set(baris.map((b) => b.desa_kode).filter(Boolean)).size;
    const totalUpah = baris.reduce((sum, b) => sum + b.upah, 0);
    const header = {
      nama_file: (namaFile || path.basename(filePath)).slice(0, 255),
      total_baris: baris.length,
      total_desa: totalDesa,
      total_upah: totalUpah,
      imported_by: userId ? BigInt(userId) : null,
      imported_by_name: userName,
      imported_at: new Date(),
    };

    await prisma.$transaction(async (tx) => {
      await tx.bpjs_periode.upsert({ where: { periode: p }, create: { periode: p, ...header }, update: header });
      await tx.bpjs_peserta.deleteMany({ where: { periode: p } });
      for (let i = 0; i < baris.length; i += CHUNK) {
        await tx.bpjs_peserta.createMany({ data: baris.slice(i, i + CHUNK) });
      }
    }, { timeout: 180000, maxWait: 30000 });

    periode.push({ periode: p, totalBaris: baris.length, totalDesa, totalUpah });
  }

  return { sheetName, totalRows, periode };
}

async function periodeTerbaru() {
  const row = await prisma.bpjs_periode.findFirst({ orderBy: { periode: 'desc' }, select: { periode: true } });
  return row?.periode || null;
}

async function daftarPeriode() {
  return prisma.bpjs_periode.findMany({ orderBy: { periode: 'desc' } });
}

/**
 * Peserta satu periode, berhalaman.
 * banding: 'baru'   = ada di periode ini, tidak ada di periode sebelumnya
 *          'keluar' = ada di periode sebelumnya, tidak ada lagi di periode ini
 */
async function daftarPeserta(periode, { q = '', banding = '', page = 1, limit = 50 } = {}) {
  const sebelumnya = (await prisma.bpjs_periode.findFirst({
    where: { periode: { lt: periode } },
    orderBy: { periode: 'desc' },
    select: { periode: true },
  }))?.periode || null;

  if (banding && !sebelumnya) {
    return { periode, sebelumnya, banding, total: 0, totalUpah: 0, page, limit, rows: [] };
  }

  // 'keluar' menampilkan baris periode sebelumnya (data terakhir orang itu).
  const basis = banding === 'keluar' ? sebelumnya : periode;
  const lawan = banding === 'keluar' ? periode : sebelumnya;
  const kondisi = [Prisma.sql`p.periode = ${basis}`];
  if (banding) {
    kondisi.push(Prisma.sql`NOT EXISTS (SELECT 1 FROM bpjs_peserta x WHERE x.periode = ${lawan} AND x.kunci = p.kunci)`);
  }
  const cari = toText(q);
  if (cari) {
    const pola = `%${cari}%`;
    kondisi.push(Prisma.sql`(p.nama_lengkap ILIKE ${pola} OR p.nik LIKE ${pola} OR p.kpj LIKE ${pola}
      OR p.desa_kode LIKE ${pola} OR d.nama::text ILIKE ${pola} OR k.nama::text ILIKE ${pola})`);
  }
  const where = Prisma.join(kondisi, ' AND ');
  const from = Prisma.sql`FROM bpjs_peserta p
    LEFT JOIN desas d ON d.kode::text = p.desa_kode
    LEFT JOIN kecamatans k ON k.id = d.kecamatan_id`;

  const [[agregat], rows] = await Promise.all([
    prisma.$queryRaw`SELECT COUNT(*)::int AS total, COALESCE(SUM(p.upah), 0)::float AS total_upah ${from} WHERE ${where}`,
    prisma.$queryRaw`SELECT p.id::text AS id, p.periode, p.baris_excel, p.nik, p.id_pegawai, p.desa_kode, p.kpj,
        p.kode_tk, p.nama_lengkap, p.tgl_lahir, p.upah::float AS upah, p.rapel::float AS rapel, p.blth, p.npp,
        d.nama::text AS desa_nama, k.nama::text AS kecamatan_nama
      ${from} WHERE ${where}
      ORDER BY k.nama NULLS LAST, d.nama NULLS LAST, p.desa_kode, p.nama_lengkap
      LIMIT ${limit} OFFSET ${(page - 1) * limit}`,
  ]);

  return { periode, sebelumnya, banding, total: agregat.total, totalUpah: agregat.total_upah, page, limit, rows };
}

/** Ringkasan infografis satu periode: mutasi, sebaran, usia, cakupan, kualitas data. */
async function ringkasanPeriode(periode) {
  const sebelumnya = (await prisma.bpjs_periode.findFirst({
    where: { periode: { lt: periode } },
    orderBy: { periode: 'desc' },
    select: { periode: true },
  }))?.periode || null;
  // Usia dihitung terhadap tanggal 1 bulan periode, bukan hari ini.
  const acuan = `${periode}-01`;

  const [[mutasi], perKecamatan, usia, [kualitas], [cakupan]] = await Promise.all([
    prisma.$queryRaw`
      SELECT
        (SELECT COUNT(*)::int FROM bpjs_peserta p WHERE p.periode = ${periode}
          AND NOT EXISTS (SELECT 1 FROM bpjs_peserta x WHERE x.periode = ${sebelumnya} AND x.kunci = p.kunci)) AS baru,
        (SELECT COUNT(*)::int FROM bpjs_peserta p WHERE p.periode = ${sebelumnya}
          AND NOT EXISTS (SELECT 1 FROM bpjs_peserta x WHERE x.periode = ${periode} AND x.kunci = p.kunci)) AS keluar`,
    prisma.$queryRaw`
      SELECT COALESCE(k.nama::text, 'Kode tidak dikenal') AS kecamatan,
             COUNT(*)::int AS peserta, COUNT(DISTINCT p.desa_kode)::int AS desa
      FROM bpjs_peserta p
      LEFT JOIN desas d ON d.kode::text = p.desa_kode
      LEFT JOIN kecamatans k ON k.id = d.kecamatan_id
      WHERE p.periode = ${periode}
      GROUP BY 1 ORDER BY 2 DESC`,
    prisma.$queryRaw`
      SELECT kelompok, COUNT(*)::int AS peserta FROM (
        SELECT CASE
          WHEN p.tgl_lahir !~ '^\\d{4}-\\d{2}-\\d{2}$' THEN 'Tidak diketahui'
          ELSE CASE
            WHEN date_part('year', age(${acuan}::date, p.tgl_lahir::date)) < 30 THEN '< 30'
            WHEN date_part('year', age(${acuan}::date, p.tgl_lahir::date)) < 40 THEN '30–39'
            WHEN date_part('year', age(${acuan}::date, p.tgl_lahir::date)) < 50 THEN '40–49'
            WHEN date_part('year', age(${acuan}::date, p.tgl_lahir::date)) < 60 THEN '50–59'
            ELSE '≥ 60' END
        END AS kelompok
        FROM bpjs_peserta p WHERE p.periode = ${periode}
      ) t GROUP BY kelompok`,
    prisma.$queryRaw`
      SELECT
        COUNT(*) FILTER (WHERE p.nik !~ '^\\d{16}$')::int AS nik_tidak_valid,
        COUNT(*) FILTER (WHERE p.kpj = '')::int AS kpj_kosong,
        COUNT(*) FILTER (WHERE d.id IS NULL)::int AS desa_tidak_dikenal,
        COUNT(*) FILTER (WHERE p.tgl_lahir !~ '^\\d{4}-\\d{2}-\\d{2}$')::int AS tgl_lahir_kosong,
        (SELECT COUNT(*)::int FROM (SELECT nik FROM bpjs_peserta
           WHERE periode = ${periode} AND nik ~ '^\\d{16}$' GROUP BY nik HAVING COUNT(*) > 1) g) AS nik_ganda
      FROM bpjs_peserta p
      LEFT JOIN desas d ON d.kode::text = p.desa_kode
      WHERE p.periode = ${periode}`,
    prisma.$queryRaw`
      SELECT COUNT(*)::int AS total_desa,
             COUNT(*) FILTER (WHERE EXISTS (
               SELECT 1 FROM bpjs_peserta p WHERE p.periode = ${periode} AND p.desa_kode = d.kode::text))::int AS desa_terdaftar
      FROM desas d WHERE d.status_pemerintahan IS DISTINCT FROM 'kelurahan'`,
  ]);

  // Periode pertama tidak punya pembanding: mutasi null, bukan "semua baru".
  return { periode, sebelumnya, mutasi: sebelumnya ? mutasi : null, perKecamatan, usia, kualitas, cakupan };
}

module.exports = { bacaExcelBpjs, simpanExcelBpjs, periodeTerbaru, daftarPeriode, daftarPeserta, ringkasanPeriode };

if (require.main === module) {
  (async () => {
    const files = process.argv.slice(2);
    if (!files.length) {
      console.error('Usage: node src/services/bpjsArsip.service.js <file.xlsx> [file2.xlsx ...]');
      process.exit(1);
    }
    for (const file of files) {
      const hasil = await simpanExcelBpjs(path.resolve(file));
      console.log(path.basename(file), JSON.stringify(hasil.periode));
    }
    await prisma.$disconnect();
  })().catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
}
