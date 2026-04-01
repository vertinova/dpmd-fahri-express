/**
 * RW Controller
 * Handles all RW (Rukun Warga) operations
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

class RWController {
  /**
   * List RW for desa user
   * GET /api/desa/rw
   */
  async listDesaRW(req, res) {
    try {
      const desaId = validateDesaAccess(req, res);
      if (!desaId) return;

      const items = await prisma.rws.findMany({
        where: { desa_id: desaId },
        select: {
          id: true,
          nomor: true,
          status_kelembagaan: true,
          status_verifikasi: true,
          rts: {
            select: {
              id: true,
              nomor: true,
              status_kelembagaan: true,
              status_verifikasi: true,
            },
            orderBy: { nomor: 'asc' }
          }
        },
        orderBy: { nomor: 'asc' }
      });

      // Get ketua for each RW and each RT
      const enrichedData = await Promise.all(
        items.map(async (rw) => {
          const ketua = await prisma.pengurus.findFirst({
            where: {
              pengurusable_type: 'rws',
              pengurusable_id: rw.id,
              status_jabatan: 'aktif',
              jabatan: {
                in: ['Ketua RW', 'ketua rw', 'KETUA RW']
              }
            },
            select: {
              nama_lengkap: true
            }
          });

          // Get ketua for each RT
          const rtsWithKetua = await Promise.all(
            (rw.rts || []).map(async (rt) => {
              const rtKetua = await prisma.pengurus.findFirst({
                where: {
                  pengurusable_type: 'rts',
                  pengurusable_id: rt.id,
                  status_jabatan: 'aktif',
                  jabatan: {
                    in: ['Ketua RT', 'ketua rt', 'KETUA RT']
                  }
                },
                select: { nama_lengkap: true }
              });
              return {
                ...rt,
                ketua_nama: rtKetua?.nama_lengkap || null
              };
            })
          );

          return {
            id: rw.id,
            nomor: rw.nomor,
            status_kelembagaan: rw.status_kelembagaan,
            status_verifikasi: rw.status_verifikasi,
            ketua_nama: ketua?.nama_lengkap || null,
            jumlah_rt: rw.rts?.length || 0,
            rts: rtsWithKetua
          };
        })
      );

      res.json({ success: true, data: enrichedData });
    } catch (error) {
      console.error('Error in listDesaRW:', error);
      res.status(500).json({ success: false, message: 'Gagal mengambil data RW', error: error.message });
    }
  }

  /**
   * Show single RW for desa user
   * GET /api/desa/rw/:id
   */
  async showDesaRW(req, res) {
    try {
      const desaId = validateDesaAccess(req, res);
      if (!desaId) return;

      const item = await prisma.rws.findFirst({
        where: { id: String(req.params.id), desa_id: desaId },
        include: {
          desas: {
            select: {
              id: true,
              nama: true,
              kecamatans: { select: { id: true, nama: true } }
            }
          },
          rts: { 
            select: { 
              id: true, 
              nomor: true,
              alamat: true,
              jumlah_jiwa: true,
              jumlah_kk: true
            },
            orderBy: { nomor: 'asc' }
          }
        }
      });

      if (!item) {
        return res.status(404).json({ success: false, message: 'RW tidak ditemukan' });
      }

      // Get ketua for each RT
      const enrichedRts = await Promise.all(
        (item.rts || []).map(async (rt) => {
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

      const data = {
        ...item,
        rts: enrichedRts,
        jumlah_rt: enrichedRts.length
      };

      res.json({ success: true, data });
    } catch (error) {
      console.error('Error in showDesaRW:', error);
      res.status(500).json({ success: false, message: 'Gagal mengambil data RW', error: error.message });
    }
  }

  /**
   * Create new RW
   * POST /api/desa/rw
   */
  async createRW(req, res) {
    try {
      const user = req.user;
      const desaId = validateDesaAccess(req, res);
      if (!desaId) return;

      const { nomor, alamat, produk_hukum_id } = req.body;

      // Check if RW with same nomor already exists
      const existing = await prisma.rws.findFirst({
        where: { nomor: String(nomor), desa_id: desaId }
      });

      if (existing) {
        return res.status(400).json({ success: false, message: 'RW dengan nomor tersebut sudah ada' });
      }

      const newItem = await prisma.rws.create({
        data: {
          id: uuidv4(),
          nomor: String(nomor),
          desa_id: desaId,
          alamat: toUpper(alamat) || '',
          produk_hukum_id: produk_hukum_id || null,
          status_kelembagaan: 'aktif',
          status_verifikasi: 'unverified'
        }
      });

      // Log activity
      try {
        console.log('🔍 Logging RW creation activity:', {
          kelembagaanType: 'rw',
          kelembagaanId: newItem.id,
          kelembagaanNama: `RW ${newItem.nomor}`,
          userId: user.id,
          userName: user.name
        });
        
        await logKelembagaanActivity({
          kelembagaanType: 'rw',
          kelembagaanId: newItem.id,
          kelembagaanNama: `RW ${newItem.nomor}`,
          desaId: newItem.desa_id,
          activityType: ACTIVITY_TYPES.CREATE,
          entityType: ENTITY_TYPES.LEMBAGA,
          entityId: newItem.id,
          entityName: `RW ${newItem.nomor}`,
          oldValue: null,
          newValue: { nomor: newItem.nomor, status_kelembagaan: newItem.status_kelembagaan },
          userId: user.id,
          userName: user.name,
          userRole: user.role,
          bidangId: user.bidang_id,
          ipAddress: req.ip,
          userAgent: req.get('user-agent')
        });
        
        console.log('✅ RW creation activity logged successfully');
      } catch (logError) {
        console.error('❌ Error logging RW creation activity:', logError);
      }

      res.json({ success: true, data: newItem });
    } catch (error) {
      console.error('Error in createRW:', error);
      res.status(500).json({ success: false, message: 'Gagal membuat RW', error: error.message });
    }
  }

  /**
   * Update RW
   * PUT /api/desa/rw/:id
   */
  async updateRW(req, res) {
    try {
      const user = req.user;
      const desaId = validateDesaAccess(req, res);
      if (!desaId) return;

      const item = await prisma.rws.findFirst({
        where: { id: String(req.params.id), desa_id: desaId }
      });

      if (!item) {
        return res.status(404).json({ success: false, message: 'RW tidak ditemukan' });
      }

      const { nomor, alamat, produk_hukum_id } = req.body;

      const updated = await prisma.rws.update({
        where: { id: String(req.params.id) },
        data: {
          nomor: nomor || item.nomor,
          alamat: alamat !== undefined ? toUpper(alamat) : item.alamat,
          produk_hukum_id: produk_hukum_id !== undefined ? (produk_hukum_id || null) : item.produk_hukum_id
        }
      });

      // Log activity
      await logKelembagaanActivity({
        kelembagaanType: 'rw',
        kelembagaanId: updated.id,
        kelembagaanNama: `RW ${updated.nomor}`,
        desaId: updated.desa_id,
        activityType: ACTIVITY_TYPES.UPDATE,
        entityType: ENTITY_TYPES.LEMBAGA,
        entityId: updated.id,
        entityName: `RW ${updated.nomor}`,
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
      console.error('Error in updateRW:', error);
      res.status(500).json({ success: false, message: 'Gagal mengubah RW', error: error.message });
    }
  }

  /**
   * Toggle RW status
   * PUT /api/desa/rw/:id/toggle-status
   */
  async toggleStatus(req, res) {
    try {
      const user = req.user;
      
      // First, find the item to get its desa_id
      // For superadmin/admin, allow access to any desa's kelembagaan
      const item = await prisma.rws.findUnique({
        where: { id: String(req.params.id) }
      });

      if (!item) {
        return res.status(404).json({ success: false, message: 'RW tidak ditemukan' });
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

      const updated = await prisma.rws.update({
        where: { id: String(req.params.id) },
        data: updateData
      });

      // Log activity - ensure this completes before sending response
      try {
        await logKelembagaanActivity({
          kelembagaanType: 'rw',
          kelembagaanId: updated.id,
          kelembagaanNama: `RW ${updated.nomor}`,
          desaId: updated.desa_id,
          activityType: ACTIVITY_TYPES.TOGGLE_STATUS,
          entityType: ENTITY_TYPES.LEMBAGA,
          entityId: updated.id,
          entityName: `RW ${updated.nomor}`,
          oldValue: { status_kelembagaan: item.status_kelembagaan },
          newValue: { status_kelembagaan: updated.status_kelembagaan },
          userId: user.id,
          userName: user.name,
          userRole: user.role,
          bidangId: user.bidang_id,
          ipAddress: req.ip,
          userAgent: req.get('user-agent')
        });
      } catch (logError) {
        console.error('Error logging activity:', logError);
        // Continue even if logging fails
      }

      res.json({ success: true, data: updated });
    } catch (error) {
      console.error('Error in toggleStatus:', error);
      res.status(500).json({ success: false, message: 'Gagal mengubah status RW', error: error.message });
    }
  }

  /**
   * Toggle RW verification
   * PUT /api/desa/rw/:id/toggle-verification
   */
  async toggleVerification(req, res) {
    try {
      const user = req.user;
      
      // First, find the item to get its desa_id
      // For superadmin/admin, allow access to any desa's kelembagaan
      const item = await prisma.rws.findUnique({
        where: { id: String(req.params.id) }
      });

      if (!item) {
        return res.status(404).json({ success: false, message: 'RW tidak ditemukan' });
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

      const updated = await prisma.rws.update({
        where: { id: String(req.params.id) },
        data: updateData
      });

      // Log activity - ensure this completes before sending response
      try {
        await logKelembagaanActivity({
          kelembagaanType: 'rw',
          kelembagaanId: updated.id,
          kelembagaanNama: `RW ${updated.nomor}`,
          desaId: updated.desa_id,
          activityType: ACTIVITY_TYPES.VERIFY,
          entityType: ENTITY_TYPES.LEMBAGA,
          entityId: updated.id,
          entityName: `RW ${updated.nomor}`,
          oldValue: { status_verifikasi: item.status_verifikasi },
          newValue: { status_verifikasi: updated.status_verifikasi, catatan_verifikasi: updated.catatan_verifikasi || null },
          userId: user.id,
          userName: user.name,
          userRole: user.role,
          bidangId: user.bidang_id,
          ipAddress: req.ip,
          userAgent: req.get('user-agent')
        });
      } catch (logError) {
        console.error('Error logging activity:', logError);
        // Continue even if logging fails
      }

      res.json({ success: true, data: updated });
    } catch (error) {
      console.error('Error in toggleVerification:', error);
      res.status(500).json({ success: false, message: 'Gagal mengubah verifikasi RW', error: error.message });
    }
  }

  /**
   * List RW (for admin/public)
   * GET /api/kelembagaan/rw
   * Optional query: desaId
   */
  async listRW(req, res) {
    try {
      const { desaId } = req.query;
      
      // Build where clause
      const whereClause = {};
      if (desaId) {
        whereClause.desa_id = desaId;
      }

      const items = await prisma.rws.findMany({
        where: whereClause,
        select: {
          id: true,
          nomor: true,
          alamat: true,
          status_kelembagaan: true,
          status_verifikasi: true,
          desa_id: true,
          desas: {
            select: {
              id: true,
              nama: true,
              kecamatans: {
                select: {
                  id: true,
                  nama: true
                }
              }
            }
          },
          rts: {
            select: {
              id: true,
              nomor: true,
              status_kelembagaan: true,
              status_verifikasi: true,
            },
            orderBy: { nomor: 'asc' }
          }
        },
        orderBy: [
          { desa_id: 'asc' },
          { nomor: 'asc' }
        ]
      });

      // Get ketua for each RW and each RT
      const enrichedData = await Promise.all(
        items.map(async (rw) => {
          // Get RW ketua
          const ketua = await prisma.pengurus.findFirst({
            where: {
              pengurusable_type: 'rws',
              pengurusable_id: rw.id,
              status_jabatan: 'aktif',
              jabatan: {
                in: ['Ketua RW', 'ketua rw', 'KETUA RW']
              }
            },
            select: {
              nama_lengkap: true
            }
          });

          // Get ketua for each RT
          const rtsWithKetua = await Promise.all(
            (rw.rts || []).map(async (rt) => {
              const rtKetua = await prisma.pengurus.findFirst({
                where: {
                  pengurusable_type: 'rts',
                  pengurusable_id: rt.id,
                  status_jabatan: 'aktif',
                  jabatan: {
                    in: ['Ketua RT', 'ketua rt', 'KETUA RT']
                  }
                },
                select: { nama_lengkap: true }
              });
              return {
                ...rt,
                ketua_nama: rtKetua?.nama_lengkap || null
              };
            })
          );

          return {
            id: rw.id,
            nomor: rw.nomor,
            alamat: rw.alamat,
            status_kelembagaan: rw.status_kelembagaan,
            status_verifikasi: rw.status_verifikasi,
            desa_id: rw.desa_id,
            desa: rw.desas,
            ketua_nama: ketua?.nama_lengkap || null,
            jumlah_rt: rw.rts?.length || 0,
            rts: rtsWithKetua
          };
        })
      );

      res.json({ success: true, data: enrichedData });
    } catch (error) {
      console.error('Error in listRW:', error);
      res.status(500).json({ success: false, message: 'Gagal mengambil data RW', error: error.message });
    }
  }

  /**
   * Show RW (for admin/public)
   * GET /api/kelembagaan/rw/:id
   */
  async showRW(req, res) {
    try {
      const { id } = req.params;
      
      const rw = await prisma.rws.findUnique({
        where: { id: id },
        include: {
          desas: {
            select: {
              id: true,
              nama: true,
              kecamatans: {
                select: { id: true, nama: true }
              }
            }
          },
          rts: {
            select: { 
              id: true, 
              nomor: true, 
              alamat: true,
              status_kelembagaan: true,
              jumlah_jiwa: true,
              jumlah_kk: true
            },
            orderBy: { nomor: 'asc' }
          }
        }
      });

      if (!rw) {
        return res.status(404).json({ success: false, message: 'RW tidak ditemukan' });
      }

      // Get ketua for each RT
      const enrichedRts = await Promise.all(
        (rw.rts || []).map(async (rt) => {
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

      const data = {
        id: rw.id,
        nomor: rw.nomor,
        alamat: rw.alamat,
        status_kelembagaan: rw.status_kelembagaan,
        status_verifikasi: rw.status_verifikasi,
        produk_hukum_id: rw.produk_hukum_id,
        desa_id: rw.desa_id,
        desa: rw.desas,
        jumlah_rt: enrichedRts.length,
        rts: enrichedRts,
        created_at: rw.created_at,
        updated_at: rw.updated_at
      };

      res.json({ success: true, data });
    } catch (error) {
      console.error('Error in showRW:', error);
      res.status(500).json({ success: false, message: 'Gagal mengambil data RW', error: error.message });
    }
  }

  // Ajukan ulang verifikasi (desa resubmit after ditolak)
  ajukanUlangVerifikasi = createAjukanUlangHandler('rws', 'rw', 'RW', (item) => `RW ${item.nomor}`);
}

module.exports = new RWController();
