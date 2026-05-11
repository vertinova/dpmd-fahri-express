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

      let produk_hukum = null;
      if (pengurus.produk_hukum_id) {
        produk_hukum = await prisma.produk_hukums.findUnique({
          where: { id: pengurus.produk_hukum_id },
          select: { id: true, nomor: true, tahun: true, judul: true, jenis: true }
        });
      }

      res.json({ success: true, data: { ...pengurus, produk_hukum } });
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

      if (user.role !== 'superadmin') {
        return res.status(403).json({ success: false, message: 'Hanya superadmin yang dapat menghapus pengurus' });
      }

      const existing = await prisma.pengurus.findUnique({
        where: { id: String(req.params.id) }
      });

      if (!existing) {
        return res.status(404).json({ success: false, message: 'Pengurus tidak ditemukan' });
      }

      await prisma.pengurus.delete({
        where: { id: String(req.params.id) }
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

      let produk_hukum = null;
      if (pengurus.produk_hukum_id) {
        produk_hukum = await prisma.produk_hukums.findUnique({
          where: { id: pengurus.produk_hukum_id },
          select: { id: true, nomor: true, tahun: true, judul: true, jenis: true }
        });
      }

      res.json({ success: true, data: { ...pengurus, produk_hukum } });
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

  // -----------------------------------------------------------------------
  // Import from Excel template
  // POST /api/kelembagaan/pengurus/import
  // Accepts multipart/form-data with field "files" (array of .xlsx/.xls)
  // -----------------------------------------------------------------------
  async importPengurus(req, res) {
    const xlsx = require('xlsx');
    const { v4: uuidv4 } = require('uuid');

    const files = req.files;
    if (!files || files.length === 0) {
      return res.status(400).json({ success: false, message: 'Tidak ada file yang diupload' });
    }

    const DATA_SHEETS = ['01_RTRW', '02_POSYANDU', '03_LPM', '04_KARANG_TARUNA', '05_PKK', '06_LINMAS', '07_LEMBAGA_LAINNYA'];

    const allResults = [];

    for (const file of files) {
      const fileResult = {
        filename: file.originalname,
        stats: { inserted: 0, updated: 0, skip_manual: 0, skip_invalid: 0, errors: 0, desa_missing: 0 },
        per_sheet: {},
        errors: [],
      };

      DATA_SHEETS.forEach(s => { fileResult.per_sheet[s] = { inserted: 0, updated: 0, skip: 0 }; });

      try {
        const workbook = xlsx.read(file.buffer, { raw: true, cellDates: false });
        const rows = collectRowsFromWorkbook(workbook, DATA_SHEETS);

        const desaCache = new Map();
        const lembagaCache = new Map();

        for (const row of rows) {
          try {
            const outcome = await processImportRow(prisma, row, desaCache, lembagaCache, uuidv4);
            if (outcome === 'desa_missing') {
              fileResult.stats.desa_missing++;
              fileResult.stats.skip_invalid++;
              fileResult.errors.push({ sheet: row.sheet, row: row.rowIndex, desa: row.kode_desa || '', nama: row.nama_lengkap, reason: `kode_desa '${row.kode_desa}' tidak ditemukan` });
              fileResult.per_sheet[row.sheet].skip++;
            } else if (outcome === 'lembaga_missing') {
              fileResult.stats.skip_invalid++;
              fileResult.errors.push({ sheet: row.sheet, row: row.rowIndex, desa: row.kode_desa || '', nama: row.nama_lengkap, reason: 'Data wilayah/nama lembaga kosong atau tidak valid' });
              fileResult.per_sheet[row.sheet].skip++;
            } else if (outcome === 'skip_manual') {
              fileResult.stats.skip_manual++;
              fileResult.per_sheet[row.sheet].skip++;
            } else if (outcome === 'skip_invalid') {
              fileResult.stats.skip_invalid++;
              fileResult.per_sheet[row.sheet].skip++;
            } else if (outcome === 'inserted') {
              fileResult.stats.inserted++;
              fileResult.per_sheet[row.sheet].inserted++;
            } else if (outcome === 'updated') {
              fileResult.stats.updated++;
              fileResult.per_sheet[row.sheet].updated++;
            }
          } catch (err) {
            fileResult.stats.errors++;
            fileResult.errors.push({ sheet: row.sheet, row: row.rowIndex, desa: row.kode_desa || '', nama: row.nama_lengkap, reason: `ERROR: ${err.message}` });
            fileResult.per_sheet[row.sheet].skip++;
          }
        }
      } catch (parseErr) {
        fileResult.stats.errors++;
        fileResult.errors.push({ sheet: '-', row: 0, desa: '-', nama: '-', reason: `Gagal membaca file: ${parseErr.message}` });
      }

      allResults.push(fileResult);
    }

    res.json({ success: true, data: allResults });
  }

  // -----------------------------------------------------------------------
  // GET /api/kelembagaan/pengurus/import/stats
  // Aggregated count per kecamatan/desa/lembaga (all imported & manual)
  // -----------------------------------------------------------------------
  async getImportStats(req, res) {
    try {
      const rows = await prisma.$queryRaw`
        SELECT
          k.id         AS kecamatan_id,
          k.nama       AS kecamatan_nama,
          d.id         AS desa_id,
          d.nama       AS desa_nama,
          p.pengurusable_type,
          COUNT(*)     AS total,
          SUM(CASE WHEN p.imported = 1 THEN 1 ELSE 0 END) AS imported_count
        FROM pengurus p
        JOIN desas d ON d.id = p.desa_id
        JOIN kecamatans k ON k.id = d.kecamatan_id
        WHERE p.status_jabatan = 'aktif'
        GROUP BY k.id, k.nama, d.id, d.nama, p.pengurusable_type
        ORDER BY k.nama, d.nama
      `;

      // Group into hierarchy: kecamatan → desa → type counts
      const kecamatanMap = new Map();
      for (const r of rows) {
        const kecId = String(r.kecamatan_id);
        if (!kecamatanMap.has(kecId)) {
          kecamatanMap.set(kecId, { id: kecId, nama: r.kecamatan_nama, desas: new Map() });
        }
        const kec = kecamatanMap.get(kecId);
        const desaId = String(r.desa_id);
        if (!kec.desas.has(desaId)) {
          kec.desas.set(desaId, { id: desaId, nama: r.desa_nama, counts: {}, imported_counts: {}, total: 0, imported_total: 0 });
        }
        const desa = kec.desas.get(desaId);
        const type = r.pengurusable_type;
        const count = Number(r.total);
        const importedCount = Number(r.imported_count);
        desa.counts[type] = (desa.counts[type] || 0) + count;
        desa.imported_counts[type] = (desa.imported_counts[type] || 0) + importedCount;
        desa.total += count;
        desa.imported_total += importedCount;
      }

      const result = Array.from(kecamatanMap.values()).map(kec => ({
        id: kec.id,
        nama: kec.nama,
        desas: Array.from(kec.desas.values()).map(d => ({
          ...d,
          desas: undefined,
        })),
      }));

      res.json({ success: true, data: result });
    } catch (error) {
      console.error('Error in getImportStats:', error);
      res.status(500).json({ success: false, message: 'Gagal mengambil statistik import', error: error.message });
    }
  }

  // -----------------------------------------------------------------------
  // GET /api/kelembagaan/pengurus/import/desa/:desaId
  // List pengurus for a desa (all status_jabatan aktif), with imported flag
  // -----------------------------------------------------------------------
  async getDesaPengurusList(req, res) {
    try {
      const desaId = BigInt(req.params.desaId);
      const pengurus = await prisma.pengurus.findMany({
        where: { desa_id: desaId, status_jabatan: 'aktif' },
        orderBy: [{ pengurusable_type: 'asc' }, { jabatan: 'asc' }],
        select: {
          id: true, nama_lengkap: true, jabatan: true, nik: true,
          pengurusable_type: true, pengurusable_id: true,
          jenis_kelamin: true, imported: true, status_verifikasi: true,
          created_at: true,
        },
      });

      // Collect unique pengurusable_id per type to fetch lembaga details
      const byType = {};
      pengurus.forEach(p => {
        if (!byType[p.pengurusable_type]) byType[p.pengurusable_type] = new Set();
        byType[p.pengurusable_type].add(p.pengurusable_id);
      });

      const lembagaMap = new Map(); // "type:id" → display label

      for (const [type, ids] of Object.entries(byType)) {
        const idArr = Array.from(ids);
        try {
          switch (type) {
            case 'rws': {
              const rows = await prisma.rws.findMany({ where: { id: { in: idArr } }, select: { id: true, nomor: true } });
              rows.forEach(r => lembagaMap.set(`${type}:${r.id}`, `RW ${r.nomor}`));
              break;
            }
            case 'rts': {
              const rows = await prisma.rts.findMany({ where: { id: { in: idArr } }, select: { id: true, nomor: true, rw_id: true } });
              const rwIds = [...new Set(rows.map(r => r.rw_id))];
              const rws = await prisma.rws.findMany({ where: { id: { in: rwIds } }, select: { id: true, nomor: true } });
              const rwMap = new Map(rws.map(r => [r.id, r.nomor]));
              rows.forEach(r => lembagaMap.set(`${type}:${r.id}`, `RT ${r.nomor} / RW ${rwMap.get(r.rw_id) || '?'}`));
              break;
            }
            case 'posyandus': {
              const rows = await prisma.posyandus.findMany({ where: { id: { in: idArr } }, select: { id: true, nama: true } });
              rows.forEach(r => lembagaMap.set(`${type}:${r.id}`, r.nama));
              break;
            }
            case 'lpms': {
              const rows = await prisma.lpms.findMany({ where: { id: { in: idArr } }, select: { id: true, nama: true } });
              rows.forEach(r => lembagaMap.set(`${type}:${r.id}`, r.nama));
              break;
            }
            case 'karang_tarunas': {
              const rows = await prisma.karang_tarunas.findMany({ where: { id: { in: idArr } }, select: { id: true, nama: true } });
              rows.forEach(r => lembagaMap.set(`${type}:${r.id}`, r.nama));
              break;
            }
            case 'pkks': {
              const rows = await prisma.pkks.findMany({ where: { id: { in: idArr } }, select: { id: true, nama: true } });
              rows.forEach(r => lembagaMap.set(`${type}:${r.id}`, r.nama));
              break;
            }
            case 'satlinmas': {
              const rows = await prisma.satlinmas.findMany({ where: { id: { in: idArr } }, select: { id: true, nama: true } });
              rows.forEach(r => lembagaMap.set(`${type}:${r.id}`, r.nama));
              break;
            }
            case 'lembaga-lainnya': {
              const rows = await prisma.lembaga_lainnyas.findMany({ where: { id: { in: idArr } }, select: { id: true, nama: true } });
              rows.forEach(r => lembagaMap.set(`${type}:${r.id}`, r.nama));
              break;
            }
          }
        } catch (_) { /* skip lookup errors — lembaga_nama stays null */ }
      }

      const data = pengurus.map(p => ({
        ...p,
        lembaga_nama: lembagaMap.get(`${p.pengurusable_type}:${p.pengurusable_id}`) || null,
      }));

      res.json({ success: true, data });
    } catch (error) {
      console.error('Error in getDesaPengurusList:', error);
      res.status(500).json({ success: false, message: 'Gagal mengambil data pengurus desa', error: error.message });
    }
  }

  // -----------------------------------------------------------------------
  // DELETE /api/kelembagaan/pengurus/import/desa/:desaId — superadmin only
  // -----------------------------------------------------------------------
  async deleteImportedByDesa(req, res) {
    try {
      const user = req.user;
      if (user.role !== 'superadmin') {
        return res.status(403).json({ success: false, message: 'Hanya superadmin yang dapat menghapus data import' });
      }

      const desaId = BigInt(req.params.desaId);
      const result = await prisma.pengurus.deleteMany({ where: { desa_id: desaId, imported: true } });
      res.json({ success: true, deleted: result.count, message: `${result.count} data pengurus import berhasil dihapus` });
    } catch (error) {
      console.error('Error in deleteImportedByDesa:', error);
      res.status(500).json({ success: false, message: 'Gagal menghapus data import', error: error.message });
    }
  }
}

// =========================================================================
// Helper functions for Excel import
// =========================================================================

function textVal(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  return String(v).trim();
}

function upper(v) { return v ? v.toUpperCase() : v; }

function padNomor(v) {
  const t = textVal(v);
  if (!t) return '';
  const d = t.replace(/\D+/g, '');
  if (!d) return '';
  return d.padStart(3, '0').slice(-3);
}

function parseGenderImport(v) {
  const s = upper(textVal(v));
  if (!s) return null;
  if (s.startsWith('L') || s === 'LAKI-LAKI' || s === 'LAKI LAKI' || s === 'LAKI_LAKI') return 'Laki_laki';
  if (s.startsWith('P') || s === 'PEREMPUAN') return 'Perempuan';
  return null;
}

function parseDateImport(v) {
  if (v === null || v === undefined || v === '') return null;
  if (v instanceof Date && !isNaN(v)) return v;
  if (typeof v === 'number' && Number.isFinite(v)) {
    const epoch = new Date(Date.UTC(1899, 11, 30));
    const d = new Date(epoch.getTime() + Math.round(v * 86400000));
    return isNaN(d) ? null : d;
  }
  const t = String(v).trim();
  if (!t) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) { const d = new Date(`${t}T00:00:00Z`); return isNaN(d) ? null : d; }
  const d = new Date(t);
  return isNaN(d) ? null : d;
}

