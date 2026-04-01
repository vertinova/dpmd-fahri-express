/**
 * Base Kelembagaan Controller
 * Shared utilities and helpers for all kelembagaan controllers
 */

const prisma = require('../../config/prisma');
const { v4: uuidv4 } = require('uuid');
const ActivityLogger = require('../../utils/activityLogger');

// Activity Log Types
const ACTIVITY_TYPES = {
  CREATE: 'create',
  UPDATE: 'update',
  TOGGLE_STATUS: 'toggle_status',
  VERIFY: 'verify',
  ADD_PENGURUS: 'add_pengurus',
  UPDATE_PENGURUS: 'update_pengurus',
  TOGGLE_PENGURUS_STATUS: 'toggle_pengurus_status',
  VERIFY_PENGURUS: 'verify_pengurus',
  RESUBMIT: 'resubmit',
  RESUBMIT_PENGURUS: 'resubmit_pengurus'
};

const ENTITY_TYPES = {
  LEMBAGA: 'lembaga',
  PENGURUS: 'pengurus'
};

/**
 * Log kelembagaan activity (DUAL LOGGING)
 * Menulis ke 2 tabel:
 * 1. kelembagaan_activity_logs - untuk tracking spesifik kelembagaan
 * 2. activity_logs - untuk tracking global aplikasi
 */
async function logKelembagaanActivity({
  kelembagaanType,
  kelembagaanId,
  kelembagaanNama,
  desaId,
  activityType,
  entityType,
  entityId,
  entityName,
  oldValue,
  newValue,
  userId,
  userName,
  userRole,
  bidangId = null,
  ipAddress = null,
  userAgent = null
}) {
  try {
    // Build action description
    let actionDescription = '';
    
    switch (activityType) {
      case ACTIVITY_TYPES.CREATE:
        actionDescription = `${userName} membuat ${entityType === ENTITY_TYPES.LEMBAGA ? 'kelembagaan' : 'pengurus'} ${entityName}`;
        break;
      case ACTIVITY_TYPES.UPDATE:
        actionDescription = `${userName} mengubah data ${entityType === ENTITY_TYPES.LEMBAGA ? 'kelembagaan' : 'pengurus'} ${entityName}`;
        break;
      case ACTIVITY_TYPES.TOGGLE_STATUS:
        actionDescription = `${userName} mengubah status ${entityType === ENTITY_TYPES.LEMBAGA ? 'kelembagaan' : 'pengurus'} ${entityName} menjadi ${newValue?.status_kelembagaan || newValue?.status_pengurus || 'aktif'}`;
        break;
      case ACTIVITY_TYPES.VERIFY: {
        const verificationAction = newValue?.status_verifikasi === 'verified'
          ? 'memverifikasi'
          : newValue?.status_verifikasi === 'ditolak'
            ? 'menolak verifikasi'
            : 'membatalkan verifikasi';
        actionDescription = `${userName} ${verificationAction} ${entityType === ENTITY_TYPES.LEMBAGA ? 'kelembagaan' : 'pengurus'} ${entityName}`;
        break;
      }
      case ACTIVITY_TYPES.ADD_PENGURUS:
        actionDescription = `${userName} menambahkan pengurus ${entityName}`;
        break;
      case ACTIVITY_TYPES.UPDATE_PENGURUS:
        actionDescription = `${userName} mengubah data pengurus ${entityName}`;
        break;
      case ACTIVITY_TYPES.TOGGLE_PENGURUS_STATUS:
        actionDescription = `${userName} mengubah status pengurus ${entityName} menjadi ${newValue?.status_pengurus || 'aktif'}`;
        break;
      case ACTIVITY_TYPES.VERIFY_PENGURUS: {
        const verificationAction = newValue?.status_verifikasi === 'verified'
          ? 'memverifikasi'
          : newValue?.status_verifikasi === 'ditolak'
            ? 'menolak verifikasi'
            : 'membatalkan verifikasi';
        actionDescription = `${userName} ${verificationAction} pengurus ${entityName}`;
        break;
      }
      default:
        actionDescription = `${userName} melakukan aktivitas pada ${entityName}`;
    }

    // 1. LOG KE KELEMBAGAAN_ACTIVITY_LOGS (spesifik kelembagaan)
    await prisma.kelembagaan_activity_logs.create({
      data: {
        id: uuidv4(), // Generate UUID for primary key
        kelembagaan_type: kelembagaanType,
        kelembagaan_id: kelembagaanId,
        kelembagaan_nama: kelembagaanNama,
        desa_id: desaId,
        activity_type: activityType,
        action_description: actionDescription,
        entity_type: entityType,
        entity_id: entityId,
        entity_name: entityName,
        old_value: oldValue ? JSON.stringify(oldValue) : null,
        new_value: newValue ? JSON.stringify(newValue) : null,
        user_id: userId,
        user_name: userName,
        user_role: userRole,
        created_at: new Date()
      }
    });

    // 2. LOG KE ACTIVITY_LOGS (global tracking)
    // Note: entityId untuk kelembagaan adalah UUID (string), tidak bisa dikonversi ke BigInt
    // Jadi kita set null untuk activity_logs dan pakai entityName untuk referensi
    // IMPORTANT: Kelembagaan adalah tanggung jawab Bidang PMD (bidang_id: 5)
    // Jika user tidak punya bidang_id (superadmin/desa), set ke 5 agar muncul di activity log PMD
    const effectiveBidangId = bidangId || 5;
    
    await ActivityLogger.log({
      userId: userId,
      userName: userName,
      userRole: userRole,
      bidangId: effectiveBidangId,
      module: 'kelembagaan',
      action: activityType, // create, update, toggle_status, verify, dll
      entityType: `${kelembagaanType}_${entityType}`, // rw_lembaga, rt_pengurus, dll
      entityId: null, // UUID tidak bisa jadi BigInt, gunakan entityName sebagai referensi
      entityName: `${kelembagaanNama} - ${entityName}`,
      description: `[${kelembagaanType.toUpperCase()}] ${actionDescription}`,
      oldValue: oldValue,
      newValue: newValue,
      ipAddress: ipAddress,
      userAgent: userAgent
    });

    console.log(`✅ Dual logging completed: ${kelembagaanType} - ${actionDescription}`);
  } catch (error) {
    console.error('Error logging kelembagaan activity:', error);
    // Don't throw - logging should not break the main operation
  }
}

