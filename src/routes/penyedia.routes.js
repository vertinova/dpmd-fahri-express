/**
 * Penyedia Routes — Master pihak ketiga / vendor
 *
 * Access:
 *   - Read: bendahara, superadmin
 *   - Write: bendahara, superadmin
 */

const express = require('express');
const router = express.Router();
const prisma = require('../config/prisma');
const { auth, checkRole } = require('../middlewares/auth');

const ALLOWED_ROLES = ['bendahara', 'superadmin'];

// ─── Serializer ───────────────────────────────────────────────────────────────
const serialize = (p) => ({
  id: Number(p.id),
  nama: p.nama,
  alamat: p.alamat,
  npwp: p.npwp,
  nama_direktur: p.nama_direktur,
  jabatan_direktur: p.jabatan_direktur,
  no_rekening: p.no_rekening,
  nama_bank: p.nama_bank,
  telepon: p.telepon,
  email: p.email,
  is_active: p.is_active,
  created_by: p.created_by ? Number(p.created_by) : null,
  created_at: p.created_at,
  updated_at: p.updated_at,
  total_transaksi: p._count?.pencairan ?? undefined,
});

// ─── GET /api/penyedia ────────────────────────────────────────────────────────
router.get('/', auth, checkRole(ALLOWED_ROLES), async (req, res) => {
  try {
    const { search, active } = req.query;
    const where = {};
    if (active !== undefined) where.is_active = active === 'true' || active === '1';
    if (search) {
      where.OR = [
        { nama: { contains: search } },
        { nama_direktur: { contains: search } },
        { npwp: { contains: search } },
      ];
    }

    const list = await prisma.penyedia.findMany({
      where,
      orderBy: { nama: 'asc' },
      include: { _count: { select: { pencairan: true } } },
    });
    res.json({ success: true, data: list.map(serialize) });
  } catch (error) {
    console.error('Error fetching penyedia list:', error);
    res.status(500).json({ success: false, message: 'Gagal mengambil daftar penyedia', error: error.message });
  }
});

// ─── GET /api/penyedia/:id ────────────────────────────────────────────────────
router.get('/:id', auth, checkRole(ALLOWED_ROLES), async (req, res) => {
  try {
    const p = await prisma.penyedia.findUnique({
      where: { id: BigInt(req.params.id) },
      include: { _count: { select: { pencairan: true } } },
    });
    if (!p) return res.status(404).json({ success: false, message: 'Penyedia tidak ditemukan' });
    res.json({ success: true, data: serialize(p) });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Gagal mengambil detail penyedia', error: error.message });
  }
});

// ─── POST /api/penyedia ───────────────────────────────────────────────────────
router.post('/', auth, checkRole(ALLOWED_ROLES), async (req, res) => {
  try {
    const { nama, alamat, npwp, nama_direktur, jabatan_direktur, no_rekening, nama_bank, telepon, email } = req.body;
    if (!nama) return res.status(400).json({ success: false, message: 'Nama penyedia wajib diisi' });

    const created = await prisma.penyedia.create({
      data: {
        nama,
        alamat: alamat || null,
        npwp: npwp || null,
        nama_direktur: nama_direktur || null,
        jabatan_direktur: jabatan_direktur || 'Direktur',
        no_rekening: no_rekening || null,
        nama_bank: nama_bank || null,
        telepon: telepon || null,
        email: email || null,
        is_active: true,
        created_by: BigInt(req.user.id),
      },
    });
    res.status(201).json({ success: true, message: 'Penyedia berhasil ditambahkan', data: serialize(created) });
  } catch (error) {
    console.error('Error creating penyedia:', error);
    res.status(500).json({ success: false, message: 'Gagal menambahkan penyedia', error: error.message });
  }
});

// ─── PUT /api/penyedia/:id ────────────────────────────────────────────────────
router.put('/:id', auth, checkRole(ALLOWED_ROLES), async (req, res) => {
  try {
    const { id } = req.params;
    const existing = await prisma.penyedia.findUnique({ where: { id: BigInt(id) } });
    if (!existing) return res.status(404).json({ success: false, message: 'Penyedia tidak ditemukan' });

    const { nama, alamat, npwp, nama_direktur, jabatan_direktur, no_rekening, nama_bank, telepon, email, is_active } = req.body;
    const data = {};
    if (nama !== undefined) data.nama = nama;
    if (alamat !== undefined) data.alamat = alamat;
    if (npwp !== undefined) data.npwp = npwp;
    if (nama_direktur !== undefined) data.nama_direktur = nama_direktur;
    if (jabatan_direktur !== undefined) data.jabatan_direktur = jabatan_direktur;
    if (no_rekening !== undefined) data.no_rekening = no_rekening;
    if (nama_bank !== undefined) data.nama_bank = nama_bank;
    if (telepon !== undefined) data.telepon = telepon;
    if (email !== undefined) data.email = email;
    if (is_active !== undefined) data.is_active = Boolean(is_active);

    const updated = await prisma.penyedia.update({ where: { id: BigInt(id) }, data });
    res.json({ success: true, message: 'Penyedia berhasil diupdate', data: serialize(updated) });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Gagal mengupdate penyedia', error: error.message });
  }
});

// ─── DELETE /api/penyedia/:id ─────────────────────────────────────────────────
router.delete('/:id', auth, checkRole(ALLOWED_ROLES), async (req, res) => {
  try {
    const { id } = req.params;
    const existing = await prisma.penyedia.findUnique({
      where: { id: BigInt(id) },
      include: { _count: { select: { pencairan: true } } },
    });
    if (!existing) return res.status(404).json({ success: false, message: 'Penyedia tidak ditemukan' });

    if (existing._count.pencairan > 0) {
      return res.status(400).json({
        success: false,
        message: `Penyedia ini sudah dipakai di ${existing._count.pencairan} transaksi pencairan, tidak bisa dihapus. Nonaktifkan saja.`,
      });
    }

    await prisma.penyedia.delete({ where: { id: BigInt(id) } });
    res.json({ success: true, message: 'Penyedia berhasil dihapus' });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Gagal menghapus penyedia', error: error.message });
  }
});

module.exports = router;
