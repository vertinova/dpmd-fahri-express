/**
 * Pengurus Controller
 * Handles pengurus (kelembagaan management/board members) operations
 * This is polymorphic - can be attached to any kelembagaan type
 */

const { prisma, ACTIVITY_TYPES, ENTITY_TYPES, logKelembagaanActivity, validateDesaAccess, toUpper } = require('./base.controller');
const { v4: uuidv4 } = require('uuid');

/**
 * Helper function to get kelembagaan display name
 * Menyesuaikan dengan format yang digunakan di kelembagaan controllers
 */
async function getKelembagaanDisplayName(type, id) {
  try {
    let record = null;
    
    // Query based on type using Prisma client
    switch (type) {
      case 'rw':
        record = await prisma.rws.findUnique({
          where: { id: String(id) },
          select: { nomor: true }
        });
        return record ? `RW ${record.nomor}` : null;
        
      case 'rt':
        record = await prisma.rts.findUnique({
          where: { id: String(id) },
          select: { nomor: true }
        });
        return record ? `RT ${record.nomor}` : null;
        
      case 'posyandu':
        record = await prisma.posyandus.findUnique({
          where: { id: String(id) },
          select: { nama: true }
        });
        return record ? record.nama : null;
        
      case 'karang_taruna':
        record = await prisma.karang_tarunas.findUnique({
          where: { id: String(id) },
          select: { nama: true }
        });
        return record ? record.nama : null;
        
      case 'lpm':
        record = await prisma.lpms.findUnique({
          where: { id: String(id) },
          select: { nama: true }
        });
        return record ? record.nama : null;
        
      case 'pkk':
        record = await prisma.pkks.findUnique({
          where: { id: String(id) },
          select: { nama: true }
        });
        return record ? record.nama : null;
        
      case 'satlinmas':
        record = await prisma.satlinmases.findUnique({
          where: { id: String(id) },
          select: { nama: true }
        });
        return record ? record.nama : null;
        
      case 'lembaga-lainnya':
        record = await prisma.lembaga_lainnyas.findUnique({
          where: { id: String(id) },
          select: { nama: true }
        });
        return record ? record.nama : null;
        
      default:
        return null;
    }
  } catch (error) {
    console.error('Error getting kelembagaan display name:', error);
    console.error('Type:', type, 'ID:', id);
    return null;
  }
}

function mapJenisKelaminToEnum(jenisKelamin) {
  const normalizedJenisKelamin = toUpper(jenisKelamin);

  if (normalizedJenisKelamin === 'LAKI-LAKI' || normalizedJenisKelamin === 'LAKI_LAKI') {
    return 'Laki_laki';
  }

  if (normalizedJenisKelamin === 'PEREMPUAN') {
    return 'Perempuan';
  }

  return null;
}

class PengurusController {
  /**
   * List pengurus for desa user
   * GET /api/desa/pengurus
   */
  async listDesaPengurus(req, res) {
    try {
      const desaId = validateDesaAccess(req, res);
      if (!desaId) return;

      const { pengurusable_type, pengurusable_id } = req.query;
      const where = { desa_id: desaId };

      if (pengurusable_type) where.pengurusable_type = pengurusable_type;
      if (pengurusable_id) where.pengurusable_id = pengurusable_id;

      const pengurus = await prisma.pengurus.findMany({
        where,
        orderBy: [
          { jabatan: 'asc' },
          { created_at: 'desc' }
        ]
      });

      res.json({ success: true, data: pengurus });
    } catch (error) {
      console.error('Error in listDesaPengurus:', error);
      res.status(500).json({ success: false, message: 'Gagal mengambil data pengurus', error: error.message });
    }
  }

  /**
   * Show single pengurus for desa user
   * GET /api/desa/pengurus/:id
   */
  async showDesaPengurus(req, res) {
    try {
      const desaId = validateDesaAccess(req, res);
      if (!desaId) return;

      const pengurus = await prisma.pengurus.findFirst({
        where: {
          id: String(req.params.id),
          desa_id: desaId
        }
      });

      if (!pengurus) {
        return res.status(404).json({ success: false, message: 'Pengurus tidak ditemukan' });
      }

      res.json({ success: true, data: pengurus });
    } catch (error) {
      console.error('Error in showDesaPengurus:', error);
      res.status(500).json({ success: false, message: 'Gagal mengambil data pengurus', error: error.message });
    }
  }

