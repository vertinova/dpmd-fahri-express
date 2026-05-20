/**
 * Anggaran Routes - Desain 3-Layer
 *
 * Layer 1: anggaran_master_kegiatan  — program/kegiatan TETAP, tidak berubah per tahun
 * Layer 2: anggaran_pagu             — pagu per kegiatan per TAHUN (beda tiap tahun)
 * Layer 3: anggaran_rka_items        — item belanja per pagu (beda tiap tahun)
 *
 * Semua CRUD hanya boleh dilakukan oleh superadmin.
 * Read bisa dilakukan semua user yang sudah login.
 */

const express = require('express');
const router = express.Router();
const prisma = require('../config/prisma');
const { auth, requireSuperadmin } = require('../middlewares/auth');

// ============================================================
// HELPERS
// ============================================================
const serializeMaster = (m) => ({
  id: Number(m.id),
  bidang_id: Number(m.bidang_id),
  bidang_unit_id: m.bidang_unit_id ? Number(m.bidang_unit_id) : null,
  kode_program: m.kode_program,
  nama_program: m.nama_program,
  kode_kegiatan: m.kode_kegiatan,
  nama_kegiatan: m.nama_kegiatan,
  kode_sub_kegiatan: m.kode_sub_kegiatan,
  nama_sub_kegiatan: m.nama_sub_kegiatan,
  id_giat: m.id_giat,
  id_sub_giat: m.id_sub_giat,
  urutan: m.urutan,
  is_active: m.is_active,
  created_by: Number(m.created_by),
  created_at: m.created_at,
  updated_at: m.updated_at,
  bidangs: m.bidangs ? { id: Number(m.bidangs.id), nama: m.bidangs.nama } : undefined,
  bidang_unit: m.bidang_unit ? { id: Number(m.bidang_unit.id), nama: m.bidang_unit.nama, kode: m.bidang_unit.kode } : null,
  creator: m.users ? { id: Number(m.users.id), name: m.users.name } : undefined,
  // pagu list ringkas
  pagu_list: m.pagu_list ? m.pagu_list.map(p => ({
    id: Number(p.id),
    tahun: p.tahun,
    pagu: Number(p.pagu),
    item_count: p.rka_items ? p.rka_items.length : 0,
    total_items: p.rka_items
      ? p.rka_items.reduce((s, i) => s + Number(i.volume) * Number(i.harga_satuan), 0)
      : 0
  })) : undefined
});

const serializePagu = (p) => ({
  id: Number(p.id),
  master_kegiatan_id: Number(p.master_kegiatan_id),
  tahun: p.tahun,
  pagu: Number(p.pagu),
  pagu_indikatif: p.pagu_indikatif ? Number(p.pagu_indikatif) : 0,
  created_by: Number(p.created_by),
  created_at: p.created_at,
  updated_at: p.updated_at,
  master_kegiatan: p.master_kegiatan ? serializeMaster(p.master_kegiatan) : undefined,
  creator: p.users ? { id: Number(p.users.id), name: p.users.name } : undefined,
  rka_items: p.rka_items ? p.rka_items.map(serializeItem) : undefined,
  total_anggaran: p.rka_items
    ? p.rka_items.reduce((s, i) => s + Number(i.volume) * Number(i.harga_satuan), 0)
    : undefined
});

const serializeItem = (item) => ({
  id: Number(item.id),
  pagu_id: Number(item.pagu_id),
  nama_item: item.nama_item,
  kode_rekening: item.kode_rekening,
  satuan: item.satuan,
  volume: Number(item.volume),
  harga_satuan: Number(item.harga_satuan),
  jenis_sht: item.jenis_sht,
  kode_sht: item.kode_sht,
  keterangan: item.keterangan,
  koefisien: item.koefisien ? (() => { try { return JSON.parse(item.koefisien); } catch { return null; } })() : null,
  grup: item.grup || null,
  urutan: item.urutan,
  total: Number(item.volume) * Number(item.harga_satuan),
  created_by: Number(item.created_by),
  created_at: item.created_at,
  updated_at: item.updated_at,
  creator: item.users ? { id: Number(item.users.id), name: item.users.name } : undefined,
});

// ============================================================
// BIDANG & SUB UNITS
// ============================================================

