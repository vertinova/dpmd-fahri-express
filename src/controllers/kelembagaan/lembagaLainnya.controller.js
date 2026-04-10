/**
 * Lembaga Lainnya Controller
 * Controller for custom/additional kelembagaan that desa can create
 * Multi-instance (desa can have many lembaga lainnya)
 */

const { v4: uuidv4 } = require('uuid');
const {
  prisma,
  ACTIVITY_TYPES,
  ENTITY_TYPES,
  logKelembagaanActivity,
  validateDesaAccess,
  getDesaId,
  toUpper,
  createAjukanUlangHandler
} = require('./base.controller');

const TYPE = 'lembaga-lainnya';
const TABLE = 'lembaga_lainnyas';
const DISPLAY = 'Lembaga Lainnya';

class LembagaLainnyaController {
  /**
   * List for desa user
   */
  async listDesa(req, res) {
    try {
      const desaId = validateDesaAccess(req, res);
      if (!desaId) return;

      const items = await prisma[TABLE].findMany({
        where: { desa_id: desaId },
        include: {
          desas: {
            select: { id: true, nama: true, kecamatans: { select: { id: true, nama: true } } }
          }
        },
        orderBy: [{ nama: 'asc' }]
      });

      // Get ketua for each lembaga
      const enrichedData = await Promise.all(
        items.map(async (item) => {
          const ketua = await prisma.pengurus.findFirst({
            where: {
              pengurusable_type: 'lembaga-lainnya',
              pengurusable_id: item.id,
              status_jabatan: 'aktif',
              jabatan: { in: ['Ketua', 'ketua', 'KETUA'] }
            },
            select: { nama_lengkap: true }
          });

          return {
            id: item.id,
            nama: item.nama,
            alamat: item.alamat,
            status_kelembagaan: item.status_kelembagaan,
            status_verifikasi: item.status_verifikasi,
            produk_hukum_id: item.produk_hukum_id,
            desa_id: item.desa_id,
            desa: item.desas,
            ketua_nama: ketua?.nama_lengkap || null,
            created_at: item.created_at,
            updated_at: item.updated_at
          };
        })
      );

      res.json({ success: true, data: enrichedData });
    } catch (error) {
      console.error('Error in listDesa LembagaLainnya:', error);
      res.status(500).json({ success: false, message: 'Gagal mengambil data Lembaga Lainnya', error: error.message });
    }
  }

  /**
   * Show single item for desa user
   */
  async showDesa(req, res) {
    try {
      const desaId = validateDesaAccess(req, res);
      if (!desaId) return;

      const item = await prisma[TABLE].findFirst({
        where: { id: String(req.params.id), desa_id: desaId },
        include: {
          desas: {
            select: { id: true, nama: true, kecamatans: { select: { id: true, nama: true } } }
          }
        }
      });

      if (!item) {
        return res.status(404).json({ success: false, message: 'Lembaga tidak ditemukan' });
      }

      res.json({ success: true, data: item });
    } catch (error) {
      console.error('Error in showDesa LembagaLainnya:', error);
      res.status(500).json({ success: false, message: 'Gagal mengambil data lembaga', error: error.message });
    }
  }