function lowerEnum(v, allowed) {
  const t = textVal(v).toLowerCase();
  return allowed.includes(t) ? t : null;
}

function buildAlamatImport(row) {
  const parts = [
    textVal(row.alamat_rumah),
    row.rt_rumah ? `RT ${padNomor(row.rt_rumah)}` : null,
    row.rw_rumah ? `RW ${padNomor(row.rw_rumah)}` : null,
    textVal(row.desa_alamat) ? `DESA ${textVal(row.desa_alamat)}` : null,
    textVal(row.kecamatan_alamat) ? `KECAMATAN ${textVal(row.kecamatan_alamat)}` : null,
    textVal(row.kode_pos),
  ].filter(Boolean);
  const joined = parts.join(' ').trim().replace(/\s+/g, ' ');
  return joined ? joined.toUpperCase() : null;
}

function collectRowsFromWorkbook(workbook, dataSheets) {
  const { utils } = require('xlsx');
  const rows = [];
  for (const sheetName of dataSheets) {
    if (!workbook.SheetNames.includes(sheetName)) continue;
    const sheet = workbook.Sheets[sheetName];
    const data = utils.sheet_to_json(sheet, { header: 1, raw: true, defval: null, blankrows: false });
    if (!data.length) continue;
    const headers = data[0].map(h => (h == null ? '' : String(h).trim()));
    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      if (!row || !row.some(c => c !== null && c !== '')) continue;
      const obj = { sheet: sheetName, rowIndex: i + 1 };
      headers.forEach((h, idx) => { if (h) obj[h] = row[idx]; });
      if (!textVal(obj.nama_lengkap)) continue;
      rows.push(obj);
    }
  }
  return rows;
}

