const { v4: uuidv4 } = require('uuid');
const prisma = require('../config/prisma');

/**
 * KELEMBAGAAN ACTIVITY LOGGER
 * 
 * Sistem pencatatan aktivitas untuk semua jenis kelembagaan:
 * - RW, RT, Posyandu, Karang Taruna, LPM, PKK, Satlinmas
 * 
 * Activity Types:
 * - create: Pembuatan lembaga baru
 * - update: Perubahan data lembaga
 * - toggle_status: Aktif/Nonaktif lembaga
 * - verify: Verifikasi admin
 * - add_pengurus: Penambahan pengurus
 * - update_pengurus: Perubahan data pengurus
 * - toggle_pengurus_status: Aktif/Nonaktif pengurus
 * - verify_pengurus: Verifikasi pengurus
 */

// Mapping nama kelembagaan
const KELEMBAGAAN_NAMES = {
  rw: 'RW',
  rt: 'RT',
  posyandu: 'Posyandu',
  karang_taruna: 'Karang Taruna',
  lpm: 'LPM',
  pkk: 'PKK',
  satlinmas: 'Satlinmas'
};

// Mapping entity types
const ENTITY_TYPES = {
  LEMBAGA: 'lembaga',
  PENGURUS: 'pengurus'
};

// Mapping activity types
const ACTIVITY_TYPES = {
  CREATE: 'create',
  UPDATE: 'update',
  TOGGLE_STATUS: 'toggle_status',
  VERIFY: 'verify',
  ADD_PENGURUS: 'add_pengurus',
  UPDATE_PENGURUS: 'update_pengurus',
  TOGGLE_PENGURUS_STATUS: 'toggle_pengurus_status',
  VERIFY_PENGURUS: 'verify_pengurus'
};

/**
 * Generate deskripsi aksi yang user-friendly
 */
function generateActionDescription(activityType, kelembagaanType, entityData, oldValue, newValue) {
  const kelembagaanName = KELEMBAGAAN_NAMES[kelembagaanType] || kelembagaanType.toUpperCase();
  
  switch (activityType) {
    case ACTIVITY_TYPES.CREATE:
      return `Membuat ${kelembagaanName} baru: ${entityData.nama || entityData.nomor || '-'}`;
    
    case ACTIVITY_TYPES.UPDATE:
      const changes = [];
      if (oldValue && newValue) {
        // Identifikasi field yang berubah
        Object.keys(newValue).forEach(key => {
          if (oldValue[key] !== newValue[key] && key !== 'updated_at') {
            changes.push(key);
          }
        });
      }
      return `Mengubah data ${kelembagaanName}: ${changes.length > 0 ? changes.join(', ') : 'beberapa field'}`;
    
    case ACTIVITY_TYPES.TOGGLE_STATUS:
      const status = newValue?.status_kelembagaan || 'unknown';
      return `Mengubah status ${kelembagaanName} menjadi ${status}`;
    
    case ACTIVITY_TYPES.VERIFY:
      return `Memverifikasi ${kelembagaanName}: ${entityData.nama || entityData.nomor || '-'}`;
    
    case ACTIVITY_TYPES.ADD_PENGURUS:
      return `Menambah pengurus baru: ${entityData.nama_lengkap} sebagai ${entityData.jabatan}`;
    
    case ACTIVITY_TYPES.UPDATE_PENGURUS:
      return `Mengubah data pengurus: ${entityData.nama_lengkap}`;
    
    case ACTIVITY_TYPES.TOGGLE_PENGURUS_STATUS:
      const statusPengurus = newValue?.status_jabatan || 'unknown';
      return `Mengubah status pengurus ${entityData.nama_lengkap} menjadi ${statusPengurus}`;
    
    case ACTIVITY_TYPES.VERIFY_PENGURUS:
      return `Memverifikasi pengurus: ${entityData.nama_lengkap}`;
    
    default:
      return `Aktivitas ${activityType} pada ${kelembagaanName}`;
  }
}

/**
 * Log aktivitas kelembagaan
 * 
 * @param {Object} params - Parameter log
 * @param {string} params.kelembagaanType - Tipe kelembagaan (rw, rt, posyandu, dll)
 * @param {string} params.kelembagaanId - UUID kelembagaan
 * @param {string} params.kelembagaanNama - Nama/Nomor kelembagaan untuk display
 * @param {number} params.desaId - ID desa
 * @param {string} params.activityType - Jenis aktivitas (create, update, toggle_status, verify, dll)
 * @param {string} params.entityType - Tipe entitas (lembaga/pengurus)
 * @param {string} params.entityId - UUID entitas (optional, untuk pengurus)
 * @param {string} params.entityName - Nama entitas (optional, untuk pengurus)
 * @param {Object} params.oldValue - Nilai lama (optional)
 * @param {Object} params.newValue - Nilai baru (optional)
 * @param {number} params.userId - ID user yang melakukan aksi
 * @param {string} params.userName - Nama user
 * @param {string} params.userRole - Role user
 */
