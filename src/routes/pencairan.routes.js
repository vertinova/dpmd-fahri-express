/**
 * Pencairan Routes — Realisasi item anggaran
 *
 * Tabel generic: 1 set untuk semua jenis pencairan (ATK, Cetak, Makmin, dst).
 * Bedanya cuma di kolom `jenis_pencairan` dan dokumen yang di-generate.
 *
 * Access:
 *   - Read/Write: bendahara, superadmin
 *
 * Endpoints:
 *   GET    /api/pencairan                  — list dengan filter
 *   GET    /api/pencairan/:id              — detail lengkap (header + items + pemeriksa)
 *   POST   /api/pencairan                  — create new (transactional)
 *   PUT    /api/pencairan/:id              — update (transactional)
 *   POST   /api/pencairan/:id/finalize     — ubah status draft → finalized
 *   POST   /api/pencairan/:id/cancel       — ubah status → cancelled
 *   DELETE /api/pencairan/:id              — hapus (cascade items & pemeriksa)
 */

const express = require('express');
const router = express.Router();
const prisma = require('../config/prisma');
const { auth, checkRole } = require('../middlewares/auth');
const { generateAtkExcel } = require('../utils/generateAtkExcel');

const ALLOWED_ROLES = ['bendahara', 'superadmin'];

// ─── Helpers ──────────────────────────────────────────────────────────────────
const num = (v) => (v === null || v === undefined ? null : Number(v));
const bigOrNull = (v) => (v === null || v === undefined || v === '' ? null : BigInt(v));
const decOrZero = (v) => (v === null || v === undefined || v === '' ? 0 : parseFloat(v));
const parseIdParam = (v) => {
  const text = String(v ?? '').trim();
  return /^\d+$/.test(text) ? BigInt(text) : null;
};

const userBrief = (u) => u ? {
  id: Number(u.id),
  name: u.name,
  nip: u.pegawai?.nip || null,
  jabatan: u.pegawai?.jabatan || null,
} : null;

const serializeItem = (i) => ({
  id: Number(i.id),
  pencairan_id: Number(i.pencairan_id),
  rka_item_id: i.rka_item_id ? Number(i.rka_item_id) : null,
  nama_barang: i.nama_barang,
  spesifikasi: i.spesifikasi,
  kode_rekening: i.kode_rekening,
  qty: num(i.qty),
  satuan: i.satuan,
  harga_satuan: num(i.harga_satuan),
  ppn: num(i.ppn),
  total: num(i.total),
  status_pemeriksaan: i.status_pemeriksaan,
  urutan: i.urutan,
});

const serializePemeriksa = (p) => ({
  id: Number(p.id),
  pencairan_id: Number(p.pencairan_id),
  user_id: Number(p.user_id),
  peran: p.peran,
  urutan: p.urutan,
  user: p.users ? userBrief(p.users) : null,
});

