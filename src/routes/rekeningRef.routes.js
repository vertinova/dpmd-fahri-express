/**
 * Rekening Ref Routes — pengaturan NAMA rekening oleh user
 *
 * User memberi nama sendiri ke tiap kode rekening (override). Dipakai Anggaran
 * Kas & laporan supaya kode rekening tampil dengan nama yang dikenal.
 *
 * Access: read = semua user login; tulis = bendahara, superadmin.
 *
 * Endpoints:
 *   GET /api/rekening-ref/catalog?pagu_id=  — daftar kode rekening dipakai RKA
 *        (semua, atau satu pagu) + nama custom + nama bawaan + jumlah item + plafon
 *   PUT /api/rekening-ref                   — simpan sekaligus {rows:[{kode_rekening,nama}]}
 *        nama kosong = hapus override (kembali ke nama bawaan)
 */

const express = require('express');
const router = express.Router();
const prisma = require('../config/prisma');
const { auth, checkRole } = require('../middlewares/auth');
const { resolveStatic } = require('../utils/rekeningNama');

const WRITE_ROLES = ['bendahara', 'superadmin'];

// ─── GET /api/rekening-ref/catalog ────────────────────────────────────────────
router.get('/catalog', auth, async (req, res) => {
  try {
    const { pagu_id } = req.query;
    const where = { kode_rekening: { not: null } };
    if (pagu_id && /^\d+$/.test(String(pagu_id))) where.pagu_id = BigInt(pagu_id);

    const items = await prisma.anggaran_rka_items.findMany({
      where,
      select: { kode_rekening: true, volume: true, harga_satuan: true },
    });

    // Agregasi per kode rekening: jumlah item + plafon (Σ volume × harga).
    const agg = new Map();
    items.forEach((it) => {
      const kode = (it.kode_rekening || '').trim();
      if (!kode) return;
      const cur = agg.get(kode) || { kode_rekening: kode, item_count: 0, plafon: 0 };
      cur.item_count += 1;
      cur.plafon += (Number(it.volume) || 0) * (Number(it.harga_satuan) || 0);
      agg.set(kode, cur);
    });

    const codes = [...agg.keys()];
    const overrides = codes.length
      ? await prisma.rekening_ref.findMany({ where: { kode_rekening: { in: codes } } })
      : [];
    const overrideMap = new Map(overrides.map((o) => [o.kode_rekening, o.nama]));

    const data = [...agg.values()]
      .sort((a, b) => a.kode_rekening.localeCompare(b.kode_rekening))
      .map((r) => ({
        kode_rekening: r.kode_rekening,
        item_count: r.item_count,
        plafon: r.plafon,
        nama_custom: overrideMap.get(r.kode_rekening) || '',
        nama_default: resolveStatic(r.kode_rekening),
      }));

    res.json({ success: true, data });
  } catch (error) {
    console.error('Error fetching rekening catalog:', error);
    res.status(500).json({ success: false, message: 'Gagal mengambil daftar rekening', error: error.message });
  }
});

// ─── PUT /api/rekening-ref ────────────────────────────────────────────────────
router.put('/', auth, checkRole(WRITE_ROLES), async (req, res) => {
  try {
    const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];
    const userId = req.user?.id ? BigInt(req.user.id) : null;

    let upserted = 0;
    let deleted = 0;

    await prisma.$transaction(async (tx) => {
      for (const row of rows) {
        const kode = String(row.kode_rekening ?? '').trim();
        if (!kode) continue;
        const nama = String(row.nama ?? '').trim().slice(0, 255);
        if (!nama) {
          // Nama dikosongkan → hapus override (kembali ke nama bawaan).
          await tx.rekening_ref.deleteMany({ where: { kode_rekening: kode } });
          deleted += 1;
          continue;
        }
        await tx.rekening_ref.upsert({
          where: { kode_rekening: kode },
          update: { nama, updated_at: new Date() },
          create: { kode_rekening: kode, nama, created_by: userId },
        });
        upserted += 1;
      }
    });

    res.json({ success: true, message: `Tersimpan (${upserted} nama, ${deleted} direset ke bawaan)` });
  } catch (error) {
    console.error('Error saving rekening ref:', error);
    res.status(500).json({ success: false, message: 'Gagal menyimpan nama rekening', error: error.message });
  }
});

module.exports = router;