  /**
   * Create pengurus
   * POST /api/desa/pengurus
   */
  async createPengurus(req, res) {
    try {
      const user = req.user;
      const desaId = validateDesaAccess(req, res);
      if (!desaId) return;

      const { 
        pengurusable_type, 
        pengurusable_id, 
        nama_lengkap, 
        jabatan, 
        no_telepon, 
        alamat,
        nik,
        tempat_lahir,
        tanggal_lahir,
        jenis_kelamin,
        status_perkawinan,
        pendidikan,
        agama,
        golongan_darah,
        nomor_buku_nikah,
        tanggal_mulai_jabatan,
        tanggal_akhir_jabatan,
        status_jabatan,
        produk_hukum_id,
        nama_bank,
        nomor_rekening,
        nama_rekening
      } = req.body;

      if (!pengurusable_type || !pengurusable_id || !nama_lengkap || !jabatan) {
        return res.status(400).json({ 
          success: false, 
          message: 'Kelembagaan type, ID, nama_lengkap, dan jabatan wajib diisi' 
        });
      }

      if (!produk_hukum_id) {
        return res.status(400).json({ 
          success: false, 
          message: 'Produk hukum (SK) wajib dipilih untuk menambah pengurus' 
        });
      }

      // Validate nomor_buku_nikah for Ketua RT/RW who are married
      const jabatanUpper = jabatan?.toUpperCase();
      const statusPerkawinanUpper = status_perkawinan?.toUpperCase();
      if (
        (jabatanUpper === 'KETUA RT' || jabatanUpper === 'KETUA RW') &&
        statusPerkawinanUpper === 'MENIKAH' &&
        !nomor_buku_nikah?.trim()
      ) {
        return res.status(400).json({
          success: false,
          message: 'Nomor buku nikah wajib diisi untuk Ketua RT/RW yang berstatus menikah'
        });
      }

      // Handle avatar upload if exists
      const avatarPath = req.file ? `uploads/pengurus_files/${req.file.filename}` : null;

      const jenisKelaminEnum = mapJenisKelaminToEnum(jenis_kelamin);

      const pengurus = await prisma.pengurus.create({
        data: {
          id: uuidv4(),
          pengurusable_type,
          pengurusable_id,
          nama_lengkap: toUpper(nama_lengkap),
          jabatan: toUpper(jabatan),
          no_telepon: no_telepon || null,
          alamat: toUpper(alamat) || null,
          nik: nik || null,
          tempat_lahir: toUpper(tempat_lahir) || null,
          tanggal_lahir: tanggal_lahir ? new Date(tanggal_lahir) : null,
          jenis_kelamin: jenisKelaminEnum,
          status_perkawinan: toUpper(status_perkawinan) || null,
          pendidikan: toUpper(pendidikan) || null,
          agama: toUpper(agama) || null,
          golongan_darah: toUpper(golongan_darah) || null,
          nomor_buku_nikah: toUpper(nomor_buku_nikah) || null,
          tanggal_mulai_jabatan: tanggal_mulai_jabatan ? new Date(tanggal_mulai_jabatan) : null,
          tanggal_akhir_jabatan: tanggal_akhir_jabatan ? new Date(tanggal_akhir_jabatan) : null,
          status_jabatan: status_jabatan || 'aktif',
          status_verifikasi: 'unverified',
          produk_hukum_id: produk_hukum_id || null,
          nama_bank: nama_bank || null,
          nomor_rekening: nomor_rekening || null,
          nama_rekening: nama_rekening || null,
          avatar: avatarPath,
          desa_id: desaId
        }
      });

      // Get kelembagaan display name for logging
      const kelembagaanDisplayName = await getKelembagaanDisplayName(pengurusable_type, pengurusable_id);

      // Log activity
      await logKelembagaanActivity({
        kelembagaanType: pengurusable_type,
        kelembagaanId: pengurusable_id,
        kelembagaanNama: kelembagaanDisplayName || `${pengurusable_type.toUpperCase()}`,
        desaId: desaId,
        activityType: ACTIVITY_TYPES.CREATE,
        entityType: ENTITY_TYPES.PENGURUS,
        entityId: pengurus.id,
        entityName: `${pengurus.nama_lengkap} (${pengurus.jabatan})`,
        oldValue: null,
        newValue: { nama_lengkap: pengurus.nama_lengkap, jabatan: pengurus.jabatan, status_jabatan: 'aktif' },
        userId: user.id,
        userName: user.name,
        userRole: user.role,
        bidangId: user.bidang_id,
        ipAddress: req.ip,
        userAgent: req.get('user-agent')
      });

      res.json({ success: true, data: pengurus });
    } catch (error) {
      console.error('Error in createPengurus:', error);
      res.status(500).json({ success: false, message: 'Gagal membuat pengurus', error: error.message });
    }
  }