const serialize = (p, { includeRelations = false } = {}) => {
  const base = {
    id: Number(p.id),
    jenis_pencairan: p.jenis_pencairan,
    master_kegiatan_id: Number(p.master_kegiatan_id),
    pagu_id: Number(p.pagu_id),
    tahun_anggaran: p.tahun_anggaran,
    bidang_id: Number(p.bidang_id),
    uraian_kegiatan: p.uraian_kegiatan,
    penyedia_id: p.penyedia_id ? Number(p.penyedia_id) : null,
    ppk_id: p.ppk_id ? Number(p.ppk_id) : null,
    kpa_id: p.kpa_id ? Number(p.kpa_id) : null,
    pptk_id: p.pptk_id ? Number(p.pptk_id) : null,
    bendahara_pengeluaran_id: p.bendahara_pengeluaran_id ? Number(p.bendahara_pengeluaran_id) : null,
    pengurus_barang_id: p.pengurus_barang_id ? Number(p.pengurus_barang_id) : null,
    atasan_pengurus_barang_id: p.atasan_pengurus_barang_id ? Number(p.atasan_pengurus_barang_id) : null,
    penerima_faktur_id: p.penerima_faktur_id ? Number(p.penerima_faktur_id) : null,
    tgl_pesanan: p.tgl_pesanan,
    tgl_surat_perintah_tugas: p.tgl_surat_perintah_tugas,
    tgl_faktur: p.tgl_faktur,
    tgl_kwitansi: p.tgl_kwitansi,
    tgl_ba_pemeriksaan: p.tgl_ba_pemeriksaan,
    tgl_bast: p.tgl_bast,
    tgl_basthp: p.tgl_basthp,
    no_pesanan_a: p.no_pesanan_a,
    no_pesanan_b: p.no_pesanan_b,
    no_faktur: p.no_faktur,
    no_kwitansi: p.no_kwitansi,
    no_ba_pemeriksaan: p.no_ba_pemeriksaan,
    no_bast: p.no_bast,
    no_basthp: p.no_basthp,
    no_bappbj: p.no_bappbj,
    no_lampiran_bat: p.no_lampiran_bat,
    no_surat_perintah_tugas: p.no_surat_perintah_tugas,
    no_sk_bupati_kpa: p.no_sk_bupati_kpa,
    no_sk_kadis_ppk: p.no_sk_kadis_ppk,
    total_nilai: num(p.total_nilai),
    total_terbilang: p.total_terbilang,
    metadata: p.metadata,
    status: p.status,
    finalized_at: p.finalized_at,
    finalized_by: p.finalized_by ? Number(p.finalized_by) : null,
    created_by: Number(p.created_by),
    created_at: p.created_at,
    updated_at: p.updated_at,
  };

  if (includeRelations) {
    base.penyedia = p.penyedia ? {
      id: Number(p.penyedia.id),
      nama: p.penyedia.nama,
      alamat: p.penyedia.alamat,
      nama_direktur: p.penyedia.nama_direktur,
      jabatan_direktur: p.penyedia.jabatan_direktur,
      no_rekening: p.penyedia.no_rekening,
      nama_bank: p.penyedia.nama_bank,
      npwp: p.penyedia.npwp,
    } : null;
    base.bidang = p.bidangs ? { id: Number(p.bidangs.id), nama: p.bidangs.nama } : null;
    base.master_kegiatan = p.anggaran_master_kegiatan ? {
      id: Number(p.anggaran_master_kegiatan.id),
      kode_sub_kegiatan: p.anggaran_master_kegiatan.kode_sub_kegiatan,
      nama_sub_kegiatan: p.anggaran_master_kegiatan.nama_sub_kegiatan,
      nama_program: p.anggaran_master_kegiatan.nama_program,
      nama_kegiatan: p.anggaran_master_kegiatan.nama_kegiatan,
    } : null;
    base.pagu = p.anggaran_pagu ? {
      id: Number(p.anggaran_pagu.id),
      tahun: p.anggaran_pagu.tahun,
      pagu: num(p.anggaran_pagu.pagu),
    } : null;
    base.ppk = userBrief(p.users_pencairan_ppk_idTousers);
    base.kpa = userBrief(p.users_pencairan_kpa_idTousers);
    base.pptk = userBrief(p.users_pencairan_pptk_idTousers);
    base.bendahara = userBrief(p.users_pencairan_bendahara_pengeluaran_idTousers);
    base.pengurus_barang = userBrief(p.users_pencairan_pengurus_barang_idTousers);
    base.atasan_pengurus_barang = userBrief(p.users_pencairan_atasan_pengurus_barang_idTousers);
    base.penerima_faktur = userBrief(p.users_pencairan_penerima_faktur_idTousers);
    base.finalized_by_user = userBrief(p.users_pencairan_finalized_byTousers);
    base.items = p.pencairan_items ? p.pencairan_items.map(serializeItem) : [];
    base.pemeriksa = p.pencairan_pemeriksa ? p.pencairan_pemeriksa.map(serializePemeriksa) : [];
  }

  return base;
};

