/**
 * Anggaran Kas (Angkas) Routes — rencana penarikan/pencairan dana per bulan
 *
 * Angkas memecah anggaran satu sub kegiatan (pagu per tahun) menjadi rencana
 * pencairan per BULAN (Jan–Des), disimpan per KODE REKENING. Total sub kegiatan
 * = Σ rekening; tampilan triwulan dihitung dari agregasi bulanan di frontend.
 *
 * Access: read = semua user login; tulis = bendahara, superadmin.
 *
 * Endpoints:
 *   GET  /api/anggaran-kas?pagu_id=      — ambil rencana kas + referensi plafon RKA per rekening
 *   PUT  /api/anggaran-kas/pagu/:paguId  — simpan sekaligus (bulk replace) seluruh baris rekening
 */

const express = require('express');
const router = express.Router();
const prisma = require('../config/prisma');
const { auth, checkRole } = require('../middlewares/auth');
const { resolveStatic, resolveNamaBatch } = require('../utils/rekeningNama');

const WRITE_ROLES = ['bendahara', 'superadmin'];
const MONTHS = ['m1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7', 'm8', 'm9', 'm10', 'm11', 'm12'];
const EPS = 1; // toleransi 1 rupiah untuk pembulatan

const numOrZero = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

// Bangun peta plafon RKA per kode rekening dari item RKA satu pagu.
const buildPlafonMap = (rkaItems = []) => {
  const map = new Map();
  rkaItems.forEach((it) => {
    const kode = (it.kode_rekening || '').trim();
    const nilai = (Number(it.volume) || 0) * (Number(it.harga_satuan) || 0);
    map.set(kode, (map.get(kode) || 0) + nilai);
  });
  return map;
};

const serialize = (r, namaMap = null) => {
  const kode = r.kode_rekening || '';
  const out = {
    id: Number(r.id),
    pagu_id: Number(r.pagu_id),
    kode_rekening: kode,
    nama_rekening: (namaMap && namaMap.get(kode)) || resolveStatic(kode),
    keterangan: r.keterangan,
    created_by: r.created_by ? Number(r.created_by) : null,
    created_at: r.created_at,
    updated_at: r.updated_at,
    total: 0,
  };
  let total = 0;
  MONTHS.forEach((m) => {
    const v = Number(r[m]) || 0;
    out[m] = v;
    total += v;
  });
  out.total = total;
  return out;
};

// ─── GET /api/anggaran-kas?pagu_id= ───────────────────────────────────────────
router.get('/', auth, async (req, res) => {
  try {
    const { pagu_id } = req.query;
    if (!pagu_id || !/^\d+$/.test(String(pagu_id))) {
      return res.status(400).json({ success: false, message: 'pagu_id wajib diisi' });
    }
    const paguId = BigInt(pagu_id);

    const pagu = await prisma.anggaran_pagu.findUnique({
      where: { id: paguId },
      include: { rka_items: { select: { kode_rekening: true, volume: true, harga_satuan: true } } },
    });
    if (!pagu) return res.status(404).json({ success: false, message: 'Pagu tidak ditemukan' });

    const refMap = buildPlafonMap(pagu.rka_items || []);
    const rows = await prisma.anggaran_kas.findMany({
      where: { pagu_id: paguId },
      orderBy: { kode_rekening: 'asc' },
    });

    // Nama rekening (override user diutamakan) untuk semua kode yang tampil.
    const allCodes = [...refMap.keys(), ...rows.map((r) => r.kode_rekening)];
    const namaMap = await resolveNamaBatch(prisma, allCodes);

    // Referensi plafon RKA + nama per kode rekening
    const reference = [...refMap.entries()].map(([kode_rekening, plafon]) => ({
      kode_rekening,
      plafon,
      nama_rekening: namaMap.get(kode_rekening) || resolveStatic(kode_rekening),
    }));
    const totalAnggaran = reference.reduce((s, r) => s + r.plafon, 0);

    res.json({
      success: true,
      data: rows.map((r) => serialize(r, namaMap)),
      reference,
      pagu: { id: Number(pagu.id), tahun: pagu.tahun, pagu: Number(pagu.pagu), total_anggaran: totalAnggaran },
    });
  } catch (error) {
    console.error('Error fetching anggaran kas:', error);
    res.status(500).json({ success: false, message: 'Gagal mengambil anggaran kas', error: error.message });
  }
});