/**
 * GET /api/anggaran/bidang
 * Semua bidang beserta sub-unit dan statistik
 */
router.get('/bidang', auth, async (req, res) => {
  try {
    const { tahun } = req.query;
    const bidangs = await prisma.bidangs.findMany({
      orderBy: { id: 'asc' },
      include: {
        anggaran_bidang_units: { orderBy: { urutan: 'asc' } },
        anggaran_master_kegiatan: {
          where: { is_active: true },
          select: { id: true, bidang_unit_id: true, nama_program: true,
            pagu_list: tahun ? {
              where: { tahun: parseInt(tahun) },
              select: { id: true, tahun: true, pagu: true }
            } : {
              orderBy: { tahun: 'desc' },
              take: 1,
              select: { id: true, tahun: true, pagu: true }
            }
          }
        }
      }
    });

    const data = bidangs.map(b => ({
      id: Number(b.id),
      nama: b.nama,
      sub_units: b.anggaran_bidang_units.map(u => ({
        id: Number(u.id),
        nama: u.nama,
        kode: u.kode,
        urutan: u.urutan
      })),
      total_kegiatan: b.anggaran_master_kegiatan.length,
      total_pagu: b.anggaran_master_kegiatan.reduce((s, k) => {
        return s + (k.pagu_list[0] ? Number(k.pagu_list[0].pagu) : 0);
      }, 0)
    }));

    res.json({ success: true, data });
  } catch (error) {
    console.error('Error fetching bidang anggaran:', error);
    res.status(500).json({ success: false, message: 'Gagal mengambil data bidang', error: error.message });
  }
});

/**
 * GET /api/anggaran/bidang-units
 * Sub unit per bidang
 */
router.get('/bidang-units', auth, async (req, res) => {
  try {
    const { bidang_id } = req.query;
    const where = bidang_id ? { bidang_id: BigInt(bidang_id) } : {};
    const units = await prisma.anggaran_bidang_units.findMany({
      where,
      orderBy: [{ bidang_id: 'asc' }, { urutan: 'asc' }],
      include: { bidangs: { select: { id: true, nama: true } } }
    });
    const data = units.map(u => ({
      id: Number(u.id),
      bidang_id: Number(u.bidang_id),
      bidang_nama: u.bidangs?.nama,
      nama: u.nama,
      kode: u.kode,
      urutan: u.urutan
    }));
    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Gagal mengambil sub unit', error: error.message });
  }
});

router.post('/bidang-units', auth, requireSuperadmin, async (req, res) => {
  try {
    const { bidang_id, nama, kode, urutan } = req.body;
    if (!bidang_id || !nama) return res.status(400).json({ success: false, message: 'bidang_id dan nama wajib diisi' });
    const maxUrutan = await prisma.anggaran_bidang_units.aggregate({ _max: { urutan: true }, where: { bidang_id: BigInt(bidang_id) } });
    const unit = await prisma.anggaran_bidang_units.create({
      data: { bidang_id: BigInt(bidang_id), nama, kode: kode || null, urutan: urutan ? parseInt(urutan) : (maxUrutan._max.urutan || 0) + 1 }
    });
    res.status(201).json({ success: true, message: 'Sub unit berhasil ditambahkan', data: { id: Number(unit.id), bidang_id: Number(unit.bidang_id), nama: unit.nama, kode: unit.kode, urutan: unit.urutan } });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Gagal menambahkan sub unit', error: error.message });
  }
});

router.put('/bidang-units/:id', auth, requireSuperadmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { nama, kode, urutan } = req.body;
    const existing = await prisma.anggaran_bidang_units.findUnique({ where: { id: BigInt(id) } });
    if (!existing) return res.status(404).json({ success: false, message: 'Sub unit tidak ditemukan' });
    const updated = await prisma.anggaran_bidang_units.update({
      where: { id: BigInt(id) },
      data: { ...(nama !== undefined && { nama }), ...(kode !== undefined && { kode }), ...(urutan !== undefined && { urutan: parseInt(urutan) }) }
    });
    res.json({ success: true, message: 'Sub unit berhasil diupdate', data: { id: Number(updated.id), nama: updated.nama, kode: updated.kode, urutan: updated.urutan } });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Gagal mengupdate sub unit', error: error.message });
  }
});

