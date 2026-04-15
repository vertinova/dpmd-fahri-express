/**
 * Nomor Surat Controller
 * Handles letter number requests by DPMD staff
 */
const prisma = require('../config/prisma');

const BIDANG_MAP = {
  2: 'Sekretariat',
  3: 'SPKED',
  4: 'KKD',
  5: 'PMD',
  6: 'Pemdes',
};

/**
 * GET /api/nomor-surat/klasifikasi
 * Get classification codes (flat list, searchable)
 * Query params: search, level, parent_kode, roots (boolean)
 */
exports.getKlasifikasi = async (req, res) => {
  try {
    const { search, level, parent_kode, roots } = req.query;

    const where = { is_active: true };
    if (level) where.level = parseInt(level);

    // Fetch root categories (level 1, no parent)
    if (roots === 'true') {
      where.parent_kode = null;
    }

    // Fetch children of a specific parent
    if (parent_kode) {
      where.parent_kode = parent_kode;
    }

    if (search) {
      where.OR = [
        { kode: { contains: search } },
        { nama: { contains: search } },
      ];
    }

    const data = await prisma.klasifikasi_arsip.findMany({
      where,
      orderBy: { kode: 'asc' },
      take: 200,
    });

    // For each item, check if it has children
    const kodes = data.map(d => d.kode);
    const childCounts = await prisma.klasifikasi_arsip.groupBy({
      by: ['parent_kode'],
      where: { parent_kode: { in: kodes }, is_active: true },
      _count: true,
    });
    const childMap = {};
    childCounts.forEach(c => { childMap[c.parent_kode] = c._count; });

    const result = data.map(d => ({
      ...d,
      has_children: (childMap[d.kode] || 0) > 0,
      child_count: childMap[d.kode] || 0,
    }));

    res.json({ success: true, data: result });
  } catch (error) {
    console.error('[NomorSurat] getKlasifikasi error:', error);
    res.status(500).json({ success: false, message: 'Gagal memuat klasifikasi arsip' });
  }
};

/**
 * POST /api/nomor-surat/request
 * Request a new letter number
 */
exports.createRequest = async (req, res) => {
  try {
    const user = req.user;
    if (!user) return res.status(401).json({ success: false, message: 'Unauthorized' });

    const { klasifikasi_kode, perihal, catatan } = req.body;
    if (!klasifikasi_kode || !perihal) {
      return res.status(400).json({ success: false, message: 'Klasifikasi dan perihal wajib diisi' });
    }

    // Validate classification code exists
    const klasifikasi = await prisma.klasifikasi_arsip.findUnique({
      where: { kode: klasifikasi_kode },
    });
    if (!klasifikasi) {
      return res.status(400).json({ success: false, message: 'Kode klasifikasi tidak valid' });
    }

    const bidangId = user.bidang_id || 2; // default Sekretariat
    const bidangNama = BIDANG_MAP[bidangId] || 'Sekretariat';
    const tahun = new Date().getFullYear();

    // Get next registration number for this classification + year
    const lastRequest = await prisma.nomor_surat_requests.findFirst({
      where: { klasifikasi_kode, tahun },
      orderBy: { nomor_registrasi: 'desc' },
    });
    const nextNomor = (lastRequest?.nomor_registrasi || 0) + 1;

    // Format: KODE_KLASIFIKASI / NO_REGISTRASI - NAMA_BIDANG
    const nomorSurat = `${klasifikasi_kode}/${String(nextNomor).padStart(3, '0')}-${bidangNama}`;

    const request = await prisma.nomor_surat_requests.create({
      data: {
        klasifikasi_kode,
        nomor_registrasi: nextNomor,
        nomor_surat_generated: nomorSurat,
        perihal,
        bidang_id: bidangId,
        bidang_nama: bidangNama,
        requested_by: BigInt(user.id),
        requested_by_name: user.name || '',
        catatan: catatan || null,
        tahun,
      },
    });

    res.status(201).json({
      success: true,
      message: 'Nomor surat berhasil dibuat',
      data: {
        id: request.id.toString(),
        nomor_surat: nomorSurat,
        klasifikasi_kode,
        klasifikasi_nama: klasifikasi.nama,
        nomor_registrasi: nextNomor,
        perihal,
        bidang_nama: bidangNama,
        catatan,
        tahun,
        created_at: request.created_at,
      },
    });
  } catch (error) {
    // Handle unique constraint violation (race condition)
    if (error.code === 'P2002') {
      return res.status(409).json({ success: false, message: 'Nomor registrasi konflik, silakan coba lagi' });
    }
    console.error('[NomorSurat] createRequest error:', error);
    res.status(500).json({ success: false, message: 'Gagal membuat nomor surat' });
  }
};

