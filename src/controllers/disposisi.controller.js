const prisma = require('../config/prisma');
const PushNotificationService = require('../services/pushNotificationService');
const ActivityLogger = require('../utils/activityLogger');

/**
 * Helper function: Get role hierarchy level (Simple role-based)
 */
const getRoleLevel = (role) => {
  if (role === 'kepala_dinas') return 1;
  if (role === 'sekretaris_dinas') return 2;
  if (role === 'kepala_bidang') return 3;
  if (role === 'ketua_tim') return 4;
  if (role === 'pegawai') return 5;
  return 6; // Other roles
};

/**
 * Helper function: Validate workflow transition based on roles
 */
const validateWorkflowTransition = (fromRole, toRole) => {
  const fromLevel = getRoleLevel(fromRole);
  const toLevel = getRoleLevel(toRole);

  // Simple rule: can only send to same level or lower
  if (toLevel < fromLevel) {
    return { valid: false, message: 'Tidak dapat mendisposisi ke level yang lebih tinggi' };
  }

  return { valid: true };
};

/**
 * @route POST /api/disposisi
 * @desc Create disposisi (disposisi ke level berikutnya)
 */
exports.createDisposisi = async (req, res, next) => {
  try {
    console.log('\n═══════════════════════════════════════');
    console.log('📝 [DISPOSISI] CREATE REQUEST RECEIVED');
    console.log('═══════════════════════════════════════');
    
    const {
      surat_id,
      ke_user_id,
      catatan,
      instruksi,
      level_disposisi,
    } = req.body;

    const dari_user_id = req.user.id;
    const dari_user_role = req.user.role;
    
    console.log('📋 Request Data:', {
      surat_id,
      dari_user_id: dari_user_id.toString(),
      dari_user_role,
      ke_user_id: ke_user_id.toString(),
      instruksi,
      level_disposisi
    });

    // Validate ke_user exists
    const keUser = await prisma.users.findUnique({
      where: { id: BigInt(ke_user_id) }
    });

    if (!keUser) {
      return res.status(404).json({
        success: false,
        message: 'User tujuan tidak ditemukan',
      });
    }

    console.log('📊 [WORKFLOW VALIDATION]', {
      from: { id: dari_user_id.toString(), role: dari_user_role },
      to: { id: ke_user_id.toString(), role: keUser.role }
    });

    // Validate workflow hierarchy (simple role-based)
    const workflowValidation = validateWorkflowTransition(dari_user_role, keUser.role);
    if (!workflowValidation.valid) {
      return res.status(400).json({
        success: false,
        message: workflowValidation.message,
      });
    }

    // Create disposisi
    const disposisi = await prisma.disposisi.create({
      data: {
        surat_id: BigInt(surat_id),
        dari_user_id: BigInt(dari_user_id),
        ke_user_id: BigInt(ke_user_id),
        catatan,
        instruksi: instruksi || 'laksanakan',
        status: 'pending',
        level_disposisi: parseInt(level_disposisi),
      },
      include: {
        surat_masuk: {
          select: {
            id: true,
            nomor_surat: true,
            perihal: true,
            pengirim: true,
            tanggal_surat: true,
          },
        },
        users_disposisi_dari_user_idTousers: {
          select: { 
            id: true, 
            name: true, 
            email: true, 
            role: true
          },
        },
        users_disposisi_ke_user_idTousers: {
          select: { 
            id: true, 
            name: true, 
            email: true, 
            role: true
          },
        },
      },
    });

    // Send push notification to recipient
    console.log('\n📨 [DISPOSISI] Starting push notification process...');
    try {
      console.log('📋 [PUSH] Notification data preparation:', {
        disposisi_id: disposisi.id.toString(),
        ke_user_id: ke_user_id.toString(),
        dari_user: disposisi.users_disposisi_dari_user_idTousers?.name,
        perihal: disposisi.surat_masuk?.perihal
      });

      const notificationData = {
        id: disposisi.id,
        perihal: disposisi.surat_masuk?.perihal || 'Disposisi baru',
        nomor_surat: disposisi.surat_masuk?.nomor_surat,
        dari_user: disposisi.users_disposisi_dari_user_idTousers?.name,
        instruksi: disposisi.instruksi,
        catatan: disposisi.catatan
      };
      
      console.log('📤 [PUSH] Calling PushNotificationService.notifyNewDisposisi...');
      console.log('📤 [PUSH] Target user IDs:', [Number(ke_user_id)]);

      const result = await PushNotificationService.notifyNewDisposisi(
        notificationData,
        [Number(ke_user_id)]
      );
      
      console.log('✅ [PUSH] Notification sent! Result:', JSON.stringify(result, null, 2));
      console.log('═══════════════════════════════════════\n');
    } catch (notifError) {
      console.error('\n❌ [PUSH] ERROR sending push notification!');
      console.error('Error message:', notifError.message);
      console.error('Error stack:', notifError.stack);
      console.error('═══════════════════════════════════════\n');
      // Don't fail the request if notification fails
    }

    // Log activity
    await ActivityLogger.log({
      userId: req.user.id,
      userName: req.user.nama || req.user.name || req.user.email,
      userRole: req.user.role,
      bidangId: 2, // Sekretariat
      module: 'disposisi',
      action: 'create',
      entityType: 'disposisi',
      entityId: Number(disposisi.id),
      entityName: disposisi.surat_masuk?.perihal || `Disposisi #${disposisi.id}`,
      description: `${req.user.nama || req.user.name || req.user.email} membuat disposisi ke ${keUser.name}: ${disposisi.surat_masuk?.perihal || 'Surat'}`,
      newValue: { instruksi, catatan, ke_user: keUser.name },
      ipAddress: ActivityLogger.getIpFromRequest(req),
      userAgent: ActivityLogger.getUserAgentFromRequest(req)
    });

    res.status(201).json({
      success: true,
      message: 'Disposisi berhasil dibuat',
      data: disposisi,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @route GET /api/disposisi/masuk
 * @desc Get disposisi yang diterima user (inbox)
 */
exports.getDisposisiMasuk = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { status, page = 1, limit = 20 } = req.query;

    console.log('[getDisposisiMasuk] Query params:', {
      userId: userId?.toString(),
      userRole: req.user.role,
      status,
      page,
      limit,
    });

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const take = parseInt(limit);

    const where = {
      ke_user_id: BigInt(userId),
    };

    if (status) where.status = status;

    console.log('[getDisposisiMasuk] Where clause:', {
      ke_user_id: where.ke_user_id?.toString(),
      status: where.status,
    });

    const [total, disposisi] = await Promise.all([
      prisma.disposisi.count({ where }),
      prisma.disposisi.findMany({
        where,
        include: {
          surat_masuk: {
            select: {
              id: true,
              nomor_surat: true,
              tanggal_surat: true,
              pengirim: true,
              perihal: true,
              jenis_surat: true,
              file_path: true,
            },
          },
          users_disposisi_dari_user_idTousers: {
            select: { 
            id: true, 
            name: true, 
            email: true, 
            role: true
          },
          },
        },
        orderBy: { tanggal_disposisi: 'desc' },
        skip,
        take,
      }),
    ]);

    console.log(`[getDisposisiMasuk] Found ${total} total disposisi, returning ${disposisi.length} items`);

    // Transform response untuk frontend compatibility
    const transformedDisposisi = disposisi.map(d => ({
      ...d,
      surat: d.surat_masuk, // Alias untuk frontend
      dari_user: d.users_disposisi_dari_user_idTousers, // Alias untuk frontend
    }));

    res.json({
      success: true,
      data: transformedDisposisi,
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        totalPages: Math.ceil(total / parseInt(limit)),
      },
    });
  } catch (error) {
    console.error('[getDisposisiMasuk] Error:', error.message);
    console.error('[getDisposisiMasuk] Stack:', error.stack);
    next(error);
  }
};

/**
 * @route GET /api/disposisi/keluar
 * @desc Get disposisi yang dikirim user (outbox)
 */
exports.getDisposisiKeluar = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { status, page = 1, limit = 20 } = req.query;

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const take = parseInt(limit);

    const where = {
      dari_user_id: BigInt(userId),
    };

    if (status) where.status = status;

    const [total, disposisi] = await Promise.all([
      prisma.disposisi.count({ where }),
      prisma.disposisi.findMany({
        where,
        include: {
          surat_masuk: {
            select: {
              id: true,
              nomor_surat: true,
              tanggal_surat: true,
              pengirim: true,
              perihal: true,
              jenis_surat: true,
            },
          },
          users_disposisi_ke_user_idTousers: {
            select: { 
            id: true, 
            name: true, 
            email: true, 
            role: true
          },
          },
        },
        orderBy: { tanggal_disposisi: 'desc' },
        skip,
        take,
      }),
    ]);

    // Transform response untuk frontend compatibility
    const transformedDisposisi = disposisi.map(d => ({
      ...d,
      surat: d.surat_masuk, // Alias untuk frontend
      ke_user: d.users_disposisi_ke_user_idTousers, // Alias untuk frontend
    }));

    res.json({
      success: true,
      data: transformedDisposisi,
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        totalPages: Math.ceil(total / parseInt(limit)),
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @route GET /api/disposisi/:id
 * @desc Get detail disposisi dengan history lengkap
 */
exports.getDisposisiById = async (req, res, next) => {
  try {
    const { id } = req.params;

    const disposisi = await prisma.disposisi.findUnique({
      where: { id: BigInt(id) },
      include: {
        surat_masuk: {
          include: {
            users: {
              select: { id: true, name: true, email: true },
            },
            disposisi: {
              include: {
                users_disposisi_dari_user_idTousers: {
                  select: { 
            id: true, 
            name: true, 
            email: true, 
            role: true
          },
                },
                users_disposisi_ke_user_idTousers: {
                  select: { 
            id: true, 
            name: true, 
            email: true, 
            role: true
          },
                },
              },
              orderBy: { level_disposisi: 'asc' },
            },
          },
        },
        users_disposisi_dari_user_idTousers: {
          select: { 
            id: true, 
            name: true, 
            email: true, 
            role: true
          },
        },
        users_disposisi_ke_user_idTousers: {
          select: { 
            id: true, 
            name: true, 
            email: true, 
            role: true
          },
        },
      },
    });

    if (!disposisi) {
      return res.status(404).json({
        success: false,
        message: 'Disposisi tidak ditemukan',
      });
    }

    // Transform response untuk frontend compatibility
    const transformedDisposisi = {
      ...disposisi,
      dari_user: disposisi.users_disposisi_dari_user_idTousers,
      ke_user: disposisi.users_disposisi_ke_user_idTousers,
      surat_masuk: disposisi.surat_masuk ? {
        ...disposisi.surat_masuk,
        disposisi: disposisi.surat_masuk.disposisi?.map(d => ({
          ...d,
          dari_user: d.users_disposisi_dari_user_idTousers,
          ke_user: d.users_disposisi_ke_user_idTousers
        }))
      } : null
    };

    res.json({
      success: true,
      data: transformedDisposisi,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @route PUT /api/disposisi/:id/baca
 * @desc Mark disposisi as read
 */
exports.markAsRead = async (req, res, next) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const disposisi = await prisma.disposisi.findUnique({
      where: { id: BigInt(id) },
    });

    if (!disposisi) {
      return res.status(404).json({
        success: false,
        message: 'Disposisi tidak ditemukan',
      });
    }

    if (disposisi.ke_user_id !== BigInt(userId)) {
      return res.status(403).json({
        success: false,
        message: 'Anda tidak memiliki akses ke disposisi ini',
      });
    }

    const updated = await prisma.disposisi.update({
      where: { id: BigInt(id) },
      data: {
        status: 'dibaca',
        tanggal_dibaca: new Date(),
      },
    });

    // Log activity
    await ActivityLogger.log({
      userId: req.user.id,
      userName: req.user.nama || req.user.name || req.user.email,
      userRole: req.user.role,
      bidangId: 2, // Sekretariat
      module: 'disposisi',
      action: 'read',
      entityType: 'disposisi',
      entityId: Number(updated.id),
      entityName: `Disposisi #${updated.id}`,
      description: `${req.user.nama || req.user.name || req.user.email} membaca disposisi #${updated.id}`,
      oldValue: { status: disposisi.status },
      newValue: { status: 'dibaca' },
      ipAddress: ActivityLogger.getIpFromRequest(req),
      userAgent: ActivityLogger.getUserAgentFromRequest(req)
    });

    res.json({
      success: true,
      message: 'Disposisi ditandai sudah dibaca',
      data: updated,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @route PUT /api/disposisi/:id/status
 * @desc Update status disposisi (proses, selesai, teruskan)
 */
exports.updateStatus = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { status } = req.body;
    const userId = req.user.id;

    const disposisi = await prisma.disposisi.findUnique({
      where: { id: BigInt(id) },
    });

    if (!disposisi) {
      return res.status(404).json({
        success: false,
        message: 'Disposisi tidak ditemukan',
      });
    }

    if (disposisi.ke_user_id !== BigInt(userId)) {
      return res.status(403).json({
        success: false,
        message: 'Anda tidak memiliki akses ke disposisi ini',
      });
    }

    const updateData = { status };

    if (status === 'selesai') {
      updateData.tanggal_selesai = new Date();
    }

    const updated = await prisma.disposisi.update({
      where: { id: BigInt(id) },
      data: updateData,
    });

    // Log activity
    await ActivityLogger.log({
      userId: req.user.id,
      userName: req.user.nama || req.user.name || req.user.email,
      userRole: req.user.role,
      bidangId: 2, // Sekretariat
      module: 'disposisi',
      action: status === 'selesai' ? 'complete' : 'update',
      entityType: 'disposisi',
      entityId: Number(updated.id),
      entityName: `Disposisi #${updated.id}`,
      description: `${req.user.nama || req.user.name || req.user.email} ${status === 'selesai' ? 'menyelesaikan' : 'mengubah status'} disposisi #${updated.id} menjadi ${status}`,
      oldValue: { status: disposisi.status },
      newValue: { status },
      ipAddress: ActivityLogger.getIpFromRequest(req),
      userAgent: ActivityLogger.getUserAgentFromRequest(req)
    });

    res.json({
      success: true,
      message: 'Status disposisi berhasil diupdate',
      data: updated,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @route GET /api/disposisi/history/:surat_id
 * @desc Get complete disposisi history untuk tracking
 */
exports.getDisposisiHistory = async (req, res, next) => {
  try {
    const { surat_id } = req.params;

    const disposisi = await prisma.disposisi.findMany({
      where: { surat_id: BigInt(surat_id) },
      include: {
        users_disposisi_dari_user_idTousers: {
          select: { 
            id: true, 
            name: true, 
            email: true, 
            role: true
          },
        },
        users_disposisi_ke_user_idTousers: {
          select: { 
            id: true, 
            name: true, 
            email: true, 
            role: true
          },
        },
      },
      orderBy: { level_disposisi: 'asc' },
    });

    res.json({
      success: true,
      data: disposisi,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @route GET /api/disposisi/statistik
 * @desc Get statistik disposisi user (untuk dashboard)
 */
exports.getStatistik = async (req, res, next) => {
  try {
    const userId = req.user.id;

    const [pending, dibaca, proses, selesai, totalMasuk, totalKeluar] = await Promise.all([
      prisma.disposisi.count({
        where: { ke_user_id: BigInt(userId), status: 'pending' },
      }),
      prisma.disposisi.count({
        where: { ke_user_id: BigInt(userId), status: 'dibaca' },
      }),
      prisma.disposisi.count({
        where: { ke_user_id: BigInt(userId), status: 'proses' },
      }),
      prisma.disposisi.count({
        where: { ke_user_id: BigInt(userId), status: 'selesai' },
      }),
      prisma.disposisi.count({
        where: { ke_user_id: BigInt(userId) },
      }),
      prisma.disposisi.count({
        where: { dari_user_id: BigInt(userId) },
      }),
    ]);

    res.json({
      success: true,
      data: {
        masuk: {
          pending,
          dibaca,
          proses,
          selesai,
          total: totalMasuk,
        },
        keluar: {
          total: totalKeluar,
        },
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @route GET /api/disposisi/available-users
 * @desc Get users yang boleh menerima disposisi berdasarkan workflow hierarchy
 */
exports.getAvailableUsers = async (req, res, next) => {
  try {
    const currentUser = req.user;
    const currentRole = currentUser.role;

    console.log('[getAvailableUsers] Current user:', {
      id: currentUser.id.toString(),
      role: currentRole,
      bidang_id: currentUser.bidang_id ? currentUser.bidang_id.toString() : null
    });

    let whereClause = {};

    // Role-based filtering (simplified)
    if (currentRole === 'kepala_dinas') {
      // Kepala Dinas → can send to Sekretaris Dinas
      whereClause = {
        role: 'sekretaris_dinas'
      };
    }
    else if (currentRole === 'sekretaris_dinas') {
      // Sekretaris Dinas → can send to Kepala Bidang (all bidang)
      // AND also directly to Ketua Tim in Sekretariat (bidang_id=2) since there's no Kepala Bidang Sekretariat
      whereClause = {
        OR: [
          { role: 'kepala_bidang' },
          { role: 'ketua_tim', bidang_id: 2 }
        ]
      };
    }
    else if (currentRole === 'kepala_bidang') {
      // Kepala Bidang → can ONLY send to Ketua Tim in same bidang
      if (!currentUser.bidang_id) {
        return res.status(400).json({
          success: false,
          message: 'Kepala Bidang harus terdaftar dalam bidang tertentu'
        });
      }

      whereClause = {
        bidang_id: currentUser.bidang_id,
        role: 'ketua_tim'  // Only Ketua Tim, NOT pegawai directly
      };
    }
    else if (currentRole === 'ketua_tim') {
      // Ketua Tim → can send to Pegawai in same bidang
      if (!currentUser.bidang_id) {
        return res.status(400).json({
          success: false,
          message: 'Ketua Tim harus terdaftar dalam bidang tertentu'
        });
      }

      whereClause = {
        bidang_id: currentUser.bidang_id,
        role: 'pegawai'
      };
    }
    else {
      // Pegawai or others cannot create disposisi
      return res.status(403).json({
        success: false,
        message: 'Anda tidak memiliki akses untuk membuat disposisi'
      });
    }

    // Exclude self
    whereClause.id = {
      not: currentUser.id
    };

    const users = await prisma.users.findMany({
      where: whereClause,
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        bidang_id: true,
        pegawai: {
          select: {
            id_pegawai: true,
            nama_pegawai: true,
            bidangs: {
              select: {
                id: true,
                nama: true
              }
            }
          }
        }
      },
    });

    console.log(`[getAvailableUsers] Found ${users.length} available users`);

    res.json({
      success: true,
      data: users,
    });
  } catch (error) {
    console.error('[getAvailableUsers] Error:', error);
    next(error);
  }
};

/**
 * @route POST /api/disposisi/surat-masuk
 * @desc Input surat masuk oleh pegawai sekretariat
 * @access Pegawai Sekretariat (bidang_id = 2)
 */
exports.createSuratMasuk = async (req, res, next) => {
  try {
    console.log('\n═══════════════════════════════════════');
    console.log('📨 [SURAT MASUK] CREATE REQUEST');
    console.log('═══════════════════════════════════════');

    const { asal_surat, nomor_surat, perihal_surat, tanggal_diterima, ringkasan_isi } = req.body;
    const user_id = req.user.id;
    const user_role = req.user.role;
    const bidang_id = req.user.bidang_id;

    console.log('📋 User Info:', {
      user_id: user_id.toString(),
      user_role,
      bidang_id: bidang_id ? bidang_id.toString() : null,
    });

    // Validate: Only sekretariat staff (bidang_id = 2) or superadmin can input
    const isSuperadmin = user_role === 'superadmin';
    const isSekretariat = bidang_id && BigInt(bidang_id) === BigInt(2);
    if (!isSuperadmin && !isSekretariat) {
      return res.status(403).json({
        success: false,
        message: 'Hanya pegawai sekretariat yang dapat menginput surat masuk',
      });
    }

    // Handle file upload
    let file_path = null;
    if (req.file) {
      file_path = req.file.path.replace(/\\/g, '/');
      console.log('📎 File uploaded:', file_path);
    } else {
      console.warn('⚠️  No file uploaded');
    }

    // Validate required fields
    if (!nomor_surat || !asal_surat || !perihal_surat || !tanggal_diterima || !ringkasan_isi) {
      return res.status(400).json({
        success: false,
        message: 'Semua field wajib diisi',
      });
    }

    // Create surat masuk record
    console.log('📝 Creating surat masuk with data:', {
      nomor_surat,
      pengirim: asal_surat,
      perihal: perihal_surat,
      tanggal_surat: new Date(tanggal_diterima),
      file_path,
    });

    const suratMasuk = await prisma.surat_masuk.create({
      data: {
        nomor_surat,
        pengirim: asal_surat,
        perihal: perihal_surat,
        tanggal_surat: new Date(tanggal_diterima),
        tanggal_terima: new Date(),
        keterangan: ringkasan_isi,
        file_path,
        status: 'dikirim',
        created_by: BigInt(user_id),
      },
    });

    console.log('✅ [SURAT MASUK] Created:', suratMasuk.id.toString());

    // Log activity for surat masuk creation
    await ActivityLogger.log({
      userId: req.user.id,
      userName: req.user.nama || req.user.name || req.user.email,
      userRole: req.user.role,
      bidangId: 2, // Sekretariat
      module: 'surat_masuk',
      action: 'create',
      entityType: 'surat_masuk',
      entityId: Number(suratMasuk.id),
      entityName: perihal_surat,
      description: `${req.user.nama || req.user.name || req.user.email} menginput surat masuk: ${perihal_surat} (No: ${nomor_surat})`,
      newValue: { nomor_surat, pengirim: asal_surat, perihal: perihal_surat },
      ipAddress: ActivityLogger.getIpFromRequest(req),
      userAgent: ActivityLogger.getUserAgentFromRequest(req)
    });

    // Auto-create disposisi to Kepala Dinas
    // Find user with role 'kepala_dinas'
    const kepalaDinas = await prisma.users.findFirst({
      where: { role: 'kepala_dinas' }
    });

    console.log('🔍 [KEPALA DINAS] Found:', kepalaDinas ? {
      id: kepalaDinas.id.toString(),
      name: kepalaDinas.name,
      role: kepalaDinas.role
    } : 'NOT FOUND - Please create a user with role kepala_dinas');

    if (kepalaDinas) {
      const disposisi = await prisma.disposisi.create({
        data: {
          surat_id: suratMasuk.id,
          dari_user_id: BigInt(user_id),
          ke_user_id: kepalaDinas.id,
          catatan: `Surat masuk dari ${asal_surat}`,
          instruksi: 'tindaklanjuti',
          status: 'pending',
          level_disposisi: 1,
        },
      });

      console.log('✅ [DISPOSISI] Auto-created to Kepala Dinas:', disposisi.id.toString());

      // Send push notification
      try {
        await PushNotificationService.sendNotificationToUser(kepalaDinas.id, {
          title: '📨 Surat Masuk Baru',
          body: `${perihal_surat} dari ${asal_surat}`,
          data: {
            type: 'new_disposisi',
            disposisi_id: disposisi.id.toString(),
            surat_id: suratMasuk.id.toString(),
            url: '/kepala-dinas/disposisi',
          },
        });
        console.log('✅ [PUSH] Notification sent to Kepala Dinas');
      } catch (pushError) {
        console.error('❌ [PUSH] Error:', pushError);
      }
    }

    res.json({
      success: true,
      message: 'Surat masuk berhasil diinput dan dikirim ke Kepala Dinas',
      data: suratMasuk,
    });
  } catch (error) {
    console.error('❌ [SURAT MASUK] Error:', error);
    
    // Handle duplicate nomor surat
    if (error.code === 'P2002' && error.meta?.target?.includes('nomor_surat')) {
      return res.status(400).json({
        success: false,
        message: 'Nomor surat sudah terdaftar. Gunakan nomor surat yang berbeda.',
      });
    }
    
    next(error);
  }
};

/**
 * @route PUT /api/disposisi/:id/tarik
 * @desc Tarik kembali (recall) disposisi yang sudah dikirim
 * @access Pengirim disposisi, hanya jika status masih 'pending'
 */
exports.tarikDisposisi = async (req, res, next) => {
  try {
    const disposisiId = BigInt(req.params.id);
    const userId = BigInt(req.user.id);

    const disposisi = await prisma.disposisi.findUnique({
      where: { id: disposisiId },
      include: {
        surat_masuk: true,
        users_disposisi_ke_user_idTousers: {
          select: { id: true, nama_lengkap: true, role: true }
        }
      }
    });

    if (!disposisi) {
      return res.status(404).json({ success: false, message: 'Disposisi tidak ditemukan' });
    }

    if (disposisi.dari_user_id !== userId) {
      return res.status(403).json({ success: false, message: 'Hanya pengirim yang dapat menarik disposisi' });
    }

    if (disposisi.status !== 'pending') {
      return res.status(400).json({
        success: false,
        message: 'Disposisi sudah dibaca/diproses dan tidak dapat ditarik kembali'
      });
    }

    const updated = await prisma.disposisi.update({
      where: { id: disposisiId },
      data: { status: 'ditarik' },
      include: {
        surat_masuk: true,
        users_disposisi_ke_user_idTousers: {
          select: { id: true, nama_lengkap: true, role: true }
        }
      }
    });

    console.log(`🔄 [DISPOSISI] Ditarik: ID ${disposisiId} oleh user ${userId}`);

    res.json({
      success: true,
      message: 'Disposisi berhasil ditarik kembali',
      data: {
        id: updated.id,
        surat: updated.surat_masuk,
        ke_user: updated.users_disposisi_ke_user_idTousers,
        status: updated.status
      }
    });
  } catch (error) {
    console.error('❌ [DISPOSISI] Error tarik:', error);
    next(error);
  }
};

/**
 * @route PUT /api/disposisi/:id/edit
 * @desc Edit disposisi yang sudah ditarik
 * @access Pengirim disposisi, hanya jika status 'ditarik'
 */
exports.editDisposisi = async (req, res, next) => {
  try {
    const disposisiId = BigInt(req.params.id);
    const userId = BigInt(req.user.id);
    const { ke_user_id, catatan, instruksi } = req.body;

    const disposisi = await prisma.disposisi.findUnique({
      where: { id: disposisiId }
    });

    if (!disposisi) {
      return res.status(404).json({ success: false, message: 'Disposisi tidak ditemukan' });
    }

    if (disposisi.dari_user_id !== userId) {
      return res.status(403).json({ success: false, message: 'Hanya pengirim yang dapat mengedit disposisi' });
    }

    if (disposisi.status !== 'ditarik') {
      return res.status(400).json({
        success: false,
        message: 'Hanya disposisi yang sudah ditarik yang dapat diedit'
      });
    }

    const updateData = { status: 'pending' };
    if (ke_user_id) updateData.ke_user_id = BigInt(ke_user_id);
    if (catatan !== undefined) updateData.catatan = catatan;
    if (instruksi) updateData.instruksi = instruksi;

    const updated = await prisma.disposisi.update({
      where: { id: disposisiId },
      data: updateData,
      include: {
        surat_masuk: true,
        users_disposisi_ke_user_idTousers: {
          select: { id: true, nama_lengkap: true, role: true }
        }
      }
    });

    // Send notification to new recipient
    try {
      const targetId = updated.ke_user_id;
      await PushNotificationService.sendNotification(targetId, {
        title: '📩 Disposisi Surat',
        body: `Anda menerima disposisi surat: ${updated.surat_masuk?.perihal || 'Surat masuk'}`,
        data: {
          type: 'disposisi',
          disposisi_id: updated.id.toString(),
          surat_id: updated.surat_id.toString()
        }
      });
    } catch (pushErr) {
      console.log('Push notification gagal (non-critical):', pushErr.message);
    }

    console.log(`✏️ [DISPOSISI] Edited & resent: ID ${disposisiId}`);

    res.json({
      success: true,
      message: 'Disposisi berhasil diedit dan dikirim ulang',
      data: {
        id: updated.id,
        surat: updated.surat_masuk,
        ke_user: updated.users_disposisi_ke_user_idTousers,
        catatan: updated.catatan,
        instruksi: updated.instruksi,
        status: updated.status
      }
    });
  } catch (error) {
    console.error('❌ [DISPOSISI] Error edit:', error);
    next(error);
  }
};

/**
 * @route DELETE /api/disposisi/:id
 * @desc Hapus disposisi yang sudah ditarik
 * @access Pengirim disposisi, hanya jika status 'ditarik'
 */
exports.deleteDisposisi = async (req, res, next) => {
  try {
    const disposisiId = BigInt(req.params.id);
    const userId = BigInt(req.user.id);

    const disposisi = await prisma.disposisi.findUnique({
      where: { id: disposisiId }
    });

    if (!disposisi) {
      return res.status(404).json({ success: false, message: 'Disposisi tidak ditemukan' });
    }

    if (disposisi.dari_user_id !== userId) {
      return res.status(403).json({ success: false, message: 'Hanya pengirim yang dapat menghapus disposisi' });
    }

    if (disposisi.status !== 'ditarik') {
      return res.status(400).json({
        success: false,
        message: 'Hanya disposisi yang sudah ditarik yang dapat dihapus'
      });
    }

    await prisma.disposisi.delete({
      where: { id: disposisiId }
    });

    console.log(`🗑️ [DISPOSISI] Deleted: ID ${disposisiId} oleh user ${userId}`);

    res.json({
      success: true,
      message: 'Disposisi berhasil dihapus'
    });
  } catch (error) {
    console.error('❌ [DISPOSISI] Error delete:', error);
    next(error);
  }
};

/**
 * @route GET /api/disposisi/riwayat-sekretariat
 * @desc Riwayat disposisi yang dikirim oleh user sekretariat (bidang_id=2)
 * @access Sekretariat staff only
 */
exports.getRiwayatSekretariat = async (req, res, next) => {
  try {
    const userId = BigInt(req.user.id);
    const { status, page = 1, limit = 20 } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const whereClause = { dari_user_id: userId };
    if (status) whereClause.status = status;

    const [data, total] = await Promise.all([
      prisma.disposisi.findMany({
        where: whereClause,
        include: {
          surat_masuk: true,
          users_disposisi_ke_user_idTousers: {
            select: { id: true, nama_lengkap: true, role: true }
          },
          users_disposisi_dari_user_idTousers: {
            select: { id: true, nama_lengkap: true, role: true }
          }
        },
        orderBy: { tanggal_disposisi: 'desc' },
        skip,
        take: parseInt(limit)
      }),
      prisma.disposisi.count({ where: whereClause })
    ]);

    const formatted = data.map(d => ({
      id: d.id,
      surat: d.surat_masuk,
      dari_user: d.users_disposisi_dari_user_idTousers,
      ke_user: d.users_disposisi_ke_user_idTousers,
      catatan: d.catatan,
      instruksi: d.instruksi,
      status: d.status,
      level_disposisi: d.level_disposisi,
      tanggal_disposisi: d.tanggal_disposisi,
      tanggal_dibaca: d.tanggal_dibaca,
      tanggal_selesai: d.tanggal_selesai,
      can_recall: d.status === 'pending'
    }));

    res.json({
      success: true,
      data: formatted,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        totalPages: Math.ceil(total / parseInt(limit))
      }
    });
  } catch (error) {
    console.error('❌ [DISPOSISI] Error riwayat sekretariat:', error);
    next(error);
  }
};