router.delete('/bidang-units/:id', auth, requireSuperadmin, async (req, res) => {
  try {
    const { id } = req.params;
    const existing = await prisma.anggaran_bidang_units.findUnique({ where: { id: BigInt(id) } });
    if (!existing) return res.status(404).json({ success: false, message: 'Sub unit tidak ditemukan' });
    const used = await prisma.anggaran_master_kegiatan.count({ where: { bidang_unit_id: BigInt(id) } });
    if (used > 0) return res.status(400).json({ success: false, message: `Sub unit digunakan di ${used} kegiatan` });
    await prisma.anggaran_bidang_units.delete({ where: { id: BigInt(id) } });
    res.json({ success: true, message: 'Sub unit berhasil dihapus' });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Gagal menghapus sub unit', error: error.message });
  }
});

// ============================================================
// MASTER KEGIATAN (Layer 1 - data tetap)
// ============================================================

/**
 * GET /api/anggaran/master
 * Daftar master kegiatan dengan filter bidang, unit
 * Query: bidang_id, bidang_unit_id, search, include_inactive, tahun (untuk ringkasan pagu)
 */
router.get('/master', auth, async (req, res) => {
  try {
    const { bidang_id, bidang_unit_id, search, include_inactive, tahun } = req.query;
    const where = {};
    if (bidang_id) where.bidang_id = BigInt(bidang_id);
    if (bidang_unit_id) where.bidang_unit_id = BigInt(bidang_unit_id);
    if (!include_inactive) where.is_active = true;
    if (search) {
      where.OR = [
        { nama_kegiatan: { contains: search } },
        { nama_program: { contains: search } },
        { nama_sub_kegiatan: { contains: search } },
        { kode_kegiatan: { contains: search } }
      ];
    }

    const masters = await prisma.anggaran_master_kegiatan.findMany({
      where,
      orderBy: [{ kode_program: 'asc' }, { kode_kegiatan: 'asc' }, { urutan: 'asc' }],
      include: {
        bidangs: { select: { id: true, nama: true } },
        bidang_unit: { select: { id: true, nama: true, kode: true } },
        users: { select: { id: true, name: true } },
        pagu_list: {
          where: tahun ? { tahun: parseInt(tahun) } : undefined,
          orderBy: { tahun: 'desc' },
          include: {
            rka_items: { select: { id: true, volume: true, harga_satuan: true } }
          }
        }
      }
    });

    res.json({ success: true, data: masters.map(serializeMaster) });
  } catch (error) {
    console.error('Error fetching master kegiatan:', error);
    res.status(500).json({ success: false, message: 'Gagal mengambil data master kegiatan', error: error.message });
  }
});

/**
 * GET /api/anggaran/master/:id
 * Detail master kegiatan beserta semua pagu per tahun
 */
router.get('/master/:id', auth, async (req, res) => {
  try {
    const { id } = req.params;
    const master = await prisma.anggaran_master_kegiatan.findUnique({
      where: { id: BigInt(id) },
      include: {
        bidangs: { select: { id: true, nama: true } },
        bidang_unit: { select: { id: true, nama: true, kode: true } },
        users: { select: { id: true, name: true } },
        pagu_list: {
          orderBy: { tahun: 'desc' },
          include: {
            rka_items: {
              orderBy: { urutan: 'asc' },
              include: { users: { select: { id: true, name: true } } }
            },
            users: { select: { id: true, name: true } }
          }
        }
      }
    });
    if (!master) return res.status(404).json({ success: false, message: 'Master kegiatan tidak ditemukan' });
    const data = serializeMaster(master);
    data.pagu_list = master.pagu_list.map(serializePagu);
    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Gagal mengambil detail master kegiatan', error: error.message });
  }
});

/**
 * POST /api/anggaran/master
 * Tambah master kegiatan baru (superadmin)
 */