  /**
   * Update pengurus
   * PUT /api/desa/pengurus/:id
   */
  async updatePengurus(req, res) {
    try {
      const user = req.user;
      const desaId = validateDesaAccess(req, res);
      if (!desaId) return;

      const existing = await prisma.pengurus.findFirst({
        where: {
          id: String(req.params.id),
          desa_id: desaId
        }
      });

      if (!existing) {
        return res.status(404).json({ success: false, message: 'Pengurus tidak ditemukan' });
      }

      const { 
        nama_lengkap, 
        jabatan, 
        no_telepon, 
        alamat,
        nik,
        tempat_lahir,
        tanggal_lahir,
        jenis_kelamin,
        status_perkawinan,
        pendidikan,
        agama,
        golongan_darah,
        nomor_buku_nikah,
        tanggal_mulai_jabatan,
        tanggal_akhir_jabatan,
        status_jabatan,
        produk_hukum_id,
        nama_bank,
        nomor_rekening,
        nama_rekening
      } = req.body;

      // Validate nomor_buku_nikah for Ketua RT/RW who are married
      // Use incoming values or fall back to existing record
      const effectiveJabatan = (jabatan || existing.jabatan || '').toUpperCase();
      const effectiveStatus = (status_perkawinan || existing.status_perkawinan || '').toUpperCase();
      const effectiveNomorBukuNikah = nomor_buku_nikah !== undefined ? nomor_buku_nikah : existing.nomor_buku_nikah;
      if (
        (effectiveJabatan === 'KETUA RT' || effectiveJabatan === 'KETUA RW') &&
        effectiveStatus === 'MENIKAH' &&
        !effectiveNomorBukuNikah?.trim()
      ) {
        return res.status(400).json({
          success: false,
          message: 'Nomor buku nikah wajib diisi untuk Ketua RT/RW yang berstatus menikah'
        });
      }

      // Handle avatar upload if exists
      const avatarPath = req.file ? `uploads/pengurus_files/${req.file.filename}` : undefined;

      let jenisKelaminEnum = undefined;
      if (jenis_kelamin !== undefined) {
        jenisKelaminEnum = mapJenisKelaminToEnum(jenis_kelamin);
      }

      // Build update data object - only include fields that are provided
      const updateData = {};
      if (nama_lengkap !== undefined) updateData.nama_lengkap = toUpper(nama_lengkap);
      if (jabatan !== undefined) updateData.jabatan = toUpper(jabatan);
      if (no_telepon !== undefined) updateData.no_telepon = no_telepon || null;
      if (alamat !== undefined) updateData.alamat = toUpper(alamat) || null;
      if (nik !== undefined) updateData.nik = nik || null;
      if (tempat_lahir !== undefined) updateData.tempat_lahir = toUpper(tempat_lahir) || null;
      if (tanggal_lahir !== undefined) updateData.tanggal_lahir = tanggal_lahir ? new Date(tanggal_lahir) : null;
      if (jenisKelaminEnum !== undefined) updateData.jenis_kelamin = jenisKelaminEnum;
      if (status_perkawinan !== undefined) updateData.status_perkawinan = toUpper(status_perkawinan) || null;
      if (pendidikan !== undefined) updateData.pendidikan = toUpper(pendidikan) || null;
      if (agama !== undefined) updateData.agama = toUpper(agama) || null;
      if (golongan_darah !== undefined) updateData.golongan_darah = toUpper(golongan_darah) || null;
      if (nomor_buku_nikah !== undefined) updateData.nomor_buku_nikah = toUpper(nomor_buku_nikah) || null;
      if (tanggal_mulai_jabatan !== undefined) updateData.tanggal_mulai_jabatan = tanggal_mulai_jabatan ? new Date(tanggal_mulai_jabatan) : null;
      if (tanggal_akhir_jabatan !== undefined) updateData.tanggal_akhir_jabatan = tanggal_akhir_jabatan ? new Date(tanggal_akhir_jabatan) : null;
      if (status_jabatan !== undefined) updateData.status_jabatan = status_jabatan;
      if (produk_hukum_id !== undefined) updateData.produk_hukum_id = produk_hukum_id || null;
      if (nama_bank !== undefined) updateData.nama_bank = nama_bank || null;
      if (nomor_rekening !== undefined) updateData.nomor_rekening = nomor_rekening || null;
      if (nama_rekening !== undefined) updateData.nama_rekening = nama_rekening || null;
      if (avatarPath !== undefined) updateData.avatar = avatarPath;

      const updated = await prisma.pengurus.update({
        where: { id: String(req.params.id) },
        data: updateData
      });

      // Get kelembagaan display name for logging
      const kelembagaanDisplayName = await getKelembagaanDisplayName(updated.pengurusable_type, updated.pengurusable_id);

      // Log activity
      await logKelembagaanActivity({
        kelembagaanType: updated.pengurusable_type,
        kelembagaanId: updated.pengurusable_id,
        kelembagaanNama: kelembagaanDisplayName || `${updated.pengurusable_type.toUpperCase()}`,
        desaId: updated.desa_id,
        activityType: ACTIVITY_TYPES.UPDATE,
        entityType: ENTITY_TYPES.PENGURUS,
        entityId: updated.id,
        entityName: `${updated.nama_lengkap} (${updated.jabatan})`,
        oldValue: { nama_lengkap: existing.nama_lengkap, jabatan: existing.jabatan },
        newValue: { nama_lengkap: updated.nama_lengkap, jabatan: updated.jabatan },
        userId: user.id,
        userName: user.name,
        userRole: user.role,
        bidangId: user.bidang_id,
        ipAddress: req.ip,
        userAgent: req.get('user-agent')
      });

      res.json({ success: true, data: updated });
    } catch (error) {
      console.error('Error in updatePengurus:', error);
      res.status(500).json({ success: false, message: 'Gagal mengubah pengurus', error: error.message });
    }
  }