  /**
   * Create new lembaga lainnya
   */
  async create(req, res) {
    try {
      const user = req.user;
      const desaId = validateDesaAccess(req, res);
      if (!desaId) return;

      const { nama, alamat, produk_hukum_id } = req.body;

      if (!nama || !nama.trim()) {
        return res.status(400).json({ success: false, message: 'Nama lembaga wajib diisi' });
      }

      if (!produk_hukum_id) {
        return res.status(400).json({ success: false, message: 'Produk hukum wajib dipilih untuk membuat lembaga' });
      }

      const data = {
        id: uuidv4(),
        nama: toUpper(String(nama).trim()),
        desa_id: desaId,
        alamat: toUpper(alamat) || '',
        produk_hukum_id: produk_hukum_id || null,
        status_kelembagaan: 'aktif',
        status_verifikasi: 'unverified'
      };

      const newItem = await prisma[TABLE].create({ data });

      // Log activity
      try {
        await logKelembagaanActivity({
          kelembagaanType: TYPE,
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
      } catch (logError) {
        console.error('Error logging LembagaLainnya creation:', logError);
      }

      res.json({ success: true, data: newItem });
    } catch (error) {
      console.error('Error in create LembagaLainnya:', error);
      res.status(500).json({ success: false, message: 'Gagal membuat lembaga', error: error.message });
    }
  }

  /**
   * Update lembaga lainnya
   */
  async update(req, res) {
    try {
      const user = req.user;
      const desaId = validateDesaAccess(req, res);
      if (!desaId) return;

      const item = await prisma[TABLE].findFirst({
        where: { id: String(req.params.id), desa_id: desaId }
      });

      if (!item) {
        return res.status(404).json({ success: false, message: 'Lembaga tidak ditemukan' });
      }

      const { nama, alamat, produk_hukum_id } = req.body;

      const updateData = {
        nama: toUpper(nama) || item.nama,
        alamat: alamat !== undefined ? toUpper(alamat) : item.alamat,
        produk_hukum_id: produk_hukum_id !== undefined ? (produk_hukum_id || null) : item.produk_hukum_id
      };

      const updated = await prisma[TABLE].update({
        where: { id: String(req.params.id) },
        data: updateData
      });

      // Log activity
      await logKelembagaanActivity({
        kelembagaanType: TYPE,
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
      console.error('Error in update LembagaLainnya:', error);
      res.status(500).json({ success: false, message: 'Gagal mengubah lembaga', error: error.message });
    }
  }

  /**
   * Toggle status (aktif/nonaktif)
   */
  async toggleStatus(req, res) {
    try {
      const user = req.user;

      const item = await prisma[TABLE].findUnique({
        where: { id: String(req.params.id) }
      });

      if (!item) {
        return res.status(404).json({ success: false, message: 'Lembaga tidak ditemukan' });
      }

      if (user.role === 'desa' && Number(user.desa_id) !== Number(item.desa_id)) {
        return res.status(403).json({ success: false, message: 'User tidak memiliki akses' });
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

      const updated = await prisma[TABLE].update({
        where: { id: String(req.params.id) },
        data: updateData
      });

      await logKelembagaanActivity({
        kelembagaanType: TYPE,
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
      console.error('Error in toggleStatus LembagaLainnya:', error);
      res.status(500).json({ success: false, message: 'Gagal toggle status', error: error.message });
    }
  }

  /**
   * Toggle verification (verified/unverified)
   */
  async toggleVerification(req, res) {
    try {
      const user = req.user;

      const item = await prisma[TABLE].findUnique({
        where: { id: String(req.params.id) }
      });

      if (!item) {
        return res.status(404).json({ success: false, message: 'Lembaga tidak ditemukan' });
      }

      if (user.role === 'desa' && Number(user.desa_id) !== Number(item.desa_id)) {
        return res.status(403).json({ success: false, message: 'User tidak memiliki akses' });
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

      if (status_verifikasi === 'ditolak' && catatan_verifikasi) {
        updateData.catatan_verifikasi = catatan_verifikasi;
      } else if (status_verifikasi === 'verified') {
        updateData.catatan_verifikasi = null;
      }

      const updated = await prisma[TABLE].update({
        where: { id: String(req.params.id) },
        data: updateData
      });

      await logKelembagaanActivity({
        kelembagaanType: TYPE,
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
      console.error('Error in toggleVerification LembagaLainnya:', error);
      res.status(500).json({ success: false, message: 'Gagal toggle verifikasi', error: error.message });
    }
  }

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

      const items = await prisma[TABLE].findMany({
        where,
        include: {
          desas: {
            select: { id: true, nama: true, kecamatans: { select: { id: true, nama: true } } }
          }
        },
        orderBy: [{ desa_id: 'asc' }, { nama: 'asc' }]
      });

      res.json({ success: true, data: items });
    } catch (error) {
      console.error('Error in list LembagaLainnya:', error);
      res.status(500).json({ success: false, message: 'Gagal mengambil data', error: error.message });
    }
  }

  /**
   * Show (for admin/public)
   */
  async show(req, res) {
    try {
      const item = await prisma[TABLE].findUnique({
        where: { id: String(req.params.id) },
        include: {
          desas: {
            select: { id: true, nama: true, kecamatans: { select: { id: true, nama: true } } }
          }
        }
      });

      if (!item) {
        return res.status(404).json({ success: false, message: 'Lembaga tidak ditemukan' });
      }

      res.json({ success: true, data: item });
    } catch (error) {
      console.error('Error in show LembagaLainnya:', error);
      res.status(500).json({ success: false, message: 'Gagal mengambil data', error: error.message });
    }
  }

  // Ajukan ulang verifikasi (desa resubmit after ditolak)
  ajukanUlangVerifikasi = createAjukanUlangHandler('lembaga_lainnyas', 'lembaga-lainnya', 'Lembaga', (item) => item.nama);
}

module.exports = new LembagaLainnyaController();