router.post('/master', auth, requireSuperadmin, async (req, res) => {
  try {
    const { bidang_id, bidang_unit_id, kode_program, nama_program, kode_kegiatan, nama_kegiatan, kode_sub_kegiatan, nama_sub_kegiatan, id_giat, id_sub_giat, urutan } = req.body;
    if (!bidang_id || !nama_program || !nama_kegiatan) {
      return res.status(400).json({ success: false, message: 'bidang_id, nama_program, dan nama_kegiatan wajib diisi' });
    }
    const master = await prisma.anggaran_master_kegiatan.create({
      data: {
        bidang_id: BigInt(bidang_id),
        bidang_unit_id: bidang_unit_id ? BigInt(bidang_unit_id) : null,
        kode_program: kode_program || null,
        nama_program,
        kode_kegiatan: kode_kegiatan || null,
        nama_kegiatan,
        kode_sub_kegiatan: kode_sub_kegiatan || null,
        nama_sub_kegiatan: nama_sub_kegiatan || null,
        id_giat: id_giat ? parseInt(id_giat) : null,
        id_sub_giat: id_sub_giat ? parseInt(id_sub_giat) : null,
        urutan: urutan ? parseInt(urutan) : 1,
        is_active: true,
        created_by: BigInt(req.user.id)
      },
      include: {
        bidangs: { select: { id: true, nama: true } },
        bidang_unit: { select: { id: true, nama: true, kode: true } },
        users: { select: { id: true, name: true } }
      }
    });
    res.status(201).json({ success: true, message: 'Master kegiatan berhasil ditambahkan', data: serializeMaster(master) });
  } catch (error) {
    console.error('Error creating master kegiatan:', error);
    res.status(500).json({ success: false, message: 'Gagal menambahkan master kegiatan', error: error.message });
  }
});

/**
 * PUT /api/anggaran/master/:id
 * Update master kegiatan (superadmin)
 */
router.put('/master/:id', auth, requireSuperadmin, async (req, res) => {
  try {
    const { id } = req.params;
    const existing = await prisma.anggaran_master_kegiatan.findUnique({ where: { id: BigInt(id) } });
    if (!existing) return res.status(404).json({ success: false, message: 'Master kegiatan tidak ditemukan' });

    const { bidang_id, bidang_unit_id, kode_program, nama_program, kode_kegiatan, nama_kegiatan, kode_sub_kegiatan, nama_sub_kegiatan, urutan, is_active } = req.body;
    const data = {};
    if (bidang_id !== undefined) {
      data.bidang_id = BigInt(bidang_id);
      // Reset bidang_unit when moving to a different bidang
      if (String(bidang_id) !== String(existing.bidang_id)) data.bidang_unit_id = null;
    }
    if (bidang_unit_id !== undefined) data.bidang_unit_id = bidang_unit_id ? BigInt(bidang_unit_id) : null;
    if (kode_program !== undefined) data.kode_program = kode_program;
    if (nama_program !== undefined) data.nama_program = nama_program;
    if (kode_kegiatan !== undefined) data.kode_kegiatan = kode_kegiatan;
    if (nama_kegiatan !== undefined) data.nama_kegiatan = nama_kegiatan;
    if (kode_sub_kegiatan !== undefined) data.kode_sub_kegiatan = kode_sub_kegiatan;
    if (nama_sub_kegiatan !== undefined) data.nama_sub_kegiatan = nama_sub_kegiatan;
    if (urutan !== undefined) data.urutan = parseInt(urutan);
    if (is_active !== undefined) data.is_active = Boolean(is_active);

    const updated = await prisma.anggaran_master_kegiatan.update({
      where: { id: BigInt(id) },
      data,
      include: {
        bidangs: { select: { id: true, nama: true } },
        bidang_unit: { select: { id: true, nama: true, kode: true } },
        users: { select: { id: true, name: true } }
      }
    });
    res.json({ success: true, message: 'Master kegiatan berhasil diupdate', data: serializeMaster(updated) });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Gagal mengupdate master kegiatan', error: error.message });
  }
});

/**
 * DELETE /api/anggaran/master/:id
 * Hapus master kegiatan (superadmin)
 */
router.delete('/master/:id', auth, requireSuperadmin, async (req, res) => {
  try {
    const { id } = req.params;
    const existing = await prisma.anggaran_master_kegiatan.findUnique({ where: { id: BigInt(id) } });
    if (!existing) return res.status(404).json({ success: false, message: 'Master kegiatan tidak ditemukan' });
    await prisma.anggaran_master_kegiatan.delete({ where: { id: BigInt(id) } });
    res.json({ success: true, message: 'Master kegiatan berhasil dihapus' });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Gagal menghapus master kegiatan', error: error.message });
  }
});