  /**
   * Delete pengurus
   * DELETE /api/desa/pengurus/:id
   */
  async deletePengurus(req, res) {
    try {
      const user = req.user;
      const desaId = validateDesaAccess(req, res);
      if (!desaId) return;

      const existing = await prisma.pengurus.findFirst({
        where: {
          id: String(req.params.id),
          desa_id: desaId
        }
      });

      if (!existing) {
        return res.status(404).json({ success: false, message: 'Pengurus tidak ditemukan' });
      }

      await prisma.pengurus.delete({
        where: { id: String(req.params.id) }
      });

      // Get kelembagaan display name for logging
      const kelembagaanDisplayName = await getKelembagaanDisplayName(existing.pengurusable_type, existing.pengurusable_id);

      // Log activity
      await logKelembagaanActivity({
        kelembagaanType: existing.pengurusable_type,
        kelembagaanId: existing.pengurusable_id,
        kelembagaanNama: kelembagaanDisplayName || `${existing.pengurusable_type.toUpperCase()}`,
        desaId: existing.desa_id,
        activityType: 'delete',
        entityType: ENTITY_TYPES.PENGURUS,
        entityId: existing.id,
        entityName: `${existing.nama} (${existing.jabatan})`,
        oldValue: { nama: existing.nama, jabatan: existing.jabatan, status: existing.status },
        newValue: null,
        userId: user.id,
        userName: user.name,
        userRole: user.role,
        bidangId: user.bidang_id,
        ipAddress: req.ip,
        userAgent: req.get('user-agent')
      });

      res.json({ success: true, message: 'Pengurus berhasil dihapus' });
    } catch (error) {
      console.error('Error in deletePengurus:', error);
      res.status(500).json({ success: false, message: 'Gagal menghapus pengurus', error: error.message });
    }
  }