async function logKelembagaanActivity(params) {
  try {
    const {
      kelembagaanType,
      kelembagaanId,
      kelembagaanNama,
      desaId,
      activityType,
      entityType,
      entityId = null,
      entityName = null,
      oldValue = null,
      newValue = null,
      userId,
      userName,
      userRole
    } = params;

    // Validasi parameter wajib
    if (!kelembagaanType || !kelembagaanId || !desaId || !activityType || !entityType || !userId) {
      console.error('❌ Missing required parameters for activity log:', {
        kelembagaanType, kelembagaanId, desaId, activityType, entityType, userId
      });
      return null;
    }

    console.log('📝 Creating activity log:', {
      kelembagaanType, kelembagaanId, activityType, entityType, desaId
    });

    // Generate action description
    const actionDescription = generateActionDescription(
      activityType,
      kelembagaanType,
      { nama: entityName, nomor: kelembagaanNama, nama_lengkap: entityName, jabatan: newValue?.jabatan },
      oldValue,
      newValue
    );

    // Create activity log
    const activityLog = await prisma.kelembagaan_activity_logs.create({
      data: {
        id: uuidv4(),
        kelembagaan_type: kelembagaanType,
        kelembagaan_id: kelembagaanId,
        kelembagaan_nama: kelembagaanNama,
        desa_id: desaId,
        activity_type: activityType,
        entity_type: entityType,
        entity_id: entityId,
        entity_name: entityName,
        action_description: actionDescription,
        old_value: oldValue ? JSON.parse(JSON.stringify(oldValue)) : null,
        new_value: newValue ? JSON.parse(JSON.stringify(newValue)) : null,
        user_id: userId,
        user_name: userName,
        user_role: userRole
      }
    });

    console.log(`✅ Activity log created: ${activityLog.id} - ${actionDescription}`);
    return activityLog;

  } catch (error) {
    console.error('❌ Error creating activity log:', error);
    console.error('Error details:', error.message);
    // Don't throw error to avoid breaking main operation
    return null;
  }
}

/**
 * Get activity logs untuk kelembagaan tertentu
 * 
 * @param {string} kelembagaanType - Tipe kelembagaan
 * @param {string} kelembagaanId - UUID kelembagaan (optional)
 * @param {number} desaId - ID desa (optional)
 * @param {number} limit - Jumlah maksimal log (default: 50)
 * @param {string} entityType - Filter by entity type (optional: 'lembaga' or 'pengurus')
 */
async function getActivityLogs({
  kelembagaanType,
  kelembagaanId = null,
  desaId = null,
  limit = 50,
  skip = 0,
  entityType = null
}) {
  try {
    const where = {};
    
    if (kelembagaanType) {
      where.kelembagaan_type = kelembagaanType;
    }
    
    if (kelembagaanId) {
      where.kelembagaan_id = kelembagaanId;
    }
    
    if (desaId) {
      where.desa_id = desaId;
    }
    
    if (entityType) {
      where.entity_type = entityType;
    }

    const logs = await prisma.kelembagaan_activity_logs.findMany({
      where,
      orderBy: {
        created_at: 'desc'
      },
      skip: skip,
      take: limit,
      include: {
        users: {
          select: {
            id: true,
            name: true,
            email: true,
            role: true
          }
        },
        desas: {
          select: {
            id: true,
            nama: true,
            kecamatans: {
              select: {
                nama: true
              }
            }
          }
        }
      }
    });

    return logs;

  } catch (error) {
    console.error('❌ Error fetching activity logs:', error);
    throw error;
  }
}

/**
 * Get activity logs untuk list page (hanya aktivitas lembaga)
 * Khusus untuk RT, RW, Posyandu
 */
async function getListPageActivityLogs({ kelembagaanType, desaId, limit = 20 }) {
  return getActivityLogs({
    kelembagaanType,
    desaId,
    limit,
    entityType: ENTITY_TYPES.LEMBAGA // Only show lembaga activities
  });
}

/**
 * Get activity logs untuk detail page (semua aktivitas)
 * Termasuk aktivitas pengurus
 */
async function getDetailPageActivityLogs({ kelembagaanId, limit = 50 }) {
  return getActivityLogs({
    kelembagaanId,
    limit
    // No entityType filter - show all
  });
}

module.exports = {
  logKelembagaanActivity,
  getActivityLogs,
  getListPageActivityLogs,
  getDetailPageActivityLogs,
  ENTITY_TYPES,
  ACTIVITY_TYPES,
  KELEMBAGAAN_NAMES
};
