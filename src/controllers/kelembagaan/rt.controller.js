/**
 * RT Controller
 * Handles all RT (Rukun Tetangga) operations
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

class RTController {
  /**
   * List RT for desa user
   * GET /api/desa/rt
   */
  async listDesaRT(req, res) {
    try {
      const desaId = validateDesaAccess(req, res);
      if (!desaId) return;

      const items = await prisma.rts.findMany({
        where: { desa_id: desaId },
        select: {
          id: true,
          nomor: true,
          rw_id: true,
          status_kelembagaan: true,
          status_verifikasi: true,
          rws: { 
            select: { 
              id: true, 
              nomor: true 
            } 
          }
        },
        orderBy: [{ rw_id: 'asc' }, { nomor: 'asc' }]
      });

      // Get ketua for each RT
      const enrichedItems = await Promise.all(
        items.map(async (rt) => {
          const ketua = await prisma.pengurus.findFirst({
            where: {
              pengurusable_type: 'rts',
              pengurusable_id: rt.id,
              status_jabatan: 'aktif',
              jabatan: {
                in: ['Ketua RT', 'ketua rt', 'KETUA RT']
              }
            },
            select: {
              nama_lengkap: true
            }
          });

          return {
            id: rt.id,
            nomor: rt.nomor,
            rw_id: rt.rw_id,
            status_kelembagaan: rt.status_kelembagaan,
            status_verifikasi: rt.status_verifikasi,
            ketua_nama: ketua?.nama_lengkap || null,
            rws: rt.rws // Only id and nomor
          };
        })
      );

      res.json({ success: true, data: enrichedItems });
    } catch (error) {
      console.error('Error in listDesaRT:', error);
      res.status(500).json({ success: false, message: 'Gagal mengambil data RT', error: error.message });
    }
  }

  /**
   * Show single RT for desa user
   * GET /api/desa/rt/:id
   */
  async showDesaRT(req, res) {
    try {
      const desaId = validateDesaAccess(req, res);
      if (!desaId) return;

      const item = await prisma.rts.findFirst({
        where: { id: String(req.params.id), desa_id: desaId },
        include: {
          rws: { select: { id: true, nomor: true } },
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
        return res.status(404).json({ success: false, message: 'RT tidak ditemukan' });
      }

      res.json({ success: true, data: item });
    } catch (error) {
      console.error('Error in showDesaRT:', error);
      res.status(500).json({ success: false, message: 'Gagal mengambil data RT', error: error.message });
    }
  }

  /**
   * Create new RT
   * POST /api/desa/rt
   */
  async createRT(req, res) {
    try {
      const user = req.user;
      const desaId = validateDesaAccess(req, res);
      if (!desaId) return;

      const { nomor, rw_id, alamat, produk_hukum_id, jumlah_jiwa, jumlah_kk } = req.body;

      // Validate RW exists and belongs to same desa
      const rw = await prisma.rws.findFirst({
        where: { id: String(rw_id), desa_id: desaId }
      });

      if (!rw) {
        return res.status(400).json({ success: false, message: 'RW tidak ditemukan atau tidak sesuai dengan desa' });
      }

      // Check if RT with same nomor already exists in this RW
      const existing = await prisma.rts.findFirst({
        where: { nomor: String(nomor), rw_id: String(rw_id) }
      });

      if (existing) {
        return res.status(400).json({ success: false, message: 'RT dengan nomor tersebut sudah ada di RW ini' });
      }

      const newItem = await prisma.rts.create({
        data: {
          id: uuidv4(),
          nomor: String(nomor),
          rw_id: String(rw_id),
          desa_id: desaId,
          alamat: toUpper(alamat) || rw.alamat || '',
          produk_hukum_id: produk_hukum_id || null,
          jumlah_jiwa: jumlah_jiwa ? parseInt(jumlah_jiwa) : null,
          jumlah_kk: jumlah_kk ? parseInt(jumlah_kk) : null,
          status_kelembagaan: 'aktif',
          status_verifikasi: 'unverified'
        }
      });

      // Log activity
      try {
        console.log('🔍 Logging RT creation activity:', {
          kelembagaanType: 'rt',
          kelembagaanId: newItem.id,
          kelembagaanNama: `RT ${newItem.nomor}`,
          userId: user.id
        });
        
        await logKelembagaanActivity({
          kelembagaanType: 'rt',
          kelembagaanId: newItem.id,
          kelembagaanNama: `RT ${newItem.nomor}`,
          desaId: newItem.desa_id,
          activityType: ACTIVITY_TYPES.CREATE,
          entityType: ENTITY_TYPES.LEMBAGA,
          entityId: newItem.id,
          entityName: `RT ${newItem.nomor}`,
          oldValue: null,
          newValue: { nomor: newItem.nomor, rw_id: newItem.rw_id, status_kelembagaan: newItem.status_kelembagaan },
          userId: user.id,
          userName: user.name,
          userRole: user.role,
          bidangId: user.bidang_id,
          ipAddress: req.ip,
          userAgent: req.get('user-agent')
        });
        
        console.log('✅ RT creation activity logged successfully');
      } catch (logError) {
        console.error('❌ Error logging RT creation activity:', logError);
      }

      res.json({ success: true, data: newItem });
    } catch (error) {
      console.error('Error in createRT:', error);
      res.status(500).json({ success: false, message: 'Gagal membuat RT', error: error.message });
    }
  }

  /**
   * Update RT
   * PUT /api/desa/rt/:id
   */
  async updateRT(req, res) {
    try {
      const user = req.user;
      const desaId = validateDesaAccess(req, res);
      if (!desaId) return;

      const item = await prisma.rts.findFirst({
        where: { id: String(req.params.id), desa_id: desaId }
      });

      if (!item) {
        return res.status(404).json({ success: false, message: 'RT tidak ditemukan' });
      }

      const { nomor, alamat, produk_hukum_id, jumlah_jiwa, jumlah_kk } = req.body;

      const updated = await prisma.rts.update({
        where: { id: String(req.params.id) },
        data: {
          nomor: nomor || item.nomor,
          alamat: alamat !== undefined ? toUpper(alamat) : item.alamat,
          produk_hukum_id: produk_hukum_id !== undefined ? (produk_hukum_id || null) : item.produk_hukum_id,
          jumlah_jiwa: jumlah_jiwa !== undefined ? (jumlah_jiwa ? parseInt(jumlah_jiwa) : null) : item.jumlah_jiwa,
          jumlah_kk: jumlah_kk !== undefined ? (jumlah_kk ? parseInt(jumlah_kk) : null) : item.jumlah_kk
        }
      });

      // Log activity
      await logKelembagaanActivity({
        kelembagaanType: 'rt',
        kelembagaanId: updated.id,
        kelembagaanNama: `RT ${updated.nomor}`,
        desaId: updated.desa_id,
        activityType: ACTIVITY_TYPES.UPDATE,
        entityType: ENTITY_TYPES.LEMBAGA,
        entityId: updated.id,
        entityName: `RT ${updated.nomor}`,
        oldValue: { nomor: item.nomor, alamat: item.alamat },
        newValue: { nomor: updated.nomor, alamat: updated.alamat },
        userId: user.id,
        userName: user.name,
        userRole: user.role,
        bidangId: user.bidang_id,
        ipAddress: req.ip,
        userAgent: req.get('user-agent')
      });

      res.json({ success: true, data: updated });
    } catch (error) {
      console.error('Error in updateRT:', error);
      res.status(500).json({ success: false, message: 'Gagal mengubah RT', error: error.message });
    }
  }

  /**
   * Toggle RT status
   * PUT /api/desa/rt/:id/toggle-status
   */
  async toggleStatus(req, res) {
    try {
      const user = req.user;
      
      // First, find the item to get its desa_id
      // For superadmin/admin, allow access to any desa's kelembagaan
      const item = await prisma.rts.findUnique({
        where: { id: String(req.params.id) }
      });

      if (!item) {
        return res.status(404).json({ success: false, message: 'RT tidak ditemukan' });
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

      const updated = await prisma.rts.update({
        where: { id: String(req.params.id) },
        data: updateData
      });

      // Log activity
      await logKelembagaanActivity({
        kelembagaanType: 'rt',
        kelembagaanId: updated.id,
        kelembagaanNama: `RT ${updated.nomor}`,
        desaId: updated.desa_id,
        activityType: ACTIVITY_TYPES.TOGGLE_STATUS,
        entityType: ENTITY_TYPES.LEMBAGA,
        entityId: updated.id,
        entityName: `RT ${updated.nomor}`,
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
      res.status(500).json({ success: false, message: 'Gagal mengubah status RT', error: error.message });
    }
  }

  /**
   * Toggle RT verification
   * PUT /api/desa/rt/:id/toggle-verification
   */
  async toggleVerification(req, res) {
    try {
      const user = req.user;
      
      // First, find the item to get its desa_id
      // For superadmin/admin, allow access to any desa's kelembagaan
      const item = await prisma.rts.findUnique({
        where: { id: String(req.params.id) }
      });

      if (!item) {
        return res.status(404).json({ success: false, message: 'RT tidak ditemukan' });
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

      const updated = await prisma.rts.update({
        where: { id: String(req.params.id) },
        data: updateData
      });

      // Log activity
      await logKelembagaanActivity({
        kelembagaanType: 'rt',
        kelembagaanId: updated.id,
        kelembagaanNama: `RT ${updated.nomor}`,
        desaId: updated.desa_id,
        activityType: ACTIVITY_TYPES.VERIFY,
        entityType: ENTITY_TYPES.LEMBAGA,
        entityId: updated.id,
        entityName: `RT ${updated.nomor}`,
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
      res.status(500).json({ success: false, message: 'Gagal mengubah verifikasi RT', error: error.message });
    }
  }

  /**
   * List all RT (for admin)
   * GET /api/kelembagaan/rt
   */
  async listRT(req, res) {
    try {
      const { desa_id } = req.query;
      
      const where = {};
      if (desa_id) {
        where.desa_id = BigInt(desa_id);
      }

      const items = await prisma.rts.findMany({
        where,
        include: {
          rws: { select: { id: true, nomor: true } },
          desas: {
            select: {
              id: true,
              nama: true,
              kecamatans: { select: { id: true, nama: true } }
            }
          }
        },
        orderBy: [{ desa_id: 'asc' }, { rw_id: 'asc' }, { nomor: 'asc' }]
      });

      // Get ketua for each RT
      const enrichedItems = await Promise.all(
        items.map(async (rt) => {
          const ketua = await prisma.pengurus.findFirst({
            where: {
              pengurusable_type: 'rts',
              pengurusable_id: rt.id,
              status_jabatan: 'aktif',
              jabatan: {
                in: ['Ketua RT', 'ketua rt', 'KETUA RT']
              }
            },
            select: {
              nama_lengkap: true
            }
          });

          return {
            ...rt,
            ketua_nama: ketua?.nama_lengkap || null
          };
        })
      );

      res.json({ success: true, data: enrichedItems });
    } catch (error) {
      console.error('Error in listRT:', error);
      res.status(500).json({ success: false, message: 'Gagal mengambil data RT', error: error.message });
    }
  }

  /**
   * Show RT (for admin/public)
   * GET /api/kelembagaan/rt/:id
   */
  async showRT(req, res) {
    try {
      const { id } = req.params;
      
      const rt = await prisma.rts.findUnique({
        where: { id: id },
        include: {
          rws: { select: { id: true, nomor: true } },
          desas: {
            select: {
              id: true,
              nama: true,
              kecamatans: { select: { id: true, nama: true } }
            }
          }
        }
      });

      if (!rt) {
        return res.status(404).json({ success: false, message: 'RT tidak ditemukan' });
      }

      const data = {
        id: rt.id,
        nomor: rt.nomor,
        rw_id: rt.rw_id,
        rw: rt.rws,
        alamat: rt.alamat,
        status_kelembagaan: rt.status_kelembagaan,
        status_verifikasi: rt.status_verifikasi,
        desa_id: rt.desa_id,
        desa: rt.desas,
        created_at: rt.created_at,
        updated_at: rt.updated_at
      };

      res.json({ success: true, data });
    } catch (error) {
      console.error('Error in showRT:', error);
      res.status(500).json({ success: false, message: 'Gagal mengambil data RT', error: error.message });
    }
  }

  // Ajukan ulang verifikasi (desa resubmit after ditolak)
  ajukanUlangVerifikasi = createAjukanUlangHandler('rts', 'rt', 'RT', (item) => `RT ${item.nomor}`);
}

module.exports = new RTController();