async function resolveDesa(prisma, kodeDesa, cache) {
  const kode = textVal(kodeDesa);
  if (!kode) return null;
  if (cache.has(kode)) return cache.get(kode);
  const desa = await prisma.desas.findUnique({ where: { kode }, select: { id: true, nama: true } });
  cache.set(kode, desa || null);
  return desa;
}

async function resolveOrCreateLembaga(prisma, row, desa, cache, uuidv4) {
  const { v4: uuid } = require('uuid');
  const id = uuidv4 || uuid;

  const TABLE_MAP = {
    '02_POSYANDU':        { table: 'posyandus',       type: 'posyandus',         nameField: 'nama_posyandu',  addrField: 'alamat_posyandu',  prefix: null },
    '03_LPM':             { table: 'lpms',             type: 'lpms',              nameField: 'nama_lembaga',   addrField: 'alamat_sekretariat', prefix: 'LPM DESA' },
    '04_KARANG_TARUNA':   { table: 'karang_tarunas',   type: 'karang_tarunas',    nameField: 'nama_lembaga',   addrField: 'alamat_sekretariat', prefix: 'KARANG TARUNA DESA' },
    '05_PKK':             { table: 'pkks',             type: 'pkks',              nameField: 'nama_lembaga',   addrField: 'alamat_sekretariat', prefix: 'PKK DESA' },
    '06_LINMAS':          { table: 'satlinmas',        type: 'satlinmas',         nameField: 'nama_lembaga',   addrField: 'alamat_sekretariat', prefix: 'SATLINMAS DESA' },
    '07_LEMBAGA_LAINNYA': { table: 'lembaga_lainnyas', type: 'lembaga-lainnya',   nameField: 'nama_lembaga',   addrField: 'alamat_sekretariat', prefix: null },
  };

  if (row.sheet === '01_RTRW') {
    return resolveRwOrRt(prisma, row, desa, cache, id);
  }

  const m = TABLE_MAP[row.sheet];
  if (!m) return null;

  let nama = upper(textVal(row[m.nameField]));
  if (!nama && m.prefix) nama = `${m.prefix} ${desa.nama.toUpperCase()}`;
  if (!nama) return null;

  const cacheKey = `${m.table}:${desa.id}:${nama}`;
  if (cache.has(cacheKey)) return cache.get(cacheKey);

  const alamat = upper(textVal(row[m.addrField]));
  const existing = await prisma[m.table].findFirst({ where: { desa_id: desa.id, nama }, select: { id: true, imported: true } });

  let lembagaId;
  if (existing) {
    lembagaId = existing.id;
  } else {
    lembagaId = id();
    await prisma[m.table].create({
      data: { id: lembagaId, desa_id: desa.id, nama, alamat: alamat || null, status_kelembagaan: 'aktif', status_verifikasi: 'unverified', imported: true },
    });
  }

  const result = { id: lembagaId, pengurusableType: m.type };
  cache.set(cacheKey, result);
  return result;
}