/**
 * Get desa_id from request (supports both desa users and admin)
 * Priority: req.desaId > query.desa_id > user.desa_id
 */
function getDesaId(req) {
  return req.desaId || req.query?.desa_id || req.user?.desa_id;
}

/**
 * Validate desa access
 * Superadmin and admin can access any desa via desa_id parameter
 */
function validateDesaAccess(req, res) {
  const user = req.user;
  
  // Admin roles that can access any desa via desa_id parameter
  const adminRoles = ['superadmin', 'pemberdayaan_masyarakat', 'pegawai', 'kepala_bidang', 'ketua_tim', 'kepala_dinas', 'sekretaris_dinas'];
  
  if (adminRoles.includes(user.role)) {
    const desaId = req.query?.desa_id || req.body?.desa_id || req.desaId || req.user?.desa_id;
    if (!desaId) {
      res.status(403).json({ success: false, message: 'desa_id parameter diperlukan untuk admin' });
      return null;
    }
    return desaId;
  }
  
  // For desa users, must have desa_id
  const desaId = getDesaId(req);
  if (!desaId) {
    res.status(403).json({ success: false, message: 'User tidak memiliki akses desa' });
    return null;
  }
  return desaId;
}

/**
 * Convert string to uppercase, return null if falsy
 */
function toUpper(val) {
  return val ? String(val).toUpperCase() : val;
}

/**
 * Shared handler for "Ajukan Ulang Verifikasi" (desa resubmit after ditolak)
 * Resets status_verifikasi from 'ditolak' to 'unverified'
 * @param {string} tableName - Prisma table name (e.g. 'rws', 'rts', 'posyandus')
 * @param {string} kelembagaanType - Type string for logging (e.g. 'rw', 'rt', 'posyandu')
 * @param {string} entityLabel - Display label (e.g. 'RW', 'RT', 'Posyandu')
 * @param {Function} getEntityName - Function(item) to get display name for logging
 */
function createAjukanUlangHandler(tableName, kelembagaanType, entityLabel, getEntityName) {
  return async (req, res) => {
    try {
      const user = req.user;

      const item = await prisma[tableName].findUnique({
        where: { id: String(req.params.id) }
      });

      if (!item) {
        return res.status(404).json({ success: false, message: `${entityLabel} tidak ditemukan` });
      }

      // Validate desa ownership
      if (user.role === 'desa' && Number(user.desa_id) !== Number(item.desa_id)) {
        return res.status(403).json({ success: false, message: 'User tidak memiliki akses' });
      }

      // Only allow resubmit from ditolak status
      if (item.status_verifikasi !== 'ditolak') {
        return res.status(400).json({
          success: false,
          message: `Hanya ${entityLabel} dengan status "ditolak" yang dapat diajukan ulang`
        });
      }

      const updated = await prisma[tableName].update({
        where: { id: String(req.params.id) },
        data: {
          status_verifikasi: 'unverified',
          catatan_verifikasi: null,
          verifikator_nama: null,
          verified_at: null,
        }
      });

      await logKelembagaanActivity({
        kelembagaanType,
        kelembagaanId: updated.id,
        kelembagaanNama: getEntityName(updated),
        desaId: updated.desa_id,
        activityType: ACTIVITY_TYPES.RESUBMIT,
        entityType: ENTITY_TYPES.LEMBAGA,
        entityId: updated.id,
        entityName: getEntityName(updated),
        oldValue: { status_verifikasi: item.status_verifikasi },
        newValue: { status_verifikasi: 'unverified' },
        userId: user.id,
        userName: user.name,
        userRole: user.role,
        bidangId: user.bidang_id,
        ipAddress: req.ip,
        userAgent: req.get('user-agent')
      });

      res.json({ success: true, data: updated, message: `Berhasil mengajukan ulang verifikasi ${entityLabel}` });
    } catch (error) {
      console.error(`Error in ajukanUlangVerifikasi ${entityLabel}:`, error);
      res.status(500).json({ success: false, message: 'Gagal mengajukan ulang verifikasi', error: error.message });
    }
  };
}

module.exports = {
  prisma,
  ACTIVITY_TYPES,
  ENTITY_TYPES,
  logKelembagaanActivity,
  getDesaId,
  validateDesaAccess,
  toUpper,
  createAjukanUlangHandler
};