const detailInclude = {
  penyedia: true,
  bidangs: { select: { id: true, nama: true } },
  anggaran_master_kegiatan: {
    select: { id: true, kode_sub_kegiatan: true, nama_sub_kegiatan: true, nama_program: true, nama_kegiatan: true },
  },
  anggaran_pagu: { select: { id: true, tahun: true, pagu: true } },
  users_pencairan_ppk_idTousers: { select: { id: true, name: true, pegawai: { select: { nip: true, jabatan: true } } } },
  users_pencairan_kpa_idTousers: { select: { id: true, name: true, pegawai: { select: { nip: true, jabatan: true } } } },
  users_pencairan_pptk_idTousers: { select: { id: true, name: true, pegawai: { select: { nip: true, jabatan: true } } } },
  users_pencairan_bendahara_pengeluaran_idTousers: { select: { id: true, name: true, pegawai: { select: { nip: true, jabatan: true } } } },
  users_pencairan_pengurus_barang_idTousers: { select: { id: true, name: true, pegawai: { select: { nip: true, jabatan: true } } } },
  users_pencairan_atasan_pengurus_barang_idTousers: { select: { id: true, name: true, pegawai: { select: { nip: true, jabatan: true } } } },
  users_pencairan_penerima_faktur_idTousers: { select: { id: true, name: true, pegawai: { select: { nip: true, jabatan: true } } } },
  users_pencairan_finalized_byTousers: { select: { id: true, name: true, pegawai: { select: { nip: true, jabatan: true } } } },
  pencairan_items: { orderBy: { urutan: 'asc' } },
  pencairan_pemeriksa: {
    orderBy: { urutan: 'asc' },
    include: { users: { select: { id: true, name: true, pegawai: { select: { nip: true, jabatan: true } } } } },
  },
};

// ─── Validation helpers ───────────────────────────────────────────────────────
const VALID_JENIS = ['atk', 'cetak', 'makmin', 'perjadin', 'jasa', 'hibah', 'lainnya'];

const computeTotal = (items = []) =>
  items.reduce((s, i) => s + (decOrZero(i.qty) * decOrZero(i.harga_satuan)), 0);

// ─── GET /api/pencairan ───────────────────────────────────────────────────────
router.get('/', auth, checkRole(ALLOWED_ROLES), async (req, res) => {
  try {
    const { jenis, status, bidang_id, master_kegiatan_id, pagu_id, tahun, search } = req.query;
    const where = {};
    if (jenis) where.jenis_pencairan = jenis;
    if (status) where.status = status;
    if (bidang_id) where.bidang_id = BigInt(bidang_id);
    if (master_kegiatan_id) where.master_kegiatan_id = BigInt(master_kegiatan_id);
    if (pagu_id) where.pagu_id = BigInt(pagu_id);
    if (tahun) where.tahun_anggaran = parseInt(tahun);
    if (search) {
      where.OR = [
        { no_pesanan_a: { contains: search } },
        { no_pesanan_b: { contains: search } },
        { no_faktur: { contains: search } },
        { uraian_kegiatan: { contains: search } },
      ];
    }

    const list = await prisma.pencairan.findMany({
      where,
      orderBy: { created_at: 'desc' },
      include: {
        penyedia: { select: { id: true, nama: true } },
        bidangs: { select: { id: true, nama: true } },
        anggaran_master_kegiatan: { select: { id: true, kode_sub_kegiatan: true, nama_sub_kegiatan: true } },
        _count: { select: { pencairan_items: true } },
      },
    });

    const data = list.map(p => ({
      ...serialize(p),
      penyedia: p.penyedia ? { id: Number(p.penyedia.id), nama: p.penyedia.nama } : null,
      bidang: p.bidangs ? { id: Number(p.bidangs.id), nama: p.bidangs.nama } : null,
      master_kegiatan: p.anggaran_master_kegiatan ? {
        id: Number(p.anggaran_master_kegiatan.id),
        kode_sub_kegiatan: p.anggaran_master_kegiatan.kode_sub_kegiatan,
        nama_sub_kegiatan: p.anggaran_master_kegiatan.nama_sub_kegiatan,
      } : null,
      jumlah_item: p._count.pencairan_items,
    }));

    res.json({ success: true, data });
  } catch (error) {
    console.error('Error fetching pencairan list:', error);
    res.status(500).json({ success: false, message: 'Gagal mengambil daftar pencairan', error: error.message });
  }
});