async function resolveRwOrRt(prisma, row, desa, cache, uuidFn) {
  const jenis = upper(textVal(row.jenis_wilayah));
  const nomorRw = padNomor(row.nomor_rw);
  const nomorRt = padNomor(row.nomor_rt);
  if (!jenis || !nomorRw) return null;

  const rwCacheKey = `rws:${desa.id}:${nomorRw}`;
  let rw = cache.get(rwCacheKey);
  if (!rw) {
    const existing = await prisma.rws.findFirst({ where: { desa_id: desa.id, nomor: nomorRw }, select: { id: true } });
    if (existing) {
      rw = { id: existing.id };
    } else {
      const newId = uuidFn();
      await prisma.rws.create({ data: { id: newId, desa_id: desa.id, nomor: nomorRw, status_kelembagaan: 'aktif', status_verifikasi: 'unverified', imported: true } });
      rw = { id: newId };
    }
    cache.set(rwCacheKey, rw);
  }

  if (jenis === 'RW') return { id: rw.id, pengurusableType: 'rws' };
  if (jenis !== 'RT' || !nomorRt) return null;

  const rtCacheKey = `rts:${rw.id}:${nomorRt}`;
  let rt = cache.get(rtCacheKey);
  if (!rt) {
    const existing = await prisma.rts.findFirst({ where: { rw_id: rw.id, nomor: nomorRt }, select: { id: true } });
    if (existing) {
      rt = { id: existing.id };
    } else {
      const newId = uuidFn();
      await prisma.rts.create({ data: { id: newId, rw_id: rw.id, desa_id: desa.id, nomor: nomorRt, status_kelembagaan: 'aktif', status_verifikasi: 'unverified', imported: true } });
      rt = { id: newId };
    }
    cache.set(rtCacheKey, rt);
  }
  return { id: rt.id, pengurusableType: 'rts' };
}

