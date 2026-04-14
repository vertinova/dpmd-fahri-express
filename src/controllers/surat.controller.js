const prisma = require('../config/prisma');
const path = require('path');
const fs = require('fs').promises;
const PushNotificationService = require('../services/pushNotificationService');
const ActivityLogger = require('../utils/activityLogger');

// Wrapper to match old interface
const sendDisposisiNotification = async (disposisi) => {
  const dariUser = disposisi.users_disposisi_dari_user_idTousers;
  const keUser = disposisi.users_disposisi_ke_user_idTousers;
  const surat = disposisi.surat_masuk;

  if (!keUser?.id) return;

  const disposisiData = {
    id: disposisi.id,
    perihal: surat?.perihal || 'Disposisi baru',
    dari_user: dariUser?.name || 'Unknown',
    nomor_surat: surat?.nomor_surat || ''
  };

  await PushNotificationService.notifyNewDisposisi(
    disposisiData,
    [parseInt(keUser.id)]
  );
};

/**
 * @route POST /api/surat-masuk
 * @desc Create surat masuk (Sekretariat only)
 */
exports.createSuratMasuk = async (req, res, next) => {
  try {
    const {
      nomor_surat,
      tanggal_surat,
      tanggal_terima,
      pengirim,
      perihal,
      jenis_surat,
      keterangan,
    } = req.body;

    const created_by = req.user.id;

    // Validate nomor_surat unique
    const existingSurat = await prisma.surat_masuk.findUnique({
      where: { nomor_surat },
    });

    if (existingSurat) {
      return res.status(400).json({
        success: false,
        message: 'Nomor surat sudah terdaftar',
      });
    }

    const surat = await prisma.surat_masuk.create({
      data: {
        nomor_surat,
        tanggal_surat: new Date(tanggal_surat),
        tanggal_terima: tanggal_terima ? new Date(tanggal_terima) : new Date(),
        pengirim,
        perihal,
        jenis_surat: jenis_surat || 'biasa',
        keterangan,
        status: 'draft',
        created_by,
      },
      include: {
        users: {
          select: { id: true, name: true, email: true, role: true },
        },
      },
    });

    // Log activity
    await ActivityLogger.log({
      userId: req.user.id,
      userName: req.user.nama || req.user.name || req.user.email,
      userRole: req.user.role,
      bidangId: 2, // Sekretariat
      module: 'surat_masuk',
      action: 'create',
      entityType: 'surat_masuk',
      entityId: Number(surat.id),
      entityName: perihal,
      description: `${req.user.nama || req.user.name || req.user.email} membuat surat masuk: ${perihal} (No: ${nomor_surat})`,
      newValue: { nomor_surat, pengirim, perihal },
      ipAddress: ActivityLogger.getIpFromRequest(req),
      userAgent: ActivityLogger.getUserAgentFromRequest(req)
    });

    res.status(201).json({
      success: true,
      message: 'Surat masuk berhasil dibuat',
      data: surat,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @route POST /api/surat-masuk/:id/upload
 * @desc Upload file surat (PDF/JPG/PNG)
 */
exports.uploadFileSurat = async (req, res, next) => {
  try {
    const { id } = req.params;

    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'File tidak ditemukan',
      });
    }

    const surat = await prisma.surat_masuk.findUnique({
      where: { id: BigInt(id) },
    });

    if (!surat) {
      // Delete uploaded file
      await fs.unlink(req.file.path);
      return res.status(404).json({
        success: false,
        message: 'Surat tidak ditemukan',
      });
    }

    // Delete old file if exists
    if (surat.file_path) {
      const oldFilePath = path.join(__dirname, '../../', surat.file_path);
      try {
        await fs.unlink(oldFilePath);
      } catch (err) {
        console.log('Old file not found, skip deletion');
      }
    }

    const updatedSurat = await prisma.surat_masuk.update({
      where: { id: BigInt(id) },
      data: {
        file_path: req.file.path.replace(/\\/g, '/'),
      },
    });

    // Log activity
    await ActivityLogger.log({
      userId: req.user.id,
      userName: req.user.nama || req.user.name || req.user.email,
      userRole: req.user.role,
      bidangId: 2, // Sekretariat
      module: 'surat_masuk',
      action: 'upload',
      entityType: 'surat_masuk',
      entityId: Number(updatedSurat.id),
      entityName: surat.perihal || `Surat #${id}`,
      description: `${req.user.nama || req.user.name || req.user.email} mengupload file untuk surat: ${surat.perihal || surat.nomor_surat}`,
      newValue: { filename: req.file.originalname, size: req.file.size },
      ipAddress: ActivityLogger.getIpFromRequest(req),
      userAgent: ActivityLogger.getUserAgentFromRequest(req)
    });

    res.json({
      success: true,
      message: 'File berhasil diupload',
      data: updatedSurat,
    });
  } catch (error) {
    // Delete uploaded file on error
    if (req.file) {
      await fs.unlink(req.file.path).catch(console.error);
    }
    next(error);
  }
};

/**
 * @route GET /api/surat-masuk
 * @desc Get all surat masuk with filters
 */
exports.getAllSuratMasuk = async (req, res, next) => {
  try {
    const { status, jenis_surat, search, page = 1, limit = 20 } = req.query;

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const take = parseInt(limit);

    const where = {};

    if (status) where.status = status;
    if (jenis_surat) where.jenis_surat = jenis_surat;
    if (search) {
      where.OR = [
        { nomor_surat: { contains: search } },
        { pengirim: { contains: search } },
        { perihal: { contains: search } },
      ];
    }

    console.log('[getAllSuratMasuk] Query params:', req.query);
    console.log('[getAllSuratMasuk] Where clause:', JSON.stringify(where));

    const [total, surat] = await Promise.all([
      prisma.surat_masuk.count({ where }),
      prisma.surat_masuk.findMany({
        where,
        include: {
          users: {
            select: { id: true, name: true, email: true },
          },
          disposisi: {
            select: { id: true, status: true, level_disposisi: true },
            orderBy: { created_at: 'desc' },
            take: 1,
          },
        },
        orderBy: { tanggal_terima: 'desc' },
        skip,
        take,
      }),
    ]);

    console.log(`[getAllSuratMasuk] Found ${total} total, ${surat.length} returned`);

    res.json({
      success: true,
      data: surat,
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        totalPages: Math.ceil(total / parseInt(limit)),
      },
    });
  } catch (error) {
    console.error('[getAllSuratMasuk] Error:', error.message);
    console.error('[getAllSuratMasuk] Stack:', error.stack);
    next(error);
  }
};