// ============================================================
// PAGU PER TAHUN (Layer 2)
// ============================================================

/**
 * GET /api/anggaran/master/:masterId/pagu
 * Daftar pagu per tahun untuk satu master kegiatan
 */
router.get('/master/:masterId/pagu', auth, async (req, res) => {
  try {
    const { masterId } = req.params;
    const pagus = await prisma.anggaran_pagu.findMany({
      where: { master_kegiatan_id: BigInt(masterId) },
      orderBy: { tahun: 'desc' },
      include: {
        rka_items: {
          orderBy: { urutan: 'asc' },
          include: { users: { select: { id: true, name: true } } }
        },
        users: { select: { id: true, name: true } }
      }
    });
    const data = pagus.map(serializePagu);
    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Gagal mengambil data pagu', error: error.message });
  }
});

/**
 * POST /api/anggaran/master/:masterId/pagu
 * Tambah atau update pagu untuk tahun tertentu (upsert)
 * Access: superadmin
 */
router.post('/master/:masterId/pagu', auth, requireSuperadmin, async (req, res) => {
  try {
    const { masterId } = req.params;
    const { tahun, pagu, pagu_indikatif } = req.body;
    if (!tahun || pagu === undefined) return res.status(400).json({ success: false, message: 'tahun dan pagu wajib diisi' });

    const master = await prisma.anggaran_master_kegiatan.findUnique({ where: { id: BigInt(masterId) } });
    if (!master) return res.status(404).json({ success: false, message: 'Master kegiatan tidak ditemukan' });

    const result = await prisma.anggaran_pagu.upsert({
      where: { uk_pagu_kegiatan_tahun: { master_kegiatan_id: BigInt(masterId), tahun: parseInt(tahun) } },
      create: {
        master_kegiatan_id: BigInt(masterId),
        tahun: parseInt(tahun),
        pagu: parseFloat(pagu),
        pagu_indikatif: pagu_indikatif ? parseFloat(pagu_indikatif) : 0,
        created_by: BigInt(req.user.id)
      },
      update: {
        pagu: parseFloat(pagu),
        pagu_indikatif: pagu_indikatif !== undefined ? parseFloat(pagu_indikatif) : undefined
      },
      include: { users: { select: { id: true, name: true } } }
    });

    res.status(201).json({ success: true, message: `Pagu tahun ${tahun} berhasil disimpan`, data: serializePagu(result) });
  } catch (error) {
    console.error('Error upserting pagu:', error);
    res.status(500).json({ success: false, message: 'Gagal menyimpan pagu', error: error.message });
  }
});

/**
 * DELETE /api/anggaran/pagu/:id
 * Hapus pagu beserta semua item RKA-nya
 * Access: superadmin
 */
router.delete('/pagu/:id', auth, requireSuperadmin, async (req, res) => {
  try {
    const { id } = req.params;
    const existing = await prisma.anggaran_pagu.findUnique({ where: { id: BigInt(id) } });
    if (!existing) return res.status(404).json({ success: false, message: 'Pagu tidak ditemukan' });
    await prisma.anggaran_pagu.delete({ where: { id: BigInt(id) } });
    res.json({ success: true, message: 'Pagu dan semua item RKA berhasil dihapus' });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Gagal menghapus pagu', error: error.message });
  }
});

// ============================================================
// RKA ITEMS (Layer 3 - per pagu/tahun)
// ============================================================

/**
 * GET /api/anggaran/items/frequent
 * Item yang paling sering digunakan (untuk autocomplete modal)
 */