async function processImportRow(prisma, row, desaCache, lembagaCache, uuidv4) {
  const desa = await resolveDesa(prisma, row.kode_desa, desaCache);
  if (!desa) return 'desa_missing';

  const lembaga = await resolveOrCreateLembaga(prisma, row, desa, lembagaCache, uuidv4);
  if (!lembaga) return 'lembaga_missing';

  const namaLengkap = upper(textVal(row.nama_lengkap));
  const jabatan = upper(textVal(row.jabatan));
  if (!namaLengkap || !jabatan) return 'skip_invalid';

  const nik = textVal(row.nik) || null;

  let existing = null;
  if (nik) {
    existing = await prisma.pengurus.findFirst({
      where: { pengurusable_type: lembaga.pengurusableType, pengurusable_id: lembaga.id, nik },
      select: { id: true, imported: true },
    });
  }
  if (!existing) {
    existing = await prisma.pengurus.findFirst({
      where: { pengurusable_type: lembaga.pengurusableType, pengurusable_id: lembaga.id, nama_lengkap: namaLengkap, jabatan },
      select: { id: true, imported: true },
    });
  }

  const data = {
    desa_id: desa.id,
    pengurusable_type: lembaga.pengurusableType,
    pengurusable_id: lembaga.id,
    nama_lengkap: namaLengkap,
    jabatan,
    nik,
    tempat_lahir: upper(textVal(row.tempat_lahir)) || null,
    tanggal_lahir: parseDateImport(row.tanggal_lahir),
    jenis_kelamin: parseGenderImport(row.jenis_kelamin),
    status_perkawinan: upper(textVal(row.status_perkawinan)) || null,
    pendidikan: upper(textVal(row.pendidikan)) || null,
    agama: upper(textVal(row.agama)) || null,
    golongan_darah: upper(textVal(row.golongan_darah)) || null,
    nomor_buku_nikah: upper(textVal(row.nomor_buku_nikah)) || null,
    alamat: buildAlamatImport(row),
    no_telepon: textVal(row.no_telepon) || null,
    nama_bank: textVal(row.nama_bank) || null,
    nomor_rekening: textVal(row.nomor_rekening) || null,
    nama_rekening: textVal(row.nama_rekening) || null,
    tanggal_mulai_jabatan: parseDateImport(row.tanggal_mulai_jabatan),
    tanggal_akhir_jabatan: parseDateImport(row.tanggal_akhir_jabatan),
    status_jabatan: lowerEnum(row.status_jabatan, ['aktif', 'selesai']) || 'aktif',
    status_verifikasi: lowerEnum(row.status_verifikasi_pengurus, ['verified', 'unverified']) || 'unverified',
    produk_hukum_id: textVal(row.produk_hukum_id_pengurus) || null,
  };

  if (!existing) {
    await prisma.pengurus.create({ data: { id: uuidv4(), ...data, imported: true } });
    return 'inserted';
  }

  if (!existing.imported) return 'skip_manual';

  await prisma.pengurus.update({ where: { id: existing.id }, data });
  return 'updated';
}

module.exports = new PengurusController();
