/**
 * Singleton Kelembagaan Controller
 * Generic controller for singleton kelembagaan (KarangTaruna, LPM, PKK, Satlinmas)
 * These kelembagaan types typically have only one instance per desa
 */

const { v4: uuidv4 } = require('uuid');
const {
  prisma,
  ACTIVITY_TYPES,
  ENTITY_TYPES,
  logKelembagaanActivity,
  validateDesaAccess
} = require('./base.controller');

/**
 * Factory function to create singleton kelembagaan controller
 * @param {string} type - kelembagaan type (karang-taruna, lpm, pkk, satlinmas)
 * @param {string} tableName - Prisma table name (karang_tarunas, lpms, pkks, satlinmas)
 * @param {string} displayName - Display name for messages (Karang Taruna, LPM, PKK, Satlinmas)
 */
function createSingletonController(type, tableName, displayName) {
  return {
    /**
     * List for desa user (usually returns 1 item)
     */
    async listDesa(req, res) {
      try {
        const desaId = validateDesaAccess(req, res);
        if (!desaId) return;

        const items = await prisma[tableName].findMany({
          where: { desa_id: desaId },
          include: {
            desas: {
              select: {
                id: true,
                nama: true,
                kecamatans: { select: { id: true, nama: true } }
              }
            }
          }
        });

        res.json({ success: true, data: items });
      } catch (error) {
        console.error(`Error in list${displayName}:`, error);
        res.status(500).json({ success: false, message: `Gagal mengambil data ${displayName}`, error: error.message });
      }
    },

    /**
     * Show single item for desa user
     */
    async showDesa(req, res) {
      try {
        const desaId = validateDesaAccess(req, res);
        if (!desaId) return;

        const item = await prisma[tableName].findFirst({
          where: { id: String(req.params.id), desa_id: desaId },
          include: {
            desas: {
              select: {
                id: true,
                nama: true,
                kecamatans: { select: { id: true, nama: true } }
              }
            }
          }
        });

        if (!item) {
          return res.status(404).json({ success: false, message: `${displayName} tidak ditemukan` });
        }

        res.json({ success: true, data: item });
      } catch (error) {
        console.error(`Error in show${displayName}:`, error);
        res.status(500).json({ success: false, message: `Gagal mengambil data ${displayName}`, error: error.message });
      }
    },

    /**
     * Create new item
     */
    async create(req, res) {
      try {
        const user = req.user;
        const desaId = validateDesaAccess(req, res);
        if (!desaId) return;

        const { nama, alamat, produk_hukum_id } = req.body;

        // Check if already exists (singleton)
        const existing = await prisma[tableName].findFirst({
          where: { desa_id: desaId }
        });

        if (existing) {
          return res.status(400).json({ 
            success: false, 
            message: `${displayName} sudah ada untuk desa ini. Gunakan update untuk mengubah data.` 
          });
        }

        // Build data object
        const data = {
          id: uuidv4(), // Generate UUID for primary key
          nama: String(nama),
          desa_id: desaId,
          alamat: alamat || '',
          produk_hukum_id: produk_hukum_id || null,
          status_kelembagaan: 'aktif',
          status_verifikasi: 'unverified'
        };

        const newItem = await prisma[tableName].create({ data });

        // Log activity
        try {
          console.log(`🔍 Logging ${displayName} creation activity:`, {
            kelembagaanType: type,
            kelembagaanId: newItem.id,
            kelembagaanNama: newItem.nama,
            userId: user.id
          });
          
          await logKelembagaanActivity({
            kelembagaanType: type,
            kelembagaanId: newItem.id,
            kelembagaanNama: newItem.nama,
            desaId: newItem.desa_id,
            activityType: ACTIVITY_TYPES.CREATE,
            entityType: ENTITY_TYPES.LEMBAGA,
            entityId: newItem.id,
            entityName: newItem.nama,
            oldValue: null,
            newValue: { nama: newItem.nama, status_kelembagaan: newItem.status_kelembagaan },
            userId: user.id,
            userName: user.name,
            userRole: user.role,
            bidangId: user.bidang_id,
            ipAddress: req.ip,
            userAgent: req.get('user-agent')
          });
          
          console.log(`✅ ${displayName} creation activity logged successfully`);
        } catch (logError) {
          console.error(`❌ Error logging ${displayName} creation activity:`, logError);
        }

        res.json({ success: true, data: newItem });
      } catch (error) {
        console.error(`Error in create${displayName}:`, error);
        res.status(500).json({ success: false, message: `Gagal membuat ${displayName}`, error: error.message });
      }
    },

    /**
     * Update item
     */
    async update(req, res) {
      try {
        const user = req.user;
        const desaId = validateDesaAccess(req, res);
        if (!desaId) return;

        const item = await prisma[tableName].findFirst({
          where: { id: String(req.params.id), desa_id: desaId }
        });

        if (!item) {
          return res.status(404).json({ success: false, message: `${displayName} tidak ditemukan` });
        }

        const { nama, alamat, produk_hukum_id } = req.body;

        // Build update data
        const updateData = {
          nama: nama || item.nama,
          alamat: alamat !== undefined ? alamat : item.alamat,
          produk_hukum_id: produk_hukum_id !== undefined ? (produk_hukum_id || null) : item.produk_hukum_id
        };

        const updated = await prisma[tableName].update({
          where: { id: String(req.params.id) },
          data: updateData
        });

        // Log activity
        await logKelembagaanActivity({
          kelembagaanType: type,
          kelembagaanId: updated.id,
          kelembagaanNama: updated.nama,
          desaId: updated.desa_id,
          activityType: ACTIVITY_TYPES.UPDATE,
          entityType: ENTITY_TYPES.LEMBAGA,
          entityId: updated.id,
          entityName: updated.nama,
          oldValue: { nama: item.nama, alamat: item.alamat },
          newValue: { nama: updated.nama, alamat: updated.alamat },
          userId: user.id,
          userName: user.name,
          userRole: user.role,
          bidangId: user.bidang_id,
          ipAddress: req.ip,
          userAgent: req.get('user-agent')
        });

        res.json({ success: true, data: updated });
      } catch (error) {
        console.error(`Error in update${displayName}:`, error);
        res.status(500).json({ success: false, message: `Gagal mengubah ${displayName}`, error: error.message });
      }
    },

    /**
     * Toggle status
     */
    async toggleStatus(req, res) {
      try {
        const user = req.user;
        
        // First, find the item to get its desa_id
        // For superadmin/admin, allow access to any desa's kelembagaan
        const item = await prisma[tableName].findUnique({
          where: { id: String(req.params.id) }
        });

        if (!item) {
          return res.status(404).json({ success: false, message: `${displayName} tidak ditemukan` });
        }

        // For desa users, validate they have access to this desa
        if (user.role === 'desa' && Number(user.desa_id) !== Number(item.desa_id)) {
          return res.status(403).json({ success: false, message: 'User tidak memiliki akses desa' });
        }

        const { status_kelembagaan, produk_hukum_penonaktifan_id } = req.body;
        if (!status_kelembagaan) {
          return res.status(400).json({ success: false, message: 'Status kelembagaan harus diisi' });
        }

        const updateData = { status_kelembagaan };
        if (status_kelembagaan === 'nonaktif') {
          updateData.nonaktif_at = new Date();
          if (produk_hukum_penonaktifan_id) {
            updateData.produk_hukum_penonaktifan_id = produk_hukum_penonaktifan_id;
          }
        } else if (status_kelembagaan === 'aktif') {
          updateData.produk_hukum_penonaktifan_id = null;
          updateData.nonaktif_at = null;
        }

        const updated = await prisma[tableName].update({
          where: { id: String(req.params.id) },
          data: updateData
        });

        // Log activity
        await logKelembagaanActivity({
          kelembagaanType: type,
          kelembagaanId: updated.id,
          kelembagaanNama: updated.nama,
          desaId: updated.desa_id,
          activityType: ACTIVITY_TYPES.TOGGLE_STATUS,
          entityType: ENTITY_TYPES.LEMBAGA,
          entityId: updated.id,
          entityName: updated.nama,
          oldValue: { status_kelembagaan: item.status_kelembagaan },
          newValue: { status_kelembagaan: updated.status_kelembagaan },
          userId: user.id,
          userName: user.name,
          userRole: user.role,
          bidangId: user.bidang_id,
          ipAddress: req.ip,
          userAgent: req.get('user-agent')
        });

        res.json({ success: true, data: updated });
      } catch (error) {
        console.error(`Error in toggleStatus ${displayName}:`, error);
        res.status(500).json({ success: false, message: 'Gagal toggle status', error: error.message });
      }
    },

    /**
     * Toggle verification
     * Supports superadmin/admin access to any desa's kelembagaan
     */
    async toggleVerification(req, res) {
      try {
        const user = req.user;
        
        // First, find the item to get its desa_id
        // For superadmin/admin, allow access to any desa's kelembagaan
        const item = await prisma[tableName].findUnique({
          where: { id: String(req.params.id) }
        });

        if (!item) {
          return res.status(404).json({ success: false, message: `${displayName} tidak ditemukan` });
        }

        // For desa users, validate they have access to this desa
        if (user.role === 'desa' && Number(user.desa_id) !== Number(item.desa_id)) {
          return res.status(403).json({ success: false, message: 'User tidak memiliki akses desa' });
        }

        const { status_verifikasi, catatan_verifikasi } = req.body;
        if (!status_verifikasi) {
          return res.status(400).json({ success: false, message: 'Status verifikasi harus diisi' });
        }

        const updateData = { 
          status_verifikasi,
          verifikator_nama: user.name || user.username || null,
          verified_at: new Date(),
        };

        // Save catatan when unverifying (returning with feedback), clear when verifying
        if (status_verifikasi === 'unverified' && catatan_verifikasi) {
          updateData.catatan_verifikasi = catatan_verifikasi;
        } else if (status_verifikasi === 'verified') {
          updateData.catatan_verifikasi = null;
        }

        const updated = await prisma[tableName].update({
          where: { id: String(req.params.id) },
          data: updateData
        });

        // Log activity
        await logKelembagaanActivity({
          kelembagaanType: type,
          kelembagaanId: updated.id,
          kelembagaanNama: updated.nama,
          desaId: updated.desa_id,
          activityType: ACTIVITY_TYPES.VERIFY,
          entityType: ENTITY_TYPES.LEMBAGA,
          entityId: updated.id,
          entityName: updated.nama,
          oldValue: { status_verifikasi: item.status_verifikasi },
          newValue: { status_verifikasi: updated.status_verifikasi, catatan_verifikasi: updated.catatan_verifikasi || null },
          userId: user.id,
          userName: user.name,
          userRole: user.role,
          bidangId: user.bidang_id,
          ipAddress: req.ip,
          userAgent: req.get('user-agent')
        });

        res.json({ success: true, data: updated });
      } catch (error) {
        console.error(`Error in toggleVerification ${displayName}:`, error);
        res.status(500).json({ success: false, message: 'Gagal toggle verifikasi', error: error.message });
      }
    },

    /**
     * List all (for admin)
     */
    async list(req, res) {
      try {
        const { desa_id } = req.query;
        
        const where = {};
        if (desa_id) {
          where.desa_id = BigInt(desa_id);
        }

        const items = await prisma[tableName].findMany({
          where,
          include: {
            desas: {
              select: {
                id: true,
                nama: true,
                kecamatans: { select: { id: true, nama: true } }
              }
            }
          },
          orderBy: { desa_id: 'asc' }
        });

        res.json({ success: true, data: items });
      } catch (error) {
        console.error(`Error in list${displayName}:`, error);
        res.status(500).json({ success: false, message: `Gagal mengambil data ${displayName}`, error: error.message });
      }
    },

    /**
     * Show (for admin/public)
     */
    async show(req, res) {
      try {
        const { id } = req.params;
        
        const item = await prisma[tableName].findUnique({
          where: { id: id },
          include: {
            desas: {
              select: {
                id: true,
                nama: true,
                kecamatans: { select: { id: true, nama: true } }
              }
            }
          }
        });

        if (!item) {
          return res.status(404).json({ success: false, message: `${displayName} tidak ditemukan` });
        }

        const data = {
          id: item.id,
          nama: item.nama,
          alamat: item.alamat,
          status_kelembagaan: item.status_kelembagaan,
          status_verifikasi: item.status_verifikasi,
          produk_hukum_id: item.produk_hukum_id,
          desa_id: item.desa_id,
          desa: item.desas,
          created_at: item.created_at,
          updated_at: item.updated_at
        };

        res.json({ success: true, data });
      } catch (error) {
        console.error(`Error in show${displayName}:`, error);
        res.status(500).json({ success: false, message: `Gagal mengambil data ${displayName}`, error: error.message });
      }
    },

    /**
     * Create by admin/superadmin for specific desa
     * This allows superadmin to create kelembagaan for any desa
     */
    async createByAdmin(req, res) {
      try {
        const user = req.user;
        const { desaId } = req.params;

        // Only superadmin or admin can use this endpoint
        if (user.role !== 'superadmin' && user.role !== 'admin') {
          return res.status(403).json({ 
            success: false, 
            message: 'Hanya superadmin yang dapat membentuk lembaga untuk desa lain' 
          });
        }

        // Verify desa exists
        const desa = await prisma.desas.findUnique({
          where: { id: String(desaId) }
        });

        if (!desa) {
          return res.status(404).json({ 
            success: false, 
            message: 'Desa tidak ditemukan' 
          });
        }

        // Check if already exists (singleton)
        const existing = await prisma[tableName].findFirst({
          where: { desa_id: String(desaId) }
        });

        if (existing) {
          return res.status(400).json({ 
            success: false, 
            message: `${displayName} sudah ada untuk desa ini` 
          });
        }

        const { nama } = req.body;

        // Build data object
        const data = {
          id: uuidv4(),
          nama: nama || displayName,
          desa_id: String(desaId),
          alamat: '',
          produk_hukum_id: null,
          status_kelembagaan: 'aktif',
          status_verifikasi: 'verified' // Auto-verified when created by admin
        };

        const newItem = await prisma[tableName].create({ data });

        // Log activity
        try {
          await logKelembagaanActivity({
            kelembagaanType: type,
            kelembagaanId: newItem.id,
            kelembagaanNama: newItem.nama,
            desaId: newItem.desa_id,
            activityType: ACTIVITY_TYPES.CREATE,
            entityType: ENTITY_TYPES.LEMBAGA,
            entityId: newItem.id,
            entityName: newItem.nama,
            oldValue: null,
            newValue: { 
              nama: newItem.nama, 
              status_kelembagaan: newItem.status_kelembagaan,
              created_by: 'superadmin'
            },
            userId: user.id,
            userName: user.name,
            userRole: user.role
          });
        } catch (logError) {
          console.error(`Error logging ${displayName} creation by admin:`, logError);
        }

        res.json({ 
          success: true, 
          data: newItem,
          message: `${displayName} berhasil dibentuk` 
        });
      } catch (error) {
        console.error(`Error in createByAdmin${displayName}:`, error);
        res.status(500).json({ 
          success: false, 
          message: `Gagal membentuk ${displayName}`, 
          error: error.message 
        });
      }
    }
  };
}

// Create controllers for each singleton type
const karangTarunaController = createSingletonController('karang-taruna', 'karang_tarunas', 'Karang Taruna');
const lpmController = createSingletonController('lpm', 'lpms', 'LPM');
const pkkController = createSingletonController('pkk', 'pkks', 'PKK');
const satlinmasController = createSingletonController('satlinmas', 'satlinmas', 'Satlinmas');

module.exports = {
  karangTarunaController,
  lpmController,
  pkkController,
  satlinmasController
};