router.get('/items/frequent', auth, async (req, res) => {
  try {
    const rows = await prisma.$queryRaw`
      SELECT
        nama_item, jenis_sht, kode_rekening, kode_sht, satuan,
        CAST(AVG(harga_satuan) AS DECIMAL(20,2)) AS harga_satuan,
        COUNT(*) AS usage_count,
        MAX(created_at) AS last_used
      FROM anggaran_rka_items
      GROUP BY nama_item, jenis_sht, kode_rekening, kode_sht, satuan
      ORDER BY usage_count DESC, last_used DESC
      LIMIT 30
    `;
    res.json({
      success: true,
      data: rows.map(r => ({
        nama_item:    r.nama_item,
        jenis_sht:    r.jenis_sht,
        kode_rekening: r.kode_rekening,
        kode_sht:     r.kode_sht,
        satuan:       r.satuan,
        harga_satuan: Number(r.harga_satuan),
        usage_count:  Number(r.usage_count),
      })),
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Gagal mengambil item sering digunakan', error: error.message });
  }
});

/**
 * GET /api/anggaran/pagu/:paguId/items
 * Item RKA untuk satu pagu
 */
router.get('/pagu/:paguId/items', auth, async (req, res) => {
  try {
    const { paguId } = req.params;
    const pagu = await prisma.anggaran_pagu.findUnique({
      where: { id: BigInt(paguId) },
      include: { master_kegiatan: true }
    });
    if (!pagu) return res.status(404).json({ success: false, message: 'Pagu tidak ditemukan' });

    const items = await prisma.anggaran_rka_items.findMany({
      where: { pagu_id: BigInt(paguId) },
      orderBy: { urutan: 'asc' },
      include: { users: { select: { id: true, name: true } } }
    });

    const serialized = items.map(serializeItem);
    const total_anggaran = serialized.reduce((s, i) => s + i.total, 0);
    res.json({ success: true, data: serialized, total_anggaran, pagu: serializePagu(pagu) });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Gagal mengambil item RKA', error: error.message });
  }
});

/**
 * POST /api/anggaran/pagu/:paguId/items
 * Tambah item RKA (superadmin)
 */
router.post('/pagu/:paguId/items', auth, requireSuperadmin, async (req, res) => {
  try {
    const { paguId } = req.params;
    const pagu = await prisma.anggaran_pagu.findUnique({ where: { id: BigInt(paguId) } });
    if (!pagu) return res.status(404).json({ success: false, message: 'Pagu tidak ditemukan' });

    const { nama_item, kode_rekening, satuan, volume, harga_satuan, jenis_sht, kode_sht, keterangan, koefisien, grup } = req.body;
    if (!nama_item || !satuan) return res.status(400).json({ success: false, message: 'nama_item dan satuan wajib diisi' });
    if (!['SSH', 'SBU'].includes(jenis_sht)) return res.status(400).json({ success: false, message: 'jenis_sht harus SSH atau SBU' });

    const maxUrutan = await prisma.anggaran_rka_items.aggregate({ _max: { urutan: true }, where: { pagu_id: BigInt(paguId) } });
    const item = await prisma.anggaran_rka_items.create({
      data: {
        pagu_id: BigInt(paguId),
        nama_item,
        kode_rekening: kode_rekening || null,
        satuan,
        volume: volume ? parseFloat(volume) : 1,
        harga_satuan: harga_satuan ? parseFloat(harga_satuan) : 0,
        jenis_sht,
        kode_sht: kode_sht || null,
        keterangan: keterangan || null,
        koefisien: koefisien ? JSON.stringify(koefisien) : null,
        grup: grup || null,
        urutan: (maxUrutan._max.urutan || 0) + 1,
        created_by: BigInt(req.user.id)
      },
      include: { users: { select: { id: true, name: true } } }
    });
    res.status(201).json({ success: true, message: 'Item RKA berhasil ditambahkan', data: serializeItem(item) });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Gagal menambahkan item RKA', error: error.message });
  }
});

/**
 * PUT /api/anggaran/items/:id
 * Update item RKA (superadmin)
 */
router.put('/items/:id', auth, requireSuperadmin, async (req, res) => {
  try {
    const { id } = req.params;
    const existing = await prisma.anggaran_rka_items.findUnique({ where: { id: BigInt(id) } });
    if (!existing) return res.status(404).json({ success: false, message: 'Item tidak ditemukan' });

    const { nama_item, kode_rekening, satuan, volume, harga_satuan, jenis_sht, kode_sht, keterangan, koefisien, grup, urutan } = req.body;
    if (jenis_sht && !['SSH', 'SBU'].includes(jenis_sht)) return res.status(400).json({ success: false, message: 'jenis_sht harus SSH atau SBU' });

    const data = {};
    if (nama_item !== undefined) data.nama_item = nama_item;
    if (kode_rekening !== undefined) data.kode_rekening = kode_rekening;
    if (satuan !== undefined) data.satuan = satuan;
    if (volume !== undefined) data.volume = parseFloat(volume);
    if (harga_satuan !== undefined) data.harga_satuan = parseFloat(harga_satuan);
    if (jenis_sht !== undefined) data.jenis_sht = jenis_sht;
    if (kode_sht !== undefined) data.kode_sht = kode_sht;
    if (keterangan !== undefined) data.keterangan = keterangan;
    if (koefisien !== undefined) data.koefisien = koefisien ? JSON.stringify(koefisien) : null;
    if (grup !== undefined) data.grup = grup || null;
    if (urutan !== undefined) data.urutan = parseInt(urutan);

    const updated = await prisma.anggaran_rka_items.update({
      where: { id: BigInt(id) },
      data,
      include: { users: { select: { id: true, name: true } } }
    });
    res.json({ success: true, message: 'Item berhasil diupdate', data: serializeItem(updated) });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Gagal mengupdate item', error: error.message });
  }
});

/**
 * DELETE /api/anggaran/items/:id
 * Hapus item RKA (superadmin)
 */
router.delete('/items/:id', auth, requireSuperadmin, async (req, res) => {
  try {
    const { id } = req.params;
    const existing = await prisma.anggaran_rka_items.findUnique({ where: { id: BigInt(id) } });
    if (!existing) return res.status(404).json({ success: false, message: 'Item tidak ditemukan' });
    await prisma.anggaran_rka_items.delete({ where: { id: BigInt(id) } });
    res.json({ success: true, message: 'Item berhasil dihapus' });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Gagal menghapus item', error: error.message });
  }
});

/**
 * POST /api/anggaran/pagu/:paguId/copy-from/:sourceTahun
 * Copy semua item dari tahun lain ke pagu ini
 * Berguna untuk tahun baru yang itemnya mirip tahun lalu
 */
router.post('/pagu/:paguId/copy-from/:sourceTahun', auth, requireSuperadmin, async (req, res) => {
  try {
    const { paguId, sourceTahun } = req.params;
    const targetPagu = await prisma.anggaran_pagu.findUnique({ where: { id: BigInt(paguId) } });
    if (!targetPagu) return res.status(404).json({ success: false, message: 'Pagu target tidak ditemukan' });

    const sourcePagu = await prisma.anggaran_pagu.findUnique({
      where: { uk_pagu_kegiatan_tahun: { master_kegiatan_id: targetPagu.master_kegiatan_id, tahun: parseInt(sourceTahun) } },
      include: { rka_items: true }
    });
    if (!sourcePagu) return res.status(404).json({ success: false, message: `Pagu tahun ${sourceTahun} tidak ditemukan` });
    if (sourcePagu.rka_items.length === 0) return res.status(400).json({ success: false, message: `Tidak ada item RKA di tahun ${sourceTahun}` });

    const maxUrutan = await prisma.anggaran_rka_items.aggregate({ _max: { urutan: true }, where: { pagu_id: BigInt(paguId) } });
    let urutan = (maxUrutan._max.urutan || 0) + 1;

    await prisma.anggaran_rka_items.createMany({
      data: sourcePagu.rka_items.map(item => ({
        pagu_id: BigInt(paguId),
        nama_item: item.nama_item,
        kode_rekening: item.kode_rekening,
        satuan: item.satuan,
        volume: item.volume,
        harga_satuan: item.harga_satuan,
        jenis_sht: item.jenis_sht,
        kode_sht: item.kode_sht,
        keterangan: item.keterangan,
        urutan: urutan++,
        created_by: BigInt(req.user.id)
      }))
    });

    res.json({ success: true, message: `${sourcePagu.rka_items.length} item berhasil disalin dari tahun ${sourceTahun}` });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Gagal menyalin item', error: error.message });
  }
});

// ============================================================
// SHT (Standar Harga Satuan) — SSH & SBU
// ============================================================

const fs = require('fs');
const path = require('path');

let _sshCache = null;
let _sbuCache = null;

function loadSht(type) {
  const file = path.join(__dirname, `../../data/anggaran/${type}_2026.json`);
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

/**
 * GET /api/anggaran/sht/ssh
 * Daftar SSH (Standar Harga Satuan) — cached in memory
 */
router.get('/sht/ssh', auth, (req, res) => {
  try {
    if (!_sshCache) _sshCache = loadSht('ssh');
    if (!_sshCache) return res.status(404).json({ success: false, message: 'Data SSH tidak ditemukan' });

    const { search, kelompok, page = 1, limit = 100 } = req.query;
    let items = _sshCache.items;

    if (kelompok) items = items.filter(i => i.kode_kelompok === kelompok || i.kelompok === kelompok);
    if (search) {
      const q = search.toLowerCase();
      items = items.filter(i =>
        (i.uraian        || '').toLowerCase().includes(q) ||
        (i.spesifikasi   || '').toLowerCase().includes(q) ||
        (i.kode_barang   || '').toLowerCase().includes(q) ||
        (i.kelompok      || '').toLowerCase().includes(q) ||
        (i.kode_kelompok || '').toLowerCase().includes(q)
      );
    }

    const total = items.length;
    const offset = (parseInt(page) - 1) * parseInt(limit);
    const paged = items.slice(offset, offset + parseInt(limit));

    res.json({ success: true, tahun: _sshCache.tahun, total, page: parseInt(page), data: paged });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Gagal memuat data SSH', error: error.message });
  }
});

/**
 * GET /api/anggaran/sht/sbu
 * Daftar SBU (Standar Biaya Umum) — cached in memory
 */
router.get('/sht/sbu', auth, (req, res) => {
  try {
    if (!_sbuCache) _sbuCache = loadSht('sbu');
    if (!_sbuCache) return res.status(404).json({ success: false, message: 'Data SBU tidak ditemukan' });

    const { search, kelompok, page = 1, limit = 100 } = req.query;
    let items = _sbuCache.items;

    if (kelompok) items = items.filter(i => i.kode_kelompok === kelompok || i.kelompok === kelompok);
    if (search) {
      const q = search.toLowerCase();
      items = items.filter(i =>
        (i.uraian        || '').toLowerCase().includes(q) ||
        (i.spesifikasi   || '').toLowerCase().includes(q) ||
        (i.kode_barang   || '').toLowerCase().includes(q) ||
        (i.kelompok      || '').toLowerCase().includes(q) ||
        (i.kode_kelompok || '').toLowerCase().includes(q)
      );
    }

    const total = items.length;
    const offset = (parseInt(page) - 1) * parseInt(limit);
    const paged = items.slice(offset, offset + parseInt(limit));

    res.json({ success: true, tahun: _sbuCache.tahun, total, page: parseInt(page), data: paged });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Gagal memuat data SBU', error: error.message });
  }
});

/**
 * GET /api/anggaran/sht/kelompok?type=ssh|sbu
 * Daftar kelompok unik untuk filter
 */
router.get('/sht/kelompok', auth, (req, res) => {
  try {
    const { type = 'ssh' } = req.query;
    if (type === 'ssh') {
      if (!_sshCache) _sshCache = loadSht('ssh');
      if (!_sshCache) return res.status(404).json({ success: false, message: 'Data SSH tidak ditemukan' });
      const seen = new Set();
      const kelompoks = [];
      for (const item of _sshCache.items) {
        if (!seen.has(item.kode_kelompok)) {
          seen.add(item.kode_kelompok);
          kelompoks.push({ kode: item.kode_kelompok, nama: item.kelompok });
        }
      }
      res.json({ success: true, data: kelompoks });
    } else {
      if (!_sbuCache) _sbuCache = loadSht('sbu');
      if (!_sbuCache) return res.status(404).json({ success: false, message: 'Data SBU tidak ditemukan' });
      const seen = new Set();
      const kelompoks = [];
      for (const item of _sbuCache.items) {
        if (!seen.has(item.kode_kelompok)) {
          seen.add(item.kode_kelompok);
          kelompoks.push({ kode: item.kode_kelompok, nama: item.kelompok });
        }
      }
      res.json({ success: true, data: kelompoks });
    }
  } catch (error) {
    res.status(500).json({ success: false, message: 'Gagal memuat kelompok SHT', error: error.message });
  }
});

module.exports = router;
