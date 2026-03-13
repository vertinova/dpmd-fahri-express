const { 
  getListPageActivityLogs, 
  getDetailPageActivityLogs,
  getActivityLogs: fetchActivityLogs 
} = require('../utils/kelembagaanActivityLogger');

/**
 * Get activity logs untuk list page kelembagaan
 * Query params:
 * - type: kelembagaan type (rw, rt, posyandu, dll) - REQUIRED
 * - desa_id: filter by desa - REQUIRED
 * - limit: jumlah log (default: 20)
 * 
 * Endpoint: GET /api/kelembagaan/activity-logs/list
 */
const getListActivityLogs = async (req, res) => {
  try {
    const { type, desa_id, limit } = req.query;

    // Validasi parameter
    if (!type) {
      return res.status(400).json({
        success: false,
        message: 'Parameter "type" wajib diisi'
      });
    }

    if (!desa_id) {
      return res.status(400).json({
        success: false,
        message: 'Parameter "desa_id" wajib diisi'
      });
    }

    // Get logs untuk list page (hanya aktivitas lembaga)
    const logs = await getListPageActivityLogs({
      kelembagaanType: type,
      desaId: parseInt(desa_id),
      limit: limit ? parseInt(limit) : 20
    });

    return res.status(200).json({
      success: true,
      message: 'Activity logs berhasil diambil',
      data: {
        kelembagaan_type: type,
        desa_id: parseInt(desa_id),
        total: logs.length,
        logs: logs.map(log => ({
          id: log.id,
          kelembagaan_nama: log.kelembagaan_nama,
          kelembagaan_type: log.kelembagaan_type,
          activity_type: log.activity_type,
          entity_type: log.entity_type,
          entity_name: log.entity_name,
          action_description: log.action_description,
          user_name: log.user_name,
          user_role: log.user_role,
          created_at: log.created_at,
          old_value: log.old_value,
          new_value: log.new_value
        }))
      }
    });

  } catch (error) {
    console.error('Error getting list activity logs:', error);
    return res.status(500).json({
      success: false,
      message: 'Gagal mengambil activity logs',
      error: error.message
    });
  }
};

/**
 * Get activity logs untuk detail page kelembagaan
 * Query params:
 * - kelembagaan_id: UUID kelembagaan - REQUIRED
 * - limit: jumlah log (default: 50)
 * 
 * Endpoint: GET /api/kelembagaan/activity-logs/detail/:type/:id
 */
const getDetailActivityLogs = async (req, res) => {
  try {
    const { type, id } = req.params;
    const { limit } = req.query;

    // Validasi parameter
    if (!id) {
      return res.status(400).json({
        success: false,
        message: 'Parameter "id" wajib diisi'
      });
    }

    // Get logs untuk detail page (semua aktivitas termasuk pengurus)
    const logs = await getDetailPageActivityLogs({
      kelembagaanId: id,
      limit: limit ? parseInt(limit) : 50
    });

    return res.status(200).json({
      success: true,
      message: 'Activity logs berhasil diambil',
      data: {
        kelembagaan_type: type,
        kelembagaan_id: id,
        total: logs.length,
        logs: logs.map(log => ({
          id: log.id,
          kelembagaan_type: log.kelembagaan_type,
          kelembagaan_nama: log.kelembagaan_nama,
          activity_type: log.activity_type,
          entity_type: log.entity_type,
          entity_id: log.entity_id,
          entity_name: log.entity_name,
          action_description: log.action_description,
          old_value: log.old_value,
          new_value: log.new_value,
          user_name: log.user_name,
          user_role: log.user_role,
          created_at: log.created_at,
          user: log.users ? {
            id: log.users.id,
            name: log.users.name,
            email: log.users.email,
            role: log.users.role
          } : null
        }))
      }
    });

  } catch (error) {
    console.error('Error getting detail activity logs:', error);
    return res.status(500).json({
      success: false,
      message: 'Gagal mengambil activity logs',
      error: error.message
    });
  }
};

/**
 * Get all activity logs dengan filter
 * Query params:
 * - type: kelembagaan type (optional)
 * - kelembagaan_id: UUID kelembagaan (optional)
 * - desa_id: filter by desa (optional)
 * - entity_type: filter by entity (lembaga/pengurus) (optional)
 * - limit: jumlah log (default: 50)
 * - offset: skip records for pagination (default: 0)
 * 
 * Endpoint: GET /api/kelembagaan/activity-logs
 */
const getAllActivityLogs = async (req, res) => {
  try {
    const { type, kelembagaan_id, desa_id, entity_type, limit, offset } = req.query;

    const logs = await fetchActivityLogs({
      kelembagaanType: type || null,
      kelembagaanId: kelembagaan_id || null,
      desaId: desa_id ? parseInt(desa_id) : null,
      entityType: entity_type || null,
      limit: limit ? parseInt(limit) : 50,
      skip: offset ? parseInt(offset) : 0
    });

    return res.status(200).json({
      success: true,
      message: 'Activity logs berhasil diambil',
      data: {
        filters: {
          type,
          kelembagaan_id,
          desa_id: desa_id ? parseInt(desa_id) : null,
          entity_type,
          limit: limit ? parseInt(limit) : 50,
          offset: offset ? parseInt(offset) : 0
        },
        total: logs.length,
        logs
      }
    });

  } catch (error) {
    console.error('Error getting activity logs:', error);
    return res.status(500).json({
      success: false,
      message: 'Gagal mengambil activity logs',
      error: error.message
    });
  }
};

module.exports = {
  getListActivityLogs,
  getDetailActivityLogs,
  getAllActivityLogs
};
