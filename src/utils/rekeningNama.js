/**
 * Resolusi nama kode rekening — dipakai Anggaran Kas & pengaturan nama rekening.
 *
 * Urutan sumber nama (yang pertama ketemu dipakai):
 *   1. Override user (tabel rekening_ref)          — paling diprioritaskan
 *   2. Peta bawaan rekening_belanja.json (kode penuh)
 *   3. Prefix hierarki terpanjang di peta bawaan   — mis. .00099 → nama rincian objek induk
 */

const rekeningMap = require('../../data/anggaran/rekening_belanja.json');

// Nama bawaan (tanpa override user): kode penuh dulu, lalu prefix terpanjang.
const resolveStatic = (code) => {
  const parts = String(code || '').split('.');
  for (let i = parts.length; i >= 1; i--) {
    const prefix = parts.slice(0, i).join('.');
    if (rekeningMap[prefix]) return rekeningMap[prefix];
  }
  return '';
};

// Batch: kembalikan Map kode → nama (override user diutamakan) untuk daftar kode.
const resolveNamaBatch = async (prisma, codes = []) => {
  const uniq = [...new Set(codes.map((c) => (c || '').trim()).filter(Boolean))];
  const map = new Map();
  uniq.forEach((c) => map.set(c, resolveStatic(c)));
  if (uniq.length > 0) {
    const overrides = await prisma.rekening_ref.findMany({ where: { kode_rekening: { in: uniq } } });
    overrides.forEach((o) => { if (o.nama) map.set(o.kode_rekening, o.nama); });
  }
  return map;
};

module.exports = { resolveStatic, resolveNamaBatch };