/**
 * @route GET /api/surat-masuk/:id
 * @desc Get single surat masuk dengan history disposisi
 */
exports.getSuratMasukById = async (req, res, next) => {
  try {
    const { id } = req.params;

    const surat = await prisma.surat_masuk.findUnique({
      where: { id: BigInt(id) },
      include: {
        users: {
          select: { id: true, name: true, email: true, role: true },
        },
        disposisi: {
          include: {
            users_disposisi_dari_user_idTousers: {
              select: { id: true, name: true, email: true, role: true },
            },
            users_disposisi_ke_user_idTousers: {
              select: { id: true, name: true, email: true, role: true },
            },
          },
          orderBy: { level_disposisi: 'asc' },
        },
        lampiran_surat: {
          include: {
            users: {
              select: { id: true, name: true },
            },
          },
        },
      },
    });

    if (!surat) {
      return res.status(404).json({
        success: false,
        message: 'Surat tidak ditemukan',
      });
    }

    res.json({
      success: true,
      data: surat,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @route PUT /api/surat-masuk/:id
 * @desc Update surat masuk
 */
exports.updateSuratMasuk = async (req, res, next) => {
  try {
    const { id } = req.params;
    const updateData = { ...req.body };

    // Convert dates
    if (updateData.tanggal_surat) {
      updateData.tanggal_surat = new Date(updateData.tanggal_surat);
    }
    if (updateData.tanggal_terima) {
      updateData.tanggal_terima = new Date(updateData.tanggal_terima);
    }

    const surat = await prisma.surat_masuk.update({
      where: { id: BigInt(id) },
      data: updateData,
    });

    // Log activity
    await ActivityLogger.log({
      userId: req.user.id,
      userName: req.user.nama || req.user.name || req.user.email,
      userRole: req.user.role,
      bidangId: 2, // Sekretariat
      module: 'surat_masuk',
      action: 'update',
      entityType: 'surat_masuk',
      entityId: Number(surat.id),
      entityName: surat.perihal || `Surat #${id}`,
      description: `${req.user.nama || req.user.name || req.user.email} memperbarui surat masuk: ${surat.perihal || surat.nomor_surat}`,
      newValue: updateData,
      ipAddress: ActivityLogger.getIpFromRequest(req),
      userAgent: ActivityLogger.getUserAgentFromRequest(req)
    });

    res.json({
      success: true,
      message: 'Surat berhasil diupdate',
      data: surat,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @route DELETE /api/surat-masuk/:id
 * @desc Delete surat masuk (cascade delete disposisi & lampiran)
 */
exports.deleteSuratMasuk = async (req, res, next) => {
  try {
    const { id } = req.params;

    const surat = await prisma.surat_masuk.findUnique({
      where: { id: BigInt(id) },
    });

    if (!surat) {
      return res.status(404).json({
        success: false,
        message: 'Surat tidak ditemukan',
      });
    }

    // Delete file if exists
    if (surat.file_path) {
      const filePath = path.join(__dirname, '../../', surat.file_path);
      await fs.unlink(filePath).catch(console.error);
    }

    await prisma.surat_masuk.delete({
      where: { id: BigInt(id) },
    });

    // Log activity
    await ActivityLogger.log({
      userId: req.user.id,
      userName: req.user.nama || req.user.name || req.user.email,
      userRole: req.user.role,
      bidangId: 2, // Sekretariat
      module: 'surat_masuk',
      action: 'delete',
      entityType: 'surat_masuk',
      entityId: Number(id),
      entityName: surat.perihal || `Surat #${id}`,
      description: `${req.user.nama || req.user.name || req.user.email} menghapus surat masuk: ${surat.perihal} (No: ${surat.nomor_surat})`,
      oldValue: { nomor_surat: surat.nomor_surat, perihal: surat.perihal, pengirim: surat.pengirim },
      ipAddress: ActivityLogger.getIpFromRequest(req),
      userAgent: ActivityLogger.getUserAgentFromRequest(req)
    });

    res.json({
      success: true,
      message: 'Surat berhasil dihapus',
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @route POST /api/surat-masuk/:id/kirim-kepala-dinas
 * @desc Kirim surat ke Kepala Dinas (create disposisi level 1)
 */
exports.kirimKeKepalaDinas = async (req, res, next) => {
  try {
    console.log('\n═══════════════════════════════════════');
    console.log('📨 [SURAT] KIRIM KE KEPALA DINAS (DRAFT)');
    console.log('═══════════════════════════════════════');

    const { id } = req.params;
    const { kepala_dinas_user_id, catatan, instruksi } = req.body;
    const dari_user_id = req.user.id;

    // Normalize inputs to arrays
    const target_ids = Array.isArray(kepala_dinas_user_id) ? kepala_dinas_user_id : [kepala_dinas_user_id];
    
    // Normalize instruksi to string (JSON string if it's an array)
    let finalInstruksi = 'laksanakan';
    if (Array.isArray(instruksi)) {
      finalInstruksi = JSON.stringify(instruksi);
    } else if (instruksi) {
      finalInstruksi = String(instruksi);
    }

    console.log('📋 Request Data:', {
      surat_id: id,
      dari_user_id: dari_user_id.toString(),
      target_count: target_ids.length,
      instruksi: finalInstruksi
    });

    // Validate ALL target Kepala Dinas users
    const validUsers = await prisma.users.findMany({
      where: { 
        id: { in: target_ids.map(id => BigInt(id)) },
        role: 'kepala_dinas'
      },
    });

    if (validUsers.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Tidak ada user Kepala Dinas yang valid ditemukan',
      });
    }

    const createdDisposisis = [];

    // Use transaction if possible, but for simplicity we iterate (same pattern as disposisi.controller)
    for (const kDinas of validUsers) {
      const disposisi = await prisma.disposisi.create({
        data: {
          surat_id: BigInt(id),
          dari_user_id: BigInt(dari_user_id),
          ke_user_id: BigInt(kDinas.id),
          catatan,
          instruksi: finalInstruksi,
          status: 'pending',
          level_disposisi: 1,
        },
        include: {
          users_disposisi_dari_user_idTousers: {
            select: { id: true, name: true, email: true },
          },
          users_disposisi_ke_user_idTousers: {
            select: { id: true, name: true, email: true },
          },
          surat_masuk: {
            select: { id: true, nomor_surat: true, perihal: true, pengirim: true },
          },
        },
      });

      createdDisposisis.push(disposisi);

      // Send push notification
      try {
        await sendDisposisiNotification(disposisi);
      } catch (notifError) {
        console.error(`[SURAT] Error sending push notification to ${kDinas.name}:`, notifError.message);
      }

      // Log activity for each
      await ActivityLogger.log({
        userId: req.user.id,
        userName: req.user.nama || req.user.name || req.user.email,
        userRole: req.user.role,
        bidangId: 2, // Sekretariat
        module: 'surat_masuk',
        action: 'send',
        entityType: 'disposisi',
        entityId: Number(disposisi.id),
        entityName: disposisi.surat_masuk?.perihal || `Surat #${id}`,
        description: `${req.user.nama || req.user.name || req.user.email} mengirim surat ke Kepala Dinas ${kDinas.name}: ${disposisi.surat_masuk?.perihal || 'Surat'}`,
        newValue: { kepala_dinas: kDinas.name, instruksi: finalInstruksi, catatan },
        ipAddress: ActivityLogger.getIpFromRequest(req),
        userAgent: ActivityLogger.getUserAgentFromRequest(req)
      });
    }

    // Update surat status to 'dikirim' (only once)
    await prisma.surat_masuk.update({
      where: { id: BigInt(id) },
      data: { status: 'dikirim' },
    });

    res.status(201).json({
      success: true,
      message: `Surat berhasil dikirim ke ${validUsers.length} Kepala Dinas`,
      data: createdDisposisis,
    });
  } catch (error) {
    next(error);
  }
};