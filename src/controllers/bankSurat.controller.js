/**
 * @route DELETE /api/bank-surat/:id
 * @desc Delete surat by ID (only superadmin or staff bidang sekretariat)
 * @access Superadmin & Staff Sekretariat (bidang_id=2)
 */
exports.deleteSurat = async (req, res, next) => {
  try {
    const { id } = req.params;
    const user = req.user;
    if (!user) {
      console.error('[BankSurat] Delete error: req.user is undefined');
      return res.status(401).json({ success: false, message: 'User tidak terautentikasi. Silakan login ulang.' });
    }
    // Superadmin or any staff in bidang sekretariat (bidang_id=2)
    const isSuperadmin = user.role === 'superadmin';
    const isSekretariat = Number(user.bidang_id) === 2;
    if (!isSuperadmin && !isSekretariat) {
      console.warn(`[BankSurat] Delete forbidden: User ${user.id} (${user.role}) bidang_id=${user.bidang_id}`);
      return res.status(403).json({ success: false, message: 'Hanya superadmin atau staff sekretariat yang dapat menghapus surat' });
    }
    // Hapus surat
    const deleted = await prisma.surat_masuk.delete({ where: { id: BigInt(id) } });
    res.json({ success: true, message: 'Surat berhasil dihapus', data: deleted });
  } catch (error) {
    console.error('[BankSurat] Delete error:', error);
    next(error);
  }
};
const prisma = require('../config/prisma');

/**
 * Bank Surat Controller
 * Arsip surat untuk semua pegawai DPMD - searchable & exportable
 */

/**
 * @route GET /api/bank-surat
 * @desc Get all archived surat with search, filter, pagination
 * @access All DPMD staff
 */
exports.getAll = async (req, res, next) => {
  try {
    const {
      search,
      jenis_surat,
      status,
      tanggal_dari,
      tanggal_sampai,
      sort_by = 'tanggal_surat',
      sort_order = 'desc',
      page = 1,
      limit = 20,
    } = req.query;

    const skip = (parseInt(page) - 1) * parseInt(limit);

    // Build where clause
    const where = {};

    if (search) {
      where.OR = [
        { nomor_surat: { contains: search } },
        { pengirim: { contains: search } },
        { perihal: { contains: search } },
        { keterangan: { contains: search } },
      ];
    }

    if (jenis_surat) {
      where.jenis_surat = jenis_surat;
    }

    if (status) {
      where.status = status;
    }

    if (tanggal_dari || tanggal_sampai) {
      where.tanggal_surat = {};
      if (tanggal_dari) where.tanggal_surat.gte = new Date(tanggal_dari);
      if (tanggal_sampai) where.tanggal_surat.lte = new Date(tanggal_sampai);
    }

    // Build orderBy
    const allowedSorts = ['tanggal_surat', 'nomor_surat', 'pengirim', 'perihal', 'created_at'];
    const orderField = allowedSorts.includes(sort_by) ? sort_by : 'tanggal_surat';
    const orderDir = sort_order === 'asc' ? 'asc' : 'desc';

    const [data, total] = await Promise.all([
      prisma.surat_masuk.findMany({
        where,
        skip,
        take: parseInt(limit),
        orderBy: { [orderField]: orderDir },
        select: {
          id: true,
          nomor_surat: true,
          tanggal_surat: true,
          tanggal_terima: true,
          pengirim: true,
          perihal: true,
          jenis_surat: true,
          file_path: true,
          keterangan: true,
          status: true,
          created_at: true,
          users: {
            select: {
              id: true,
              name: true,
            }
          },
          disposisi: {
            select: {
              id: true,
              status: true,
              level_disposisi: true,
              instruksi: true,
              users_disposisi_dari_user_idTousers: {
                select: { id: true, name: true, role: true, bidang_id: true }
              },
              users_disposisi_ke_user_idTousers: {
                select: { id: true, name: true, role: true, bidang_id: true }
              },
            },
            orderBy: { level_disposisi: 'asc' }
          }
        }
      }),
      prisma.surat_masuk.count({ where })
    ]);

    // Transform response
    const transformed = data.map(surat => {
      const latestDisposisi = surat.disposisi?.length > 0
        ? surat.disposisi[surat.disposisi.length - 1]
        : null;

      return {
        id: surat.id,
        nomor_surat: surat.nomor_surat,
        tanggal_surat: surat.tanggal_surat,
        tanggal_terima: surat.tanggal_terima,
        pengirim: surat.pengirim,
        perihal: surat.perihal,
        jenis_surat: surat.jenis_surat,
        file_path: surat.file_path,
        keterangan: surat.keterangan,
        status: surat.status,
        created_by_name: surat.users?.name || null,
        created_at: surat.created_at,
        // Disposisi tracking
        total_disposisi: surat.disposisi?.length || 0,
        status_terakhir: latestDisposisi?.status || null,
        penerima_terakhir: latestDisposisi?.users_disposisi_ke_user_idTousers?.name || null,
        penerima_terakhir_bidang_id: latestDisposisi?.users_disposisi_ke_user_idTousers?.bidang_id ?? null,
        penerima_terakhir_jabatan: latestDisposisi?.users_disposisi_ke_user_idTousers?.role || null,
        instruksi_terakhir: latestDisposisi?.instruksi || null,
      };
    });

    res.json({
      success: true,
      data: transformed,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        totalPages: Math.ceil(total / parseInt(limit))
      }
    });
  } catch (error) {
    console.error('[BankSurat] Error:', error);
    next(error);
  }
};

