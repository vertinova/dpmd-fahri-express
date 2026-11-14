/**
 * SQL mentah lewat Prisma (pengganti shim pg lama di config/database.js).
 *
 * Parameter memakai `?`; ekstensi PG (config/prismaPg.js) menyisipkannya sebagai literal
 * ber-escape dan mengubah boolean menjadi 1/0. Di sini BIGINT → Number dan DECIMAL → string,
 * sehingga bentuk JSON sama persis dengan shim lama. Di dalam prisma.$transaction kirim
 * klien transaksinya sebagai `db`.
 */
const { Prisma } = require('@prisma/client');
const prisma = require('./prisma');

const nilai = (v) => {
  if (typeof v === 'bigint') {
    const n = Number(v);
    return Number.isSafeInteger(n) ? n : v.toString();
  }
  return Prisma.Decimal.isDecimal(v) ? v.toString() : v;
};
const rapikan = (baris) => baris.map((b) => {
  const o = {};
  for (const k of Object.keys(b)) o[k] = nilai(b[k]);
  return o;
});

/** SELECT, atau INSERT/UPDATE ... RETURNING → array baris. */
const kueri = async (sql, params = [], db = prisma) => rapikan(await db.$queryRawUnsafe(sql, ...params));

/** INSERT/UPDATE/DELETE tanpa RETURNING → jumlah baris terdampak. */
const jalankan = (sql, params = [], db = prisma) => db.$executeRawUnsafe(sql, ...params);

/** Pelanggaran unik, baik dari ORM (P2002) maupun SQL mentah (P2010 berkode 23505). */
const galatUnik = (e) => e?.code === 'P2002' || (e?.code === 'P2010' && e?.meta?.code === '23505');

module.exports = { kueri, jalankan, galatUnik, rapikan };
