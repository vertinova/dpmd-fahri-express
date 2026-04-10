/**
 * Posyandu Controller
 * Handles all Posyandu operations
 */

const { v4: uuidv4 } = require('uuid');
const {
  prisma,
  ACTIVITY_TYPES,
  ENTITY_TYPES,
  logKelembagaanActivity,
  validateDesaAccess,
  toUpper,
  createAjukanUlangHandler
} = require('./base.controller');

class PosyanduController {
  /**
   * List Posyandu for desa user
   * GET /api/desa/posyandu
   */
  async listDesaPosyandu(req, res) {
    try {
      const desaId = validateDesaAccess(req, res);
      if (!desaId) return;

      const items = await prisma.posyandus.findMany({
        where: { desa_id: desaId },
        select: {
          id: true,
          nama: true,
          status_kelembagaan: true,
          status_verifikasi: true
        },
        orderBy: { nama: 'asc' }
      });

      // Get ketua for each Posyandu
      const enrichedData = await Promise.all(
        items.map(async (posyandu) => {
          const ketua = await prisma.pengurus.findFirst({
            where: {
              pengurusable_type: 'posyandus',
              pengurusable_id: posyandu.id,
              status_jabatan: 'aktif',
              jabatan: {
                in: ['Ketua', 'ketua', 'KETUA', 'Ketua Posyandu', 'ketua posyandu']
              }
            },
            select: {
              nama_lengkap: true
            }
          });

          return {
            id: posyandu.id,
            nama: posyandu.nama,
            status_kelembagaan: posyandu.status_kelembagaan,
            status_verifikasi: posyandu.status_verifikasi,
            ketua_nama: ketua?.nama_lengkap || null
          };
        })
      );

      res.json({ success: true, data: enrichedData });
    } catch (error) {
      console.error('Error in listDesaPosyandu:', error);
      res.status(500).json({ success: false, message: 'Gagal mengambil data Posyandu', error: error.message });
    }
  }