/**
 * @route GET /api/bank-surat/export
 * @desc Export surat data as JSON (frontend converts to Excel)
 * @access All DPMD staff
 */
exports.exportData = async (req, res, next) => {
  try {
    const {
      search,
      jenis_surat,
      status,
      tanggal_dari,
      tanggal_sampai,
    } = req.query;

    // Build where clause (same as getAll)
    const where = {};

    if (search) {
      where.OR = [
        { nomor_surat: { contains: search } },
        { pengirim: { contains: search } },
        { perihal: { contains: search } },
        { keterangan: { contains: search } },
      ];
    }

    if (jenis_surat) where.jenis_surat = jenis_surat;
    if (status) where.status = status;

    if (tanggal_dari || tanggal_sampai) {
      where.tanggal_surat = {};
      if (tanggal_dari) where.tanggal_surat.gte = new Date(tanggal_dari);
      if (tanggal_sampai) where.tanggal_surat.lte = new Date(tanggal_sampai);
    }

    const data = await prisma.surat_masuk.findMany({
      where,
      orderBy: { tanggal_surat: 'desc' },
      select: {
        id: true,
        nomor_surat: true,
        tanggal_surat: true,
        tanggal_terima: true,
        pengirim: true,
        perihal: true,
        jenis_surat: true,
        keterangan: true,
        status: true,
        created_at: true,
        users: {
          select: { name: true }
        },
        disposisi: {
          select: {
            status: true,
            level_disposisi: true,
            instruksi: true,
            users_disposisi_ke_user_idTousers: {
              select: { name: true, role: true, bidang_id: true }
            },
          },
          orderBy: { level_disposisi: 'asc' }
        }
      }
    });

    // Transform for export
    const exportData = data.map((surat, idx) => {
      const latestDisposisi = surat.disposisi?.length > 0
        ? surat.disposisi[surat.disposisi.length - 1]
        : null;

      return {
        'No': idx + 1,
        'Nomor Surat': surat.nomor_surat,
        'Tanggal Surat': surat.tanggal_surat ? new Date(surat.tanggal_surat).toLocaleDateString('id-ID') : '-',
        'Tanggal Terima': surat.tanggal_terima ? new Date(surat.tanggal_terima).toLocaleDateString('id-ID') : '-',
        'Pengirim': surat.pengirim,
        'Perihal': surat.perihal,
        'Jenis Surat': surat.jenis_surat || '-',
        'Keterangan': surat.keterangan || '-',
        'Status Surat': surat.status || '-',
        'Diinput Oleh': surat.users?.name || '-',
        'Status Disposisi': latestDisposisi?.status || '-',
        'Instruksi': latestDisposisi?.instruksi || '-',
        'Penerima Terakhir': latestDisposisi?.users_disposisi_ke_user_idTousers?.name || '-',
      };
    });

    res.json({
      success: true,
      data: exportData,
      total: exportData.length,
    });
  } catch (error) {
    console.error('[BankSurat Export] Error:', error);
    next(error);
  }
};

/**
 * @route GET /api/bank-surat/statistik
 * @desc Get surat statistics
 * @access All DPMD staff
 */
exports.getStatistik = async (req, res, next) => {
  try {
    const [total, dikirim, selesai, draft, biasa, penting, segera, rahasia] = await Promise.all([
      prisma.surat_masuk.count(),
      prisma.surat_masuk.count({ where: { status: 'dikirim' } }),
      prisma.surat_masuk.count({ where: { status: 'selesai' } }),
      prisma.surat_masuk.count({ where: { status: 'draft' } }),
      prisma.surat_masuk.count({ where: { jenis_surat: 'biasa' } }),
      prisma.surat_masuk.count({ where: { jenis_surat: 'penting' } }),
      prisma.surat_masuk.count({ where: { jenis_surat: 'segera' } }),
      prisma.surat_masuk.count({ where: { jenis_surat: 'rahasia' } }),
    ]);

    res.json({
      success: true,
      data: {
        total,
        by_status: { dikirim, selesai, draft },
        by_jenis: { biasa, penting, segera, rahasia },
      }
    });
  } catch (error) {
    console.error('[BankSurat Statistik] Error:', error);
    next(error);
  }
};
