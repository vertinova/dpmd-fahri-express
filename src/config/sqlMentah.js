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

// Seperti shim lama: parameter undefined adalah galat (bukan NULL diam-diam); array harus dijabarkan jadi ?, ?, ?.
function periksa(params) {
  params.forEach((p, i) => {
    if (p === undefined) throw new Error(`Parameter SQL ke-${i + 1} undefined`);
    if (Array.isArray(p)) throw new Error(`Parameter SQL ke-${i + 1} berupa array; jabarkan menjadi ?, ?, ?`);
  });
  return params;
}

/** SELECT, atau INSERT/UPDATE ... RETURNING → array baris. */
const kueri = async (sql, params = [], db = prisma) => rapikan(await db.$queryRawUnsafe(sql, ...periksa(params)));

/** INSERT/UPDATE/DELETE tanpa RETURNING → jumlah baris terdampak. */
const jalankan = async (sql, params = [], db = prisma) => db.$executeRawUnsafe(sql, ...periksa(params));

/** Dilempar di dalam prisma.$transaction untuk membatalkan transaksi lalu membalas dengan status/body ini. */
class BatalTrx extends Error {
  constructor(status, body) {
    super('Transaksi dibatalkan');
    this.status = status;
    this.body = body;
  }
}

/** Pelanggaran unik, baik dari ORM (P2002) maupun SQL mentah (P2010 berkode 23505). */
const galatUnik = (e) => e?.code === 'P2002' || (e?.code === 'P2010' && e?.meta?.code === '23505');

module.exports = { kueri, jalankan, galatUnik, rapikan, BatalTrx };