  /**
   * Update pengurus status
   * PUT /api/desa/pengurus/:id/status
   */
  async updatePengurusStatus(req, res) {
    try {
      const user = req.user;
      const desaId = validateDesaAccess(req, res);
      if (!desaId) return;

      const existing = await prisma.pengurus.findFirst({
        where: {
          id: String(req.params.id),
          desa_id: desaId
        }
      });

      if (!existing) {
        return res.status(404).json({ success: false, message: 'Pengurus tidak ditemukan' });
      }

      const { status_jabatan, tanggal_akhir_jabatan } = req.body;
      if (!status_jabatan) {
        return res.status(400).json({ success: false, message: 'Status wajib diisi' });
      }

      const updateData = { status_jabatan };
      if (tanggal_akhir_jabatan) {
        updateData.tanggal_akhir_jabatan = new Date(tanggal_akhir_jabatan);
      }

      const updated = await prisma.pengurus.update({
        where: { id: String(req.params.id) },
        data: updateData
      });

      // Get kelembagaan display name for logging
      const kelembagaanDisplayName = await getKelembagaanDisplayName(updated.pengurusable_type, updated.pengurusable_id);

      // Log activity
      await logKelembagaanActivity({
        kelembagaanType: updated.pengurusable_type,
        kelembagaanId: updated.pengurusable_id,
        kelembagaanNama: kelembagaanDisplayName || `${updated.pengurusable_type.toUpperCase()}`,
        desaId: updated.desa_id,
        activityType: 'update_status',
        entityType: ENTITY_TYPES.PENGURUS,
        entityId: updated.id,
        entityName: `${updated.nama_lengkap} (${updated.jabatan})`,
        oldValue: { status_jabatan: existing.status_jabatan },
        newValue: { status_jabatan: updated.status_jabatan },
        userId: user.id,
        userName: user.name,
        userRole: user.role,
        bidangId: user.bidang_id,
        ipAddress: req.ip,
        userAgent: req.get('user-agent')
      });

      res.json({ success: true, data: updated });
    } catch (error) {
      console.error('Error in updatePengurusStatus:', error);
      res.status(500).json({ success: false, message: 'Gagal mengubah status pengurus', error: error.message });
    }
  }

  /**
   * Get pengurus by kelembagaan (for admin)
   * GET /api/kelembagaan/pengurus
   */
  async getPengurusByKelembagaan(req, res) {
    try {
      const { pengurusable_type, pengurusable_id, desa_id } = req.query;
      
      // Validate required parameters to prevent returning all pengurus
      if (!pengurusable_type || !pengurusable_id) {
        return res.json({ success: true, data: [] });
      }
      
      const where = {
        status_jabatan: 'aktif',
        pengurusable_type: pengurusable_type,
        pengurusable_id: pengurusable_id
      };

      if (desa_id) where.desa_id = BigInt(desa_id);

      const pengurus = await prisma.pengurus.findMany({
        where,
        orderBy: [
          { jabatan: 'asc' },
          { created_at: 'desc' }
        ]
      });

      res.json({ success: true, data: pengurus });
    } catch (error) {
      console.error('Error in getPengurusByKelembagaan:', error);
      res.status(500).json({ success: false, message: 'Gagal mengambil data pengurus', error: error.message });
    }
  }

  /**
   * Get pengurus history (for admin)
   * GET /api/kelembagaan/pengurus/history
   */
  async getPengurusHistory(req, res) {
    try {
      const { pengurusable_type, pengurusable_id } = req.query;
      
      // Validate required parameters
      if (!pengurusable_type || !pengurusable_id) {
        return res.json({ success: true, data: [] });
      }
      
      const where = {
        status_jabatan: 'selesai',
        pengurusable_type: pengurusable_type,
        pengurusable_id: pengurusable_id
      };

      const pengurus = await prisma.pengurus.findMany({
        where,
        orderBy: { created_at: 'desc' }
      });

      res.json({ success: true, data: pengurus });
    } catch (error) {
      console.error('Error in getPengurusHistory:', error);
      res.status(500).json({ success: false, message: 'Gagal mengambil riwayat pengurus', error: error.message });
    }
  }

  /**
   * Show pengurus (for admin)
   * GET /api/kelembagaan/pengurus/:id
   */
  async showPengurus(req, res) {
    try {
      const pengurus = await prisma.pengurus.findUnique({
        where: { id: String(req.params.id) }
      });

      if (!pengurus) {
        return res.status(404).json({ success: false, message: 'Pengurus tidak ditemukan' });
      }

      res.json({ success: true, data: pengurus });
    } catch (error) {
      console.error('Error in showPengurus:', error);
      res.status(500).json({ success: false, message: 'Gagal mengambil data pengurus', error: error.message });
    }
  }