/**
 * GET /api/nomor-surat/requests
 * List all letter number requests with filters
 */
exports.getRequests = async (req, res) => {
  try {
    const { search, bidang_id, tahun, page = 1, limit = 20 } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);
    const currentYear = new Date().getFullYear();

    const where = { tahun: parseInt(tahun) || currentYear };

    if (bidang_id) where.bidang_id = parseInt(bidang_id);
    if (search) {
      where.OR = [
        { nomor_surat_generated: { contains: search } },
        { perihal: { contains: search } },
        { klasifikasi_kode: { contains: search } },
        { requested_by_name: { contains: search } },
      ];
    }

    const [data, total] = await Promise.all([
      prisma.nomor_surat_requests.findMany({
        where,
        orderBy: { created_at: 'desc' },
        skip,
        take: parseInt(limit),
      }),
      prisma.nomor_surat_requests.count({ where }),
    ]);

    // Enrich with klasifikasi nama
    const kodes = [...new Set(data.map(d => d.klasifikasi_kode))];
    const klasifikasiMap = {};
    if (kodes.length > 0) {
      const klasifikasiList = await prisma.klasifikasi_arsip.findMany({
        where: { kode: { in: kodes } },
        select: { kode: true, nama: true },
      });
      klasifikasiList.forEach(k => { klasifikasiMap[k.kode] = k.nama; });
    }

    const enriched = data.map(d => ({
      id: d.id.toString(),
      klasifikasi_kode: d.klasifikasi_kode,
      klasifikasi_nama: klasifikasiMap[d.klasifikasi_kode] || '-',
      nomor_registrasi: d.nomor_registrasi,
      nomor_surat: d.nomor_surat_generated,
      perihal: d.perihal,
      bidang_id: d.bidang_id,
      bidang_nama: d.bidang_nama,
      requested_by: d.requested_by.toString(),
      requested_by_name: d.requested_by_name,
      catatan: d.catatan,
      tahun: d.tahun,
      created_at: d.created_at,
    }));

    res.json({
      success: true,
      data: enriched,
      meta: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        totalPages: Math.ceil(total / parseInt(limit)),
      },
    });
  } catch (error) {
    console.error('[NomorSurat] getRequests error:', error);
    res.status(500).json({ success: false, message: 'Gagal memuat data nomor surat' });
  }
};

/**
 * GET /api/nomor-surat/statistik
 * Get stats for current year
 */
exports.getStatistik = async (req, res) => {
  try {
    const tahun = parseInt(req.query.tahun) || new Date().getFullYear();

    const [total, byBidang] = await Promise.all([
      prisma.nomor_surat_requests.count({ where: { tahun } }),
      prisma.nomor_surat_requests.groupBy({
        by: ['bidang_nama'],
        where: { tahun },
        _count: { id: true },
      }),
    ]);

    res.json({
      success: true,
      data: {
        total,
        tahun,
        by_bidang: byBidang.reduce((acc, b) => {
          acc[b.bidang_nama] = b._count.id;
          return acc;
        }, {}),
      },
    });
  } catch (error) {
    console.error('[NomorSurat] getStatistik error:', error);
    res.status(500).json({ success: false, message: 'Gagal memuat statistik' });
  }
};

/**
 * DELETE /api/nomor-surat/:id
 * Delete a nomor surat request (only superadmin or sekretariat)
 */
exports.deleteRequest = async (req, res) => {
  try {
    const user = req.user;
    if (!user) return res.status(401).json({ success: false, message: 'Unauthorized' });

    const canDelete = user.role === 'superadmin' || Number(user.bidang_id) === 2;
    if (!canDelete) {
      return res.status(403).json({ success: false, message: 'Tidak memiliki akses' });
    }

    const { id } = req.params;
    await prisma.nomor_surat_requests.delete({ where: { id: BigInt(id) } });

    res.json({ success: true, message: 'Nomor surat berhasil dihapus' });
  } catch (error) {
    if (error.code === 'P2025') {
      return res.status(404).json({ success: false, message: 'Data tidak ditemukan' });
    }
    console.error('[NomorSurat] deleteRequest error:', error);
    res.status(500).json({ success: false, message: 'Gagal menghapus nomor surat' });
  }
};
