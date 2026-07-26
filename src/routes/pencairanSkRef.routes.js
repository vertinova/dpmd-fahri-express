/**
 * Pencairan SK Referensi Routes — Master SK yang dipakai berulang di dokumen pencairan
 *
 * Dua jenis SK yang statis per tahun anggaran:
 *   - bupati_kpa : SK Bupati tentang penunjukan KPA (muncul di BASTHP)
 *   - kadis_ppk  : SK Kepala Dinas tentang penunjukan PPK (muncul di BAST, BASTHP)
 *
 * Dikategorikan per `tahun`. Frontend menampilkan yang relevan dengan tahun
 * berjalan lebih dulu, tahun lain di bawah.
 *
 * Access: bendahara, superadmin
 *
 * Endpoints:
 *   GET    /api/pencairan-sk           — list (filter ?jenis= &tahun=)
 *   POST   /api/pencairan-sk           — tambah
 *   PUT    /api/pencairan-sk/:id       — ubah
 *   DELETE /api/pencairan-sk/:id       — hapus
 */

const express = require('express');
const router = express.Router();
const prisma = require('../config/prisma');
const { auth, checkRole } = require('../middlewares/auth');

const ALLOWED_ROLES = ['bendahara', 'superadmin'];
const JENIS_VALID = ['bupati_kpa', 'kadis_ppk'];

const serialize = (s) => ({
  id: Number(s.id),
  jenis: s.jenis,
  tahun: s.tahun,
  nomor: s.nomor,
  tanggal: s.tanggal ? s.tanggal.toISOString().slice(0, 10) : null,
  keterangan: s.keterangan,
  created_by: s.created_by ? Number(s.created_by) : null,
  created_at: s.created_at,
  updated_at: s.updated_at,
});

const parseTanggal = (v) => {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
};

// ─── GET /api/pencairan-sk ──────────────────────────────────────────────────────
router.get('/', auth, checkRole(ALLOWED_ROLES), async (req, res) => {
  try {
    const { jenis, tahun } = req.query;
    const where = {};
    if (jenis) where.jenis = jenis;
    if (tahun) where.tahun = Number(tahun);

    const list = await prisma.pencairan_sk_ref.findMany({
      where,
      orderBy: [{ tahun: 'desc' }, { nomor: 'asc' }],
    });
    res.json({ success: true, data: list.map(serialize) });
  } catch (error) {
    console.error('Error fetching SK referensi:', error);
    res.status(500).json({ success: false, message: 'Gagal mengambil daftar SK', error: error.message });
  }
});

// ─── POST /api/pencairan-sk ─────────────────────────────────────────────────────
router.post('/', auth, checkRole(ALLOWED_ROLES), async (req, res) => {
  try {
    const { jenis, tahun, nomor, tanggal, keterangan } = req.body;
    if (!JENIS_VALID.includes(jenis)) {
      return res.status(400).json({ success: false, message: 'Jenis SK tidak valid' });
    }
    if (!tahun || Number.isNaN(Number(tahun))) {
      return res.status(400).json({ success: false, message: 'Tahun wajib diisi' });
    }
    if (!nomor || !String(nomor).trim()) {
      return res.status(400).json({ success: false, message: 'Nomor SK wajib diisi' });
    }

    const created = await prisma.pencairan_sk_ref.create({
      data: {
        jenis,
        tahun: Number(tahun),
        nomor: String(nomor).trim(),
        tanggal: parseTanggal(tanggal),
        keterangan: keterangan ? String(keterangan).trim() : null,
        created_by: BigInt(req.user.id),
      },
    });
    res.status(201).json({ success: true, message: 'SK berhasil ditambahkan', data: serialize(created) });
  } catch (error) {
    if (error.code === 'P2002') {
      return res.status(409).json({ success: false, message: 'SK dengan nomor & tahun yang sama sudah ada' });
    }
    console.error('Error creating SK referensi:', error);
    res.status(500).json({ success: false, message: 'Gagal menambahkan SK', error: error.message });
  }
});

// ─── PUT /api/pencairan-sk/:id ──────────────────────────────────────────────────
router.put('/:id', auth, checkRole(ALLOWED_ROLES), async (req, res) => {
  try {
    const id = BigInt(req.params.id);
    const existing = await prisma.pencairan_sk_ref.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ success: false, message: 'SK tidak ditemukan' });

    const { jenis, tahun, nomor, tanggal, keterangan } = req.body;
    const data = { updated_at: new Date() };
    if (jenis !== undefined) {
      if (!JENIS_VALID.includes(jenis)) return res.status(400).json({ success: false, message: 'Jenis SK tidak valid' });
      data.jenis = jenis;
    }
    if (tahun !== undefined) data.tahun = Number(tahun);
    if (nomor !== undefined) data.nomor = String(nomor).trim();
    if (tanggal !== undefined) data.tanggal = parseTanggal(tanggal);
    if (keterangan !== undefined) data.keterangan = keterangan ? String(keterangan).trim() : null;

    const updated = await prisma.pencairan_sk_ref.update({ where: { id }, data });
    res.json({ success: true, message: 'SK berhasil diubah', data: serialize(updated) });
  } catch (error) {
    if (error.code === 'P2002') {
      return res.status(409).json({ success: false, message: 'SK dengan nomor & tahun yang sama sudah ada' });
    }
    res.status(500).json({ success: false, message: 'Gagal mengubah SK', error: error.message });
  }
});

// ─── DELETE /api/pencairan-sk/:id ───────────────────────────────────────────────
router.delete('/:id', auth, checkRole(ALLOWED_ROLES), async (req, res) => {
  try {
    const id = BigInt(req.params.id);
    const existing = await prisma.pencairan_sk_ref.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ success: false, message: 'SK tidak ditemukan' });

    await prisma.pencairan_sk_ref.delete({ where: { id } });
    res.json({ success: true, message: 'SK berhasil dihapus' });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Gagal menghapus SK', error: error.message });
  }
});

module.exports = router;