  /**
   * Update pengurus verification status (for admin only)
   * PUT /api/admin/pengurus/:id/verifikasi
   */
  async updateVerifikasi(req, res) {
    try {
      const user = req.user;
      
      // Validate admin access (only admin bidang PMD or superadmin)
      const isAdmin = user.role === 'superadmin' || 
                     (user.role === 'kepala_bidang' && user.bidang_id === 5) || 
                     (user.role === 'pegawai' && user.bidang_id === 5);
      
      if (!isAdmin) {
        return res.status(403).json({ 
          success: false, 
          message: 'Hanya admin bidang Pemberdayaan Masyarakat yang dapat mengubah status verifikasi' 
        });
      }

      const { status_verifikasi, catatan_verifikasi } = req.body;
      
      if (!status_verifikasi || !['verified', 'unverified', 'ditolak'].includes(status_verifikasi)) {
        return res.status(400).json({ 
          success: false, 
          message: 'Status verifikasi harus "verified", "unverified", atau "ditolak"' 
        });
      }

      const existing = await prisma.pengurus.findUnique({
        where: { id: String(req.params.id) }
      });

      if (!existing) {
        return res.status(404).json({ success: false, message: 'Pengurus tidak ditemukan' });
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

      const updated = await prisma.pengurus.update({
        where: { id: String(req.params.id) },
        data: updateData
      });

      // Get kelembagaan display name for logging
      const kelembagaanDisplayName = await getKelembagaanDisplayName(updated.pengurusable_type, updated.pengurusable_id);

      // Log activity
      await logKelembagaanActivity({
        kelembagaanType: updated.pengurusable_type,
        kelembagaanId: updated.pengurusable_id,
        kelembagaanNama: kelembagaanDisplayName || `${updated.pengurusable_type.toUpperCase()}`,
        desaId: updated.desa_id,
        activityType: ACTIVITY_TYPES.VERIFY_PENGURUS,
        entityType: ENTITY_TYPES.PENGURUS,
        entityId: updated.id,
        entityName: `${updated.nama_lengkap} (${updated.jabatan})`,
        oldValue: { status_verifikasi: existing.status_verifikasi },
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
      console.error('Error in updateVerifikasi:', error);
      res.status(500).json({ success: false, message: 'Gagal mengubah status verifikasi', error: error.message });
    }
  }

  /**
   * Ajukan ulang verifikasi pengurus (for desa - reset ditolak to unverified)
   * PUT /api/desa/pengurus/:id/ajukan-ulang
   */
  async ajukanUlangVerifikasi(req, res) {
    try {
      const user = req.user;

      const existing = await prisma.pengurus.findUnique({
        where: { id: String(req.params.id) }
      });

      if (!existing) {
        return res.status(404).json({ success: false, message: 'Pengurus tidak ditemukan' });
      }

      // Validate desa ownership
      if (user.role === 'desa' && Number(user.desa_id) !== Number(existing.desa_id)) {
        return res.status(403).json({ success: false, message: 'User tidak memiliki akses' });
      }

      // Only allow resubmit from ditolak status
      if (existing.status_verifikasi !== 'ditolak') {
        return res.status(400).json({ 
          success: false, 
          message: 'Hanya pengurus dengan status "ditolak" yang dapat diajukan ulang' 
        });
      }

      const updated = await prisma.pengurus.update({
        where: { id: String(req.params.id) },
        data: {
          status_verifikasi: 'unverified',
          catatan_verifikasi: null,
          verifikator_nama: null,
          verified_at: null,
        }
      });

      // Get kelembagaan display name for logging
      const kelembagaanDisplayName = await getKelembagaanDisplayName(updated.pengurusable_type, updated.pengurusable_id);

      await logKelembagaanActivity({
        kelembagaanType: updated.pengurusable_type,
        kelembagaanId: updated.pengurusable_id,
        kelembagaanNama: kelembagaanDisplayName || `${updated.pengurusable_type.toUpperCase()}`,
        desaId: updated.desa_id,
        activityType: ACTIVITY_TYPES.RESUBMIT_PENGURUS,
        entityType: ENTITY_TYPES.PENGURUS,
        entityId: updated.id,
        entityName: `${updated.nama_lengkap} (${updated.jabatan})`,
        oldValue: { status_verifikasi: existing.status_verifikasi },
        newValue: { status_verifikasi: 'unverified' },
        userId: user.id,
        userName: user.name,
        userRole: user.role,
        bidangId: user.bidang_id,
        ipAddress: req.ip,
        userAgent: req.get('user-agent')
      });

      res.json({ success: true, data: updated, message: 'Berhasil mengajukan ulang verifikasi pengurus' });
    } catch (error) {
      console.error('Error in ajukanUlangVerifikasi:', error);
      res.status(500).json({ success: false, message: 'Gagal mengajukan ulang verifikasi', error: error.message });
    }
  }
}

module.exports = new PengurusController();