  /**
   * Show single Posyandu for desa user
   * GET /api/desa/posyandu/:id
   */
  async showDesaPosyandu(req, res) {
    try {
      const desaId = validateDesaAccess(req, res);
      if (!desaId) return;

      const item = await prisma.posyandus.findFirst({
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
        return res.status(404).json({ success: false, message: 'Posyandu tidak ditemukan' });
      }

      res.json({ success: true, data: item });
    } catch (error) {
      console.error('Error in showDesaPosyandu:', error);
      res.status(500).json({ success: false, message: 'Gagal mengambil data Posyandu', error: error.message });
    }
  }

  /**
   * Create new Posyandu
   * POST /api/desa/posyandu
   */
  async createPosyandu(req, res) {
    try {
      const user = req.user;
      const desaId = validateDesaAccess(req, res);
      if (!desaId) return;

      const { nama, alamat, produk_hukum_id } = req.body;

      if (!produk_hukum_id) {
        return res.status(400).json({ success: false, message: 'Produk hukum wajib dipilih untuk membuat Posyandu' });
      }

      // Check if Posyandu with same nama already exists
      const existing = await prisma.posyandus.findFirst({
        where: { nama: String(nama), desa_id: desaId }
      });

      if (existing) {
        return res.status(400).json({ success: false, message: 'Posyandu dengan nama tersebut sudah ada' });
      }

      const newItem = await prisma.posyandus.create({
        data: {
          id: uuidv4(), // Generate UUID for primary key
          nama: toUpper(nama),
          desa_id: desaId,
          alamat: toUpper(alamat) || '',
          produk_hukum_id: produk_hukum_id || null,
          status_kelembagaan: 'aktif',
          status_verifikasi: 'unverified'
        }
      });

      // Log activity
      try {
        console.log('🔍 Logging Posyandu creation activity:', {
          kelembagaanType: 'posyandu',
          kelembagaanId: newItem.id,
          kelembagaanNama: newItem.nama,
          userId: user.id
        });
        
        await logKelembagaanActivity({
          kelembagaanType: 'posyandu',
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
        
        console.log('✅ Posyandu creation activity logged successfully');
      } catch (logError) {
        console.error('❌ Error logging Posyandu creation activity:', logError);
      }

      res.json({ success: true, data: newItem });
    } catch (error) {
      console.error('Error in createPosyandu:', error);
      res.status(500).json({ success: false, message: 'Gagal membuat Posyandu', error: error.message });
    }
  }

  /**
   * Update Posyandu
   * PUT /api/desa/posyandu/:id
   */
  async updatePosyandu(req, res) {
    try {
      const user = req.user;
      const desaId = validateDesaAccess(req, res);
      if (!desaId) return;

      const item = await prisma.posyandus.findFirst({
        where: { id: String(req.params.id), desa_id: desaId }
      });

      if (!item) {
        return res.status(404).json({ success: false, message: 'Posyandu tidak ditemukan' });
      }

      const { nama, alamat, produk_hukum_id } = req.body;

      const updated = await prisma.posyandus.update({
        where: { id: String(req.params.id) },
        data: {
          nama: toUpper(nama) || item.nama,
          alamat: alamat !== undefined ? toUpper(alamat) : item.alamat,
          produk_hukum_id: produk_hukum_id !== undefined ? (produk_hukum_id || null) : item.produk_hukum_id
        }
      });

      // Log activity
      await logKelembagaanActivity({
        kelembagaanType: 'posyandu',
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
      console.error('Error in updatePosyandu:', error);
      res.status(500).json({ success: false, message: 'Gagal mengubah Posyandu', error: error.message });
    }
  }

  /**
   * Toggle Posyandu status
   * PUT /api/desa/posyandu/:id/toggle-status
   */
  async toggleStatus(req, res) {
    try {
      const user = req.user;
      
      // First, find the item to get its desa_id
      // For superadmin/admin, allow access to any desa's kelembagaan
      const item = await prisma.posyandus.findUnique({
        where: { id: String(req.params.id) }
      });

      if (!item) {
        return res.status(404).json({ success: false, message: 'Posyandu tidak ditemukan' });
      }

      // For desa users, validate they have access to this desa
      if (user.role === 'desa' && Number(user.desa_id) !== Number(item.desa_id)) {
        return res.status(403).json({ success: false, message: 'User tidak memiliki akses desa' });
      }

      const { status_kelembagaan, produk_hukum_penonaktifan_id } = req.body;

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

      const updated = await prisma.posyandus.update({
        where: { id: String(req.params.id) },
        data: updateData
      });

      // Log activity
      await logKelembagaanActivity({
        kelembagaanType: 'posyandu',
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
      console.error('Error in toggleStatus:', error);
      res.status(500).json({ success: false, message: 'Gagal mengubah status Posyandu', error: error.message });
    }
  }

  /**
   * Toggle Posyandu verification
   * PUT /api/desa/posyandu/:id/toggle-verification
   */
  async toggleVerification(req, res) {
    try {
      const user = req.user;
      
      // First, find the item to get its desa_id
      // For superadmin/admin, allow access to any desa's kelembagaan
      const item = await prisma.posyandus.findUnique({
        where: { id: String(req.params.id) }
      });

      if (!item) {
        return res.status(404).json({ success: false, message: 'Posyandu tidak ditemukan' });
      }

      // For desa users, validate they have access to this desa
      if (user.role === 'desa' && Number(user.desa_id) !== Number(item.desa_id)) {
        return res.status(403).json({ success: false, message: 'User tidak memiliki akses desa' });
      }

      const { status_verifikasi, catatan_verifikasi } = req.body;

      const updateData = { 
        status_verifikasi,
        verifikator_nama: user.name || user.username || null,
        verified_at: new Date(),
      };

      if (status_verifikasi === 'ditolak' && catatan_verifikasi) {
        updateData.catatan_verifikasi = catatan_verifikasi;
      } else if (status_verifikasi === 'verified') {
        updateData.catatan_verifikasi = null;
      }

      const updated = await prisma.posyandus.update({
        where: { id: String(req.params.id) },
        data: updateData
      });

      // Log activity
      await logKelembagaanActivity({
        kelembagaanType: 'posyandu',
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
      console.error('Error in toggleVerification:', error);
      res.status(500).json({ success: false, message: 'Gagal mengubah verifikasi Posyandu', error: error.message });
    }
  }

  /**
   * List all Posyandu (for admin)
   * GET /api/kelembagaan/posyandu
   */
  async listPosyandu(req, res) {
    try {
      const { desa_id } = req.query;
      
      const where = {};
      if (desa_id) {
        where.desa_id = BigInt(desa_id);
      }

      const items = await prisma.posyandus.findMany({
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
        orderBy: [{ desa_id: 'asc' }, { nama: 'asc' }]
      });

      // Get ketua for each Posyandu
      const enrichedData = await Promise.all(
        items.map(async (posyandu) => {
          const ketua = await prisma.pengurus.findFirst({
            where: {
              pengurusable_type: 'posyandus',
              pengurusable_id: posyandu.id,
              status_jabatan: 'aktif',
              jabatan: {
                in: ['Ketua', 'ketua', 'KETUA', 'Ketua Posyandu', 'ketua posyandu']
              }
            },
            select: {
              nama_lengkap: true
            }
          });

          return {
            id: posyandu.id,
            nama: posyandu.nama,
            alamat: posyandu.alamat,
            status_kelembagaan: posyandu.status_kelembagaan,
            status_verifikasi: posyandu.status_verifikasi,
            desa_id: posyandu.desa_id,
            desa: posyandu.desas,
            ketua_nama: ketua?.nama_lengkap || null,
            created_at: posyandu.created_at,
            updated_at: posyandu.updated_at
          };
        })
      );

      res.json({ success: true, data: enrichedData });
    } catch (error) {
      console.error('Error in listPosyandu:', error);
      res.status(500).json({ success: false, message: 'Gagal mengambil data Posyandu', error: error.message });
    }
  }

  /**
   * Show Posyandu (for admin/public)
   * GET /api/kelembagaan/posyandu/:id
   */
  async showPosyandu(req, res) {
    try {
      const { id } = req.params;
      
      const posyandu = await prisma.posyandus.findUnique({
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

      if (!posyandu) {
        return res.status(404).json({ success: false, message: 'Posyandu tidak ditemukan' });
      }

      const data = {
        id: posyandu.id,
        nama: posyandu.nama,
        alamat: posyandu.alamat,
        status_kelembagaan: posyandu.status_kelembagaan,
        status_verifikasi: posyandu.status_verifikasi,
        desa_id: posyandu.desa_id,
        desa: posyandu.desas,
        created_at: posyandu.created_at,
        updated_at: posyandu.updated_at
      };

      res.json({ success: true, data });
    } catch (error) {
      console.error('Error in showPosyandu:', error);
      res.status(500).json({ success: false, message: 'Gagal mengambil data Posyandu', error: error.message });
    }
  }

  // Ajukan ulang verifikasi (desa resubmit after ditolak)
  ajukanUlangVerifikasi = createAjukanUlangHandler('posyandus', 'posyandu', 'Posyandu', (item) => item.nama);
}

module.exports = new PosyanduController();