// ─── GET /api/pencairan/:id ───────────────────────────────────────────────────
router.get('/:id', auth, checkRole(ALLOWED_ROLES), async (req, res) => {
  try {
    const id = parseIdParam(req.params.id);
    if (id === null) {
      return res.status(400).json({ success: false, message: 'ID pencairan tidak valid' });
    }

    const p = await prisma.pencairan.findUnique({
      where: { id },
      include: detailInclude,
    });
    if (!p) return res.status(404).json({ success: false, message: 'Pencairan tidak ditemukan' });
    res.json({ success: true, data: serialize(p, { includeRelations: true }) });
  } catch (error) {
    console.error('Error fetching pencairan detail:', error);
    res.status(500).json({ success: false, message: 'Gagal mengambil detail pencairan', error: error.message });
  }
});

// ─── GET /api/pencairan/:id/excel ─────────────────────────────────────────────
// Generate file Excel "File Pencairan ATK" lengkap (10 sheet) dengan data terisi
router.get('/:id/excel', auth, checkRole(ALLOWED_ROLES), async (req, res) => {
  try {
    const id = parseIdParam(req.params.id);
    if (id === null) {
      return res.status(400).json({ success: false, message: 'ID pencairan tidak valid' });
    }

    const p = await prisma.pencairan.findUnique({
      where: { id },
      include: detailInclude,
    });
    if (!p) return res.status(404).json({ success: false, message: 'Pencairan tidak ditemukan' });

    const data = serialize(p, { includeRelations: true });
    const wb = await generateAtkExcel(data);

    const noDok = (data.no_pesanan_b || `pencairan-${data.id}`).replace(/[/\\:*?"<>|]/g, '-');
    const filename = `File Pencairan ATK - ${noDok}.xlsx`;

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`);

    await wb.xlsx.write(res);
    res.end();
  } catch (error) {
    console.error('Error generating Excel:', error);
    res.status(500).json({ success: false, message: 'Gagal generate Excel', error: error.message });
  }
});

// ─── POST /api/pencairan ──────────────────────────────────────────────────────
router.post('/', auth, checkRole(ALLOWED_ROLES), async (req, res) => {
  try {
    const body = req.body;

    // Validasi minimal
    if (!body.master_kegiatan_id || !body.pagu_id || !body.tahun_anggaran || !body.bidang_id) {
      return res.status(400).json({
        success: false,
        message: 'master_kegiatan_id, pagu_id, tahun_anggaran, dan bidang_id wajib diisi',
      });
    }
    if (body.jenis_pencairan && !VALID_JENIS.includes(body.jenis_pencairan)) {
      return res.status(400).json({ success: false, message: `jenis_pencairan harus salah satu: ${VALID_JENIS.join(', ')}` });
    }
    if (!Array.isArray(body.items) || body.items.length === 0) {
      return res.status(400).json({ success: false, message: 'Minimal 1 item harus dipilih' });
    }

    const total = computeTotal(body.items);

    // Transaction: create header → items → pemeriksa
    const created = await prisma.$transaction(async (tx) => {
      const header = await tx.pencairan.create({
        data: {
          jenis_pencairan: body.jenis_pencairan || 'atk',
          master_kegiatan_id: BigInt(body.master_kegiatan_id),
          pagu_id: BigInt(body.pagu_id),
          tahun_anggaran: parseInt(body.tahun_anggaran),
          bidang_id: BigInt(body.bidang_id),
          uraian_kegiatan: body.uraian_kegiatan || null,
          penyedia_id: bigOrNull(body.penyedia_id),
          ppk_id: bigOrNull(body.ppk_id),
          kpa_id: bigOrNull(body.kpa_id),
          pptk_id: bigOrNull(body.pptk_id),
          bendahara_pengeluaran_id: bigOrNull(body.bendahara_pengeluaran_id),
          pengurus_barang_id: bigOrNull(body.pengurus_barang_id),
          atasan_pengurus_barang_id: bigOrNull(body.atasan_pengurus_barang_id),
          penerima_faktur_id: bigOrNull(body.penerima_faktur_id),
          tgl_pesanan: body.tgl_pesanan ? new Date(body.tgl_pesanan) : null,
          tgl_surat_perintah_tugas: body.tgl_surat_perintah_tugas ? new Date(body.tgl_surat_perintah_tugas) : null,
          tgl_faktur: body.tgl_faktur ? new Date(body.tgl_faktur) : null,
          tgl_kwitansi: body.tgl_kwitansi ? new Date(body.tgl_kwitansi) : null,
          tgl_ba_pemeriksaan: body.tgl_ba_pemeriksaan ? new Date(body.tgl_ba_pemeriksaan) : null,
          tgl_bast: body.tgl_bast ? new Date(body.tgl_bast) : null,
          tgl_basthp: body.tgl_basthp ? new Date(body.tgl_basthp) : null,
          no_pesanan_a: body.no_pesanan_a || null,
          no_pesanan_b: body.no_pesanan_b || null,
          no_faktur: body.no_faktur || null,
          no_kwitansi: body.no_kwitansi || null,
          no_ba_pemeriksaan: body.no_ba_pemeriksaan || null,
          no_bast: body.no_bast || null,
          no_basthp: body.no_basthp || null,
          no_bappbj: body.no_bappbj || null,
          no_lampiran_bat: body.no_lampiran_bat || null,
          no_surat_perintah_tugas: body.no_surat_perintah_tugas || null,
          no_sk_bupati_kpa: body.no_sk_bupati_kpa || null,
          no_sk_kadis_ppk: body.no_sk_kadis_ppk || null,
          total_nilai: total,
          total_terbilang: body.total_terbilang || null,
          metadata: body.metadata || null,
          status: body.status || 'draft',
          created_by: BigInt(req.user.id),
        },
      });

      // Items
      if (body.items.length > 0) {
        await tx.pencairan_items.createMany({
          data: body.items.map((it, idx) => ({
            pencairan_id: header.id,
            rka_item_id: bigOrNull(it.rka_item_id),
            nama_barang: it.nama_barang,
            spesifikasi: it.spesifikasi || null,
            kode_rekening: it.kode_rekening || null,
            qty: decOrZero(it.qty),
            satuan: it.satuan,
            harga_satuan: decOrZero(it.harga_satuan),
            ppn: decOrZero(it.ppn),
            total: decOrZero(it.qty) * decOrZero(it.harga_satuan),
            status_pemeriksaan: it.status_pemeriksaan || 'baik',
            urutan: it.urutan ?? idx + 1,
          })),
        });
      }

      // Pemeriksa
      if (Array.isArray(body.pemeriksa) && body.pemeriksa.length > 0) {
        await tx.pencairan_pemeriksa.createMany({
          data: body.pemeriksa.map((m, idx) => ({
            pencairan_id: header.id,
            user_id: BigInt(m.user_id),
            peran: idx === 0 ? 'ketua' : 'anggota',
            urutan: idx + 1,
          })),
        });
      }

      return header;
    });

    const full = await prisma.pencairan.findUnique({
      where: { id: created.id },
      include: detailInclude,
    });
    res.status(201).json({ success: true, message: 'Pencairan berhasil dibuat', data: serialize(full, { includeRelations: true }) });
  } catch (error) {
    console.error('Error creating pencairan:', error);
    res.status(500).json({ success: false, message: 'Gagal membuat pencairan', error: error.message });
  }
});

// ─── PUT /api/pencairan/:id ───────────────────────────────────────────────────
router.put('/:id', auth, checkRole(ALLOWED_ROLES), async (req, res) => {
  try {
    const id = parseIdParam(req.params.id);
    if (id === null) {
      return res.status(400).json({ success: false, message: 'ID pencairan tidak valid' });
    }

    const existing = await prisma.pencairan.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ success: false, message: 'Pencairan tidak ditemukan' });
    if (existing.status === 'finalized') {
      return res.status(400).json({ success: false, message: 'Pencairan yang sudah final tidak dapat diubah' });
    }

    const body = req.body;
    if (body.jenis_pencairan && !VALID_JENIS.includes(body.jenis_pencairan)) {
      return res.status(400).json({ success: false, message: `jenis_pencairan harus salah satu: ${VALID_JENIS.join(', ')}` });
    }

    // Build header update data (only fields present)
    const data = {};
    const setIf = (k, v) => { if (v !== undefined) data[k] = v; };
    setIf('jenis_pencairan', body.jenis_pencairan);
    setIf('uraian_kegiatan', body.uraian_kegiatan);
    if (body.penyedia_id !== undefined) data.penyedia_id = bigOrNull(body.penyedia_id);
    if (body.ppk_id !== undefined) data.ppk_id = bigOrNull(body.ppk_id);
    if (body.kpa_id !== undefined) data.kpa_id = bigOrNull(body.kpa_id);
    if (body.pptk_id !== undefined) data.pptk_id = bigOrNull(body.pptk_id);
    if (body.bendahara_pengeluaran_id !== undefined) data.bendahara_pengeluaran_id = bigOrNull(body.bendahara_pengeluaran_id);
    if (body.pengurus_barang_id !== undefined) data.pengurus_barang_id = bigOrNull(body.pengurus_barang_id);
    if (body.atasan_pengurus_barang_id !== undefined) data.atasan_pengurus_barang_id = bigOrNull(body.atasan_pengurus_barang_id);
    if (body.penerima_faktur_id !== undefined) data.penerima_faktur_id = bigOrNull(body.penerima_faktur_id);
    [
      'tgl_pesanan','tgl_surat_perintah_tugas','tgl_faktur','tgl_kwitansi',
      'tgl_ba_pemeriksaan','tgl_bast','tgl_basthp',
    ].forEach(k => { if (body[k] !== undefined) data[k] = body[k] ? new Date(body[k]) : null; });
    [
      'no_pesanan_a','no_pesanan_b','no_faktur','no_kwitansi','no_ba_pemeriksaan',
      'no_bast','no_basthp','no_bappbj','no_lampiran_bat','no_surat_perintah_tugas',
      'no_sk_bupati_kpa','no_sk_kadis_ppk','total_terbilang',
    ].forEach(k => setIf(k, body[k]));
    if (body.metadata !== undefined) data.metadata = body.metadata;

    // Hitung ulang total kalau items diupdate
    const itemsProvided = Array.isArray(body.items);
    if (itemsProvided) data.total_nilai = computeTotal(body.items);

    await prisma.$transaction(async (tx) => {
      await tx.pencairan.update({ where: { id }, data });

      if (itemsProvided) {
        await tx.pencairan_items.deleteMany({ where: { pencairan_id: id } });
        if (body.items.length > 0) {
          await tx.pencairan_items.createMany({
            data: body.items.map((it, idx) => ({
              pencairan_id: id,
              rka_item_id: bigOrNull(it.rka_item_id),
              nama_barang: it.nama_barang,
              spesifikasi: it.spesifikasi || null,
              kode_rekening: it.kode_rekening || null,
              qty: decOrZero(it.qty),
              satuan: it.satuan,
              harga_satuan: decOrZero(it.harga_satuan),
              ppn: decOrZero(it.ppn),
              total: decOrZero(it.qty) * decOrZero(it.harga_satuan),
              status_pemeriksaan: it.status_pemeriksaan || 'baik',
              urutan: it.urutan ?? idx + 1,
            })),
          });
        }
      }

      if (Array.isArray(body.pemeriksa)) {
        await tx.pencairan_pemeriksa.deleteMany({ where: { pencairan_id: id } });
        if (body.pemeriksa.length > 0) {
          await tx.pencairan_pemeriksa.createMany({
            data: body.pemeriksa.map((m, idx) => ({
              pencairan_id: id,
              user_id: BigInt(m.user_id),
              peran: idx === 0 ? 'ketua' : 'anggota',
              urutan: idx + 1,
            })),
          });
        }
      }
    });

    const full = await prisma.pencairan.findUnique({
      where: { id },
      include: detailInclude,
    });
    res.json({ success: true, message: 'Pencairan berhasil diupdate', data: serialize(full, { includeRelations: true }) });
  } catch (error) {
    console.error('Error updating pencairan:', error);
    res.status(500).json({ success: false, message: 'Gagal mengupdate pencairan', error: error.message });
  }
});

// ─── POST /api/pencairan/:id/finalize ─────────────────────────────────────────
router.post('/:id/finalize', auth, checkRole(ALLOWED_ROLES), async (req, res) => {
  try {
    const id = parseIdParam(req.params.id);
    if (id === null) {
      return res.status(400).json({ success: false, message: 'ID pencairan tidak valid' });
    }

    const existing = await prisma.pencairan.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ success: false, message: 'Pencairan tidak ditemukan' });
    if (existing.status === 'finalized') {
      return res.status(400).json({ success: false, message: 'Pencairan sudah final' });
    }
    if (existing.status === 'cancelled') {
      return res.status(400).json({ success: false, message: 'Pencairan dibatalkan, tidak bisa difinalisasi' });
    }
    const updated = await prisma.pencairan.update({
      where: { id },
      data: {
        status: 'finalized',
        finalized_at: new Date(),
        finalized_by: BigInt(req.user.id),
      },
    });
    res.json({ success: true, message: 'Pencairan berhasil difinalisasi', data: serialize(updated) });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Gagal finalisasi pencairan', error: error.message });
  }
});

// ─── POST /api/pencairan/:id/cancel ───────────────────────────────────────────
router.post('/:id/cancel', auth, checkRole(ALLOWED_ROLES), async (req, res) => {
  try {
    const id = parseIdParam(req.params.id);
    if (id === null) {
      return res.status(400).json({ success: false, message: 'ID pencairan tidak valid' });
    }

    const existing = await prisma.pencairan.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ success: false, message: 'Pencairan tidak ditemukan' });
    if (existing.status === 'cancelled') {
      return res.status(400).json({ success: false, message: 'Pencairan sudah dibatalkan' });
    }
    const updated = await prisma.pencairan.update({
      where: { id },
      data: { status: 'cancelled' },
    });
    res.json({ success: true, message: 'Pencairan dibatalkan', data: serialize(updated) });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Gagal membatalkan pencairan', error: error.message });
  }
});

// ─── DELETE /api/pencairan/:id ────────────────────────────────────────────────
router.delete('/:id', auth, checkRole(ALLOWED_ROLES), async (req, res) => {
  try {
    const id = parseIdParam(req.params.id);
    if (id === null) {
      return res.status(400).json({ success: false, message: 'ID pencairan tidak valid' });
    }

    const existing = await prisma.pencairan.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ success: false, message: 'Pencairan tidak ditemukan' });
    if (existing.status === 'finalized') {
      return res.status(400).json({ success: false, message: 'Pencairan yang sudah final tidak bisa dihapus. Batalkan terlebih dahulu.' });
    }
    await prisma.pencairan.delete({ where: { id } });
    res.json({ success: true, message: 'Pencairan berhasil dihapus' });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Gagal menghapus pencairan', error: error.message });
  }
});

module.exports = router;