// ─── PUT /api/anggaran-kas/pagu/:paguId ───────────────────────────────────────
// Simpan sekaligus (bulk replace). Baris yang seluruh bulannya 0 dan tanpa
// keterangan diabaikan agar tabel tidak menyimpan baris kosong.
router.put('/pagu/:paguId', auth, checkRole(WRITE_ROLES), async (req, res) => {
  try {
    const { paguId } = req.params;
    if (!/^\d+$/.test(String(paguId))) {
      return res.status(400).json({ success: false, message: 'paguId tidak valid' });
    }
    const pid = BigInt(paguId);

    const pagu = await prisma.anggaran_pagu.findUnique({
      where: { id: pid },
      include: { rka_items: { select: { kode_rekening: true, volume: true, harga_satuan: true } } },
    });
    if (!pagu) return res.status(404).json({ success: false, message: 'Pagu tidak ditemukan' });
    const plafonMap = buildPlafonMap(pagu.rka_items || []);

    const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];

    // Bangun payload bersih, gabungkan duplikat kode_rekening (jumlahkan per bulan).
    const byKode = new Map();
    for (const row of rows) {
      const kode = String(row.kode_rekening ?? '').trim();
      const cur = byKode.get(kode) || { kode_rekening: kode, keterangan: null };
      MONTHS.forEach((m) => { cur[m] = (cur[m] || 0) + numOrZero(row[m]); });
      if (row.keterangan != null && String(row.keterangan).trim()) {
        cur.keterangan = String(row.keterangan).trim().slice(0, 255);
      }
      byKode.set(kode, cur);
    }

    // Guard plafon: total 12 bulan tiap rekening TIDAK boleh melebihi plafon RKA
    // rekening tsb. Rekening tanpa RKA (plafon 0) juga tidak boleh diisi.
    const violations = [];
    byKode.forEach((r, kode) => {
      const total = MONTHS.reduce((s, m) => s + numOrZero(r[m]), 0);
      if (total <= 0) return;
      const plafon = plafonMap.get(kode) || 0;
      if (total > plafon + EPS) {
        violations.push({
          kode_rekening: kode,
          nama_rekening: resolveStatic(kode),
          plafon,
          total,
          kelebihan: total - plafon,
        });
      }
    });
    if (violations.length > 0) {
      const msg = 'Rencana kas melebihi plafon RKA untuk: '
        + violations.map((v) => `${v.nama_rekening || v.kode_rekening} (plafon ${Math.round(v.plafon)}, diisi ${Math.round(v.total)})`).join('; ');
      return res.status(400).json({ success: false, message: msg, violations });
    }

    // Hanya simpan baris yang punya nilai atau keterangan.
    const toInsert = [...byKode.values()].filter(
      (r) => MONTHS.some((m) => numOrZero(r[m]) !== 0) || r.keterangan,
    );

    const userId = req.user?.id ? BigInt(req.user.id) : null;

    await prisma.$transaction(async (tx) => {
      await tx.anggaran_kas.deleteMany({ where: { pagu_id: pid } });
      if (toInsert.length > 0) {
        await tx.anggaran_kas.createMany({
          data: toInsert.map((r) => {
            const rec = { pagu_id: pid, kode_rekening: r.kode_rekening, keterangan: r.keterangan, created_by: userId };
            MONTHS.forEach((m) => { rec[m] = numOrZero(r[m]); });
            return rec;
          }),
        });
      }
    });

    const saved = await prisma.anggaran_kas.findMany({ where: { pagu_id: pid }, orderBy: { kode_rekening: 'asc' } });
    const savedNama = await resolveNamaBatch(prisma, saved.map((r) => r.kode_rekening));
    res.json({ success: true, message: 'Anggaran kas berhasil disimpan', data: saved.map((r) => serialize(r, savedNama)) });
  } catch (error) {
    console.error('Error saving anggaran kas:', error);
    res.status(500).json({ success: false, message: 'Gagal menyimpan anggaran kas', error: error.message });
  }
});

module.exports = router;
