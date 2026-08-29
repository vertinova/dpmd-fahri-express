const prisma = require('../config/prisma');
const logger = require('../utils/logger');
const ActivityLogger = require('../utils/activityLogger');
const fs = require('fs').promises;
const path = require('path');
const { KOLOM_DESA, KOLOM_ADMIN, siapkanData } = require('../config/bumdesFields');

class BumdesController {
  
  // GET /api/desa/bumdes - Get BUMDES for logged in desa
  async getDesaBumdes(req, res, next) {
    try {
      const userId = req.user.id;
      const desaId = req.user.desa_id;
      
      if (!desaId) {
        return res.status(403).json({
          success: false,
          message: 'User tidak memiliki desa_id'
        });
      }

      logger.info(`Fetching BUMDES for desa_id: ${desaId}`);

      const bumdes = await prisma.bumdes.findFirst({
        where: { desa_id: desaId }
      });

      return res.json({
        success: true,
        data: bumdes,
        message: bumdes ? 'Data BUMDES ditemukan' : 'Belum ada data BUMDES'
      });

    } catch (error) {
      logger.error('Error getting desa BUMDES:', error);
      next(error);
    }
  }

  // POST /api/desa/bumdes - Create/Update BUMDES (STEP 1: Data only, no files)
  async storeDesaBumdes(req, res, next) {
    try {
      const userId = req.user.id;
      const userRole = req.user.role;
      const desaId = req.user.desa_id;
      const bidangId = req.user.bidang_id;

      logger.info('BUMDES Store Request Received', {
        user_id: userId,
        user_role: userRole,
        desa_id: desaId,
        bidang_id: bidangId,
        has_data: !!req.body
      });

      const data = req.body;
      
      // Log received data untuk debugging
      logger.info('BUMDES Data Received:', {
        namabumdesa: data.namabumdesa,
        desa_id: data.desa_id,
        kode_desa: data.kode_desa,
        fields_count: Object.keys(data).length
      });
      
      // Validate required field
      if (!data.namabumdesa || data.namabumdesa.trim() === '') {
        return res.status(400).json({
          success: false,
          message: 'Nama BUMDes harus diisi',
          error: 'Field namabumdesa is required'
        });
      }

      // Penyaringan payload dilakukan di bawah, setelah desa tujuan
      // ditentukan: lihat siapkanData() di src/config/bumdesFields.js.
      
      // For role 'desa', use their desa_id
      // For role 'sarana_prasarana', 'dinas', or 'superadmin', use desa_id from form data
      // For role 'pegawai', 'kepala_bidang', 'kepala_dinas', 'ketua_tim' from SPKED (bidang 3), use desa_id from form data
      let targetDesaId;
      
      if (userRole === 'desa') {
        if (!desaId) {
          return res.status(403).json({
            success: false,
            message: 'User desa tidak memiliki desa_id'
          });
        }
        targetDesaId = parseInt(desaId);
        data.desa_id = parseInt(desaId);
      } else if (['sarana_prasarana', 'dinas', 'superadmin'].includes(userRole)) {
        // Sarpras/Admin must provide desa_id in the form data
        if (!data.desa_id) {
          return res.status(400).json({
            success: false,
            message: 'desa_id harus disertakan dalam data'
          });
        }
        targetDesaId = parseInt(data.desa_id);
        data.desa_id = parseInt(data.desa_id);
      } else if (['pegawai', 'kepala_bidang', 'kepala_dinas', 'ketua_tim'].includes(userRole)) {
        // Pegawai from SPKED (bidang 3) can manage BUMDes
        if (bidangId !== 3) {
          return res.status(403).json({
            success: false,
            message: 'Role Anda tidak memiliki akses untuk menyimpan BUMDes (hanya SPKED/Bidang 3)'
          });
        }
        
        // Must provide desa_id in form data
        if (!data.desa_id) {
          return res.status(400).json({
            success: false,
            message: 'desa_id harus disertakan dalam data'
          });
        }
        targetDesaId = parseInt(data.desa_id);
        data.desa_id = parseInt(data.desa_id);
      } else {
        return res.status(403).json({
          success: false,
          message: 'Role tidak memiliki akses untuk menyimpan BUMDes'
        });
      }

      // Saring payload: hanya kolom yang boleh ditulis peran ini yang lolos,
      // alias ejaan lama diterjemahkan, angka berformat rupiah dibaca, dan
      // status diseragamkan ke nilai enum Prisma.
      const kolomBoleh = userRole === 'desa' ? KOLOM_DESA : KOLOM_ADMIN;
      const dataTersaring = siapkanData(data, kolomBoleh);

      // Identitas desa selalu ditetapkan sistem dari tabel desas, tidak pernah
      // dari input — inilah yang dulu membuat desa_id kosong di seluruh baris.
      const desaRef = await prisma.desas.findUnique({
        where: { id: BigInt(targetDesaId) },
        select: { id: true, kode: true, nama: true, kecamatans: { select: { nama: true } } }
      });
      if (!desaRef) {
        return res.status(404).json({
          success: false,
          message: 'Desa tidak ditemukan'
        });
      }
      dataTersaring.desa_id = Number(desaRef.id);
      dataTersaring.kode_desa = desaRef.kode;
      dataTersaring.desa = desaRef.nama;
      dataTersaring.kecamatan = desaRef.kecamatans?.nama || null;

      // Check if BUMDES already exists for this desa_id
      const existing = await prisma.bumdes.findFirst({
        where: { desa_id: targetDesaId }
      });

      let bumdes;
      const isUpdate = !!existing;
      
      if (existing) {
        // Update existing
        bumdes = await prisma.bumdes.update({
          where: { id: existing.id },
          data: dataTersaring
        });
        logger.info(`BUMDES updated for desa_id: ${targetDesaId} by user ${userId} (${userRole})`);
      } else {
        // Create new
        bumdes = await prisma.bumdes.create({
          data: dataTersaring
        });
        logger.info(`BUMDES created for desa_id: ${targetDesaId}, id: ${bumdes.id} by user ${userId} (${userRole})`);
      }

      // Log activity
      try {
        const desaInfo = await prisma.desas.findUnique({
          where: { id: targetDesaId },
          select: { nama: true }
        });

        await ActivityLogger.log({
          userId: userId,
          userName: req.user.name,
          userRole: userRole,
          bidangId: 3, // SPKED
          module: 'bumdes',
          action: isUpdate ? 'update' : 'create',
          entityType: 'bumdes',
          entityId: bumdes.id,
          entityName: `BUMDes ${desaInfo?.nama || ''}`,
          description: isUpdate 
            ? `${req.user.name} memperbarui data BUMDes ${desaInfo?.nama || ''}`
            : `${req.user.name} menambahkan data BUMDes ${desaInfo?.nama || ''}`
        });
      } catch (logError) {
        logger.error('Error logging BUMDes activity:', logError);
      }

      return res.json({
        success: true,
        data: bumdes,
        message: existing ? 'Data BUMDES berhasil diperbarui' : 'Data BUMDES berhasil disimpan'
      });

    } catch (error) {
      logger.error('Error storing BUMDES:', error);
      next(error);
    }
  }

  // POST /api/desa/bumdes/upload-file - Upload single file (STEP 2)
  async uploadDesaBumdesFile(req, res, next) {
    try {
      const userId = req.user.id;
      const userRole = req.user.role;
      const desaId = req.user.desa_id;
      const bidangId = req.user.bidang_id;

      logger.info('=== BUMDES UPLOAD FILE REQUEST ===', {
        has_file: !!req.file,
        bumdes_id: req.body.bumdes_id,
        field_name: req.body.field_name,
        user_role: userRole,
        desa_id: desaId,
        bidang_id: bidangId
      });

      if (!req.file) {
        return res.status(400).json({
          success: false,
          message: 'No file uploaded'
        });
      }

      const { bumdes_id, field_name } = req.body;

      if (!bumdes_id || !field_name) {
        return res.status(400).json({
          success: false,
          message: 'bumdes_id and field_name required'
        });
      }

      // Find BUMDES and verify authorization based on role
      let bumdes;
      if (userRole === 'desa') {
        // Desa users can only upload to their own BUMDes
        bumdes = await prisma.bumdes.findFirst({
          where: { 
            id: parseInt(bumdes_id),
            desa_id: desaId 
          }
        });
      } else if (userRole === 'dinas' || userRole === 'superadmin' || userRole === 'sarana_prasarana') {
        // Dinas, superadmin, and sarana_prasarana can upload to any BUMDes
        bumdes = await prisma.bumdes.findFirst({
          where: { 
            id: parseInt(bumdes_id)
          }
        });
      } else if (['pegawai', 'kepala_bidang', 'kepala_dinas', 'ketua_tim'].includes(userRole)) {
        // Pegawai from SPKED (bidang 3) can upload to any BUMDes
        if (bidangId !== 3) {
          return res.status(403).json({
            success: false,
            message: 'Role Anda tidak memiliki akses untuk upload file BUMDes (hanya SPKED/Bidang 3)'
          });
        }
        bumdes = await prisma.bumdes.findFirst({
          where: { 
            id: parseInt(bumdes_id)
          }
        });
      } else {
        return res.status(403).json({
          success: false,
          message: 'Access denied'
        });
      }

      if (!bumdes) {
        return res.status(404).json({
          success: false,
          message: 'BUMDES not found or access denied'
        });
      }

      // Determine folder based on field name
      const laporanKeuanganFields = ['LaporanKeuangan2021', 'LaporanKeuangan2022', 'LaporanKeuangan2023', 'LaporanKeuangan2024'];
      const dokumenBadanHukumFields = ['ProfilBUMDesa', 'BeritaAcara', 'AnggaranDasar', 'AnggaranRumahTangga', 'ProgramKerja', 'Perdes', 'SK_BUM_Desa'];
      
      let folder = 'bumdes';
      if (laporanKeuanganFields.includes(field_name)) {
        folder = 'bumdes_laporan_keuangan';
      } else if (dokumenBadanHukumFields.includes(field_name)) {
        folder = 'bumdes_dokumen_badanhukum';
      }

      // Path file yang di-upload oleh multer
      const uploadedFilePath = path.join(__dirname, '../../', req.file.path);
      
      // Path file tujuan yang benar
      const correctFolder = path.join(__dirname, '../../storage/uploads', folder);
      const correctFilePath = path.join(correctFolder, req.file.filename);
      
      // Ensure correct folder exists
      if (!require('fs').existsSync(correctFolder)) {
        require('fs').mkdirSync(correctFolder, { recursive: true });
      }
      
      // Move file to correct folder if needed
      if (uploadedFilePath !== correctFilePath) {
        try {
          await fs.rename(uploadedFilePath, correctFilePath);
          logger.info('File moved to correct folder:', { from: uploadedFilePath, to: correctFilePath });
        } catch (moveErr) {
          logger.error('Error moving file:', moveErr);
          // If rename fails, try copy then delete
          await fs.copyFile(uploadedFilePath, correctFilePath);
          await fs.unlink(uploadedFilePath);
        }
      }

      // Delete old file if exists
      const currentFilePath = bumdes[field_name];
      if (currentFilePath) {
        const oldFilePath = path.join(__dirname, '../../storage/uploads', currentFilePath);
        try {
          await fs.unlink(oldFilePath);
          logger.info('Old file deleted:', currentFilePath);
        } catch (err) {
          logger.warn('Could not delete old file:', err.message);
        }
      }

      // New file path (relative)
      const newFilePath = `${folder}/${req.file.filename}`;

      // Update database using Prisma
      const updateData = {};
      updateData[field_name] = newFilePath;
      
      await prisma.bumdes.update({
        where: { id: parseInt(bumdes_id) },
        data: updateData
      });

      logger.info('BUMDES File uploaded successfully', {
        bumdes_id,
        field_name,
        file_path: newFilePath,
        user_role: userRole
      });

      return res.json({
        success: true,
        message: 'File berhasil diupload',
        data: {
          field_name,
          file_path: newFilePath,
          bumdes_id: parseInt(bumdes_id)
        }
      });

    } catch (error) {
      logger.error('Error uploading BUMDES file:', error);
      next(error);
    }
  }

  // PUT /api/desa/bumdes/:id - Update BUMDES
  async updateDesaBumdes(req, res, next) {
    try {
      const { id } = req.params;
      const userRole = req.user.role;
      const desaId = req.user.desa_id;
      const bidangId = req.user.bidang_id;

      // Check authorization based on role
      let existing;
      if (userRole === 'desa') {
        // Desa users can only update their own BUMDes
        existing = await prisma.bumdes.findFirst({
          where: { 
            id: parseInt(id),
            desa_id: desaId 
          }
        });
      } else if (userRole === 'dinas' || userRole === 'superadmin' || userRole === 'sarana_prasarana') {
        // Dinas, superadmin, and sarana_prasarana can update any BUMDes
        existing = await prisma.bumdes.findFirst({
          where: { 
            id: parseInt(id)
          }
        });
      } else if (['pegawai', 'kepala_bidang', 'kepala_dinas', 'ketua_tim'].includes(userRole)) {
        // Pegawai from SPKED (bidang 3) can update any BUMDes
        if (bidangId !== 3) {
          return res.status(403).json({
            success: false,
            message: 'Role Anda tidak memiliki akses untuk mengupdate BUMDes (hanya SPKED/Bidang 3)'
          });
        }
        existing = await prisma.bumdes.findFirst({
          where: { 
            id: parseInt(id)
          }
        });
      } else {
        return res.status(403).json({
          success: false,
          message: 'Access denied'
        });
      }

      if (!existing) {
        return res.status(404).json({
          success: false,
          message: 'BUMDES not found or access denied'
        });
      }

      // Saring payload dengan daftar-izin yang sama seperti saat menyimpan,
      // supaya aturan kolom tidak bisa berbeda antara create dan update.
      const kolomBoleh = userRole === 'desa' ? KOLOM_DESA : KOLOM_ADMIN;
      const dataToUpdate = siapkanData(req.body, kolomBoleh);

      const bumdes = await prisma.bumdes.update({
        where: { id: parseInt(id) },
        data: dataToUpdate
      });

      logger.info(`BUMDES updated: ${id} by ${userRole}`);

      return res.json({
        success: true,
        data: bumdes,
        message: 'Data BUMDES berhasil diperbarui'
      });

    } catch (error) {
      logger.error('Error updating BUMDES:', error);
      next(error);
    }
  }

  // DELETE /api/desa/bumdes/:id - Delete BUMDES
  async deleteDesaBumdes(req, res, next) {
    try {
      const { id } = req.params;
      const userRole = req.user.role;
      const desaId = req.user.desa_id;
      const bidangId = req.user.bidang_id;

      // Check authorization based on role
      let bumdes;
      if (userRole === 'desa') {
        // Desa users can only delete their own BUMDes
        bumdes = await prisma.bumdes.findFirst({
          where: { 
            id: parseInt(id),
            desa_id: desaId 
          }
        });
      } else if (userRole === 'dinas' || userRole === 'superadmin' || userRole === 'sarana_prasarana') {
        // Dinas, superadmin, and sarana_prasarana can delete any BUMDes
        bumdes = await prisma.bumdes.findFirst({
          where: { 
            id: parseInt(id)
          }
        });
      } else if (['pegawai', 'kepala_bidang', 'kepala_dinas', 'ketua_tim'].includes(userRole)) {
        // Pegawai from SPKED (bidang 3) can delete any BUMDes
        if (bidangId !== 3) {
          return res.status(403).json({
            success: false,
            message: 'Role Anda tidak memiliki akses untuk menghapus BUMDes (hanya SPKED/Bidang 3)'
          });
        }
        bumdes = await prisma.bumdes.findFirst({
          where: { 
            id: parseInt(id)
          }
        });
      } else {
        return res.status(403).json({
          success: false,
          message: 'Access denied'
        });
      }

      if (!bumdes) {
        return res.status(404).json({
          success: false,
          message: 'BUMDES not found or access denied'
        });
      }

      // Delete all associated files
      const fileFields = [
        'LaporanKeuangan2021', 'LaporanKeuangan2022', 'LaporanKeuangan2023', 'LaporanKeuangan2024',
        'ProfilBUMDesa', 'BeritaAcara', 'AnggaranDasar', 'AnggaranRumahTangga', 'ProgramKerja',
        'Perdes', 'SK_BUM_Desa'
      ];

      for (const field of fileFields) {
        if (bumdes[field]) {
          const filePath = path.join(__dirname, '../../storage/uploads', bumdes[field]);
          try {
            await fs.unlink(filePath);
            logger.info(`Deleted file: ${bumdes[field]}`);
          } catch (err) {
            logger.warn(`Could not delete file: ${bumdes[field]}`);
          }
        }
      }

      await prisma.bumdes.delete({
        where: { id: parseInt(id) }
      });

      logger.info(`BUMDES deleted: ${id} by ${userRole}`);

      return res.json({
        success: true,
        message: 'Data BUMDES berhasil dihapus'
      });

    } catch (error) {
      logger.error('Error deleting BUMDES:', error);
      next(error);
    }
  }

  // GET /api/bumdes - Get all BUMDES (Admin)
  async getAllBumdes(req, res, next) {
    try {
      logger.info('Getting all BUMDES data', {
        user_role: req.user.role,
        user_id: req.user.id
      });

      const bumdes = await prisma.bumdes.findMany({
        orderBy: { created_at: 'desc' }
      });

      logger.info(`Found ${bumdes.length} BUMDES records`);

      return res.json({
        success: true,
        data: bumdes
      });

    } catch (error) {
      logger.error('Error getting all BUMDES:', error);
      next(error);
    }
  }

  // GET /api/bumdes/:id - Get BUMDES by ID
  async getBumdesById(req, res, next) {
    try {
      const { id } = req.params;
      const userRole = req.user.role;
      const desaId = req.user.desa_id;

      logger.info(`Getting BUMDES by ID: ${id}`, {
        user_role: userRole,
        user_id: req.user.id
      });

      // Check authorization based on role
      let bumdes;
      if (userRole === 'desa') {
        // Desa users can only get their own BUMDes
        bumdes = await prisma.bumdes.findFirst({
          where: { 
            id: parseInt(id),
            desa_id: desaId 
          }
        });
      } else if (userRole === 'dinas' || userRole === 'superadmin' || userRole === 'sarana_prasarana') {
        // Dinas, superadmin, and sarana_prasarana can get any BUMDes
        bumdes = await prisma.bumdes.findFirst({
          where: { 
            id: parseInt(id)
          }
        });
      } else {
        return res.status(403).json({
          success: false,
          message: 'Access denied'
        });
      }

      if (!bumdes) {
        return res.status(404).json({
          success: false,
          message: 'BUMDES not found or access denied'
        });
      }

      logger.info(`Found BUMDES: ${bumdes.namabumdesa}`);

      return res.json({
        success: true,
        data: bumdes
      });

    } catch (error) {
      logger.error('Error getting BUMDES by ID:', error);
      next(error);
    }
  }

  // GET /api/bumdes/dokumen-badan-hukum - Get dokumen badan hukum files (OPTIMIZED - Lazy Load)
  async getDokumenBadanHukum(req, res, next) {
    try {
      const { bumdes_id } = req.query; // Optional: filter by specific BUMDes
      
      logger.info('Getting dokumen badan hukum files (optimized)', { bumdes_id });

      // Get base URL for file serving
      const baseUrl = process.env.BASE_URL || `${req.protocol}://${req.get('host')}`;

      // Build where clause
      const whereClause = {};
      if (bumdes_id) {
        whereClause.id = parseInt(bumdes_id);
      }

      // Get all BUMDES data once (cached in memory)
      const allBumdes = await prisma.bumdes.findMany({
        where: whereClause,
        select: {
          id: true,
          namabumdesa: true,
          desa_id: true,
          kode_desa: true,
          desa: true,
          kecamatan: true,
          // File fields
          ProfilBUMDesa: true,
          BeritaAcara: true,
          AnggaranDasar: true,
          AnggaranRumahTangga: true,
          ProgramKerja: true,
          Perdes: true,
          SK_BUM_Desa: true,
          // Dokumen yang dipilih desa dari modul Produk Hukum, bukan diunggah di sini.
          produk_hukums_bumdes_produk_hukum_perdes_idToproduk_hukums: {
            select: { id: true, judul: true, nomor: true, tahun: true, file: true }
          },
          produk_hukums_bumdes_produk_hukum_sk_bumdes_idToproduk_hukums: {
            select: { id: true, judul: true, nomor: true, tahun: true, file: true }
          }
        }
      });

      // Build lightweight file list from database (no filesystem scan)
      const documents = [];
      const seenFiles = new Set(); // Track seen files to prevent duplicates
      const fileFields = [
        { field: 'ProfilBUMDesa', label: 'Profil BUMDesa' },
        { field: 'BeritaAcara', label: 'Berita Acara' },
        { field: 'AnggaranDasar', label: 'Anggaran Dasar' },
        { field: 'AnggaranRumahTangga', label: 'Anggaran Rumah Tangga' },
        { field: 'ProgramKerja', label: 'Program Kerja' },
        { field: 'Perdes', label: 'Peraturan Desa' },
        { field: 'SK_BUM_Desa', label: 'SK BUM Desa' }
      ];

      // Perdes dan SK BUM Desa punya dua jalur: diunggah langsung di halaman ini,
      // atau dipilih desa dari modul Produk Hukum. Keduanya harus terlihat di sini,
      // kalau tidak dokumen yang sudah ada di halaman desa seolah-olah hilang.
      const tautanProdukHukum = [
        {
          relasi: 'produk_hukums_bumdes_produk_hukum_perdes_idToproduk_hukums',
          field: 'produk_hukum_perdes_id',
          label: 'Peraturan Desa'
        },
        {
          relasi: 'produk_hukums_bumdes_produk_hukum_sk_bumdes_idToproduk_hukums',
          field: 'produk_hukum_sk_bumdes_id',
          label: 'SK BUM Desa'
        }
      ];

      for (const bumdes of allBumdes) {
        for (const { field, label } of fileFields) {
          if (bumdes[field]) {
            const filename = bumdes[field].split('/').pop();
            
            // Create unique key: bumdes_id + filename + field to prevent duplicates
            const uniqueKey = `${bumdes.id}_${filename}_${field}`;
            
            if (!seenFiles.has(uniqueKey)) {
              seenFiles.add(uniqueKey);
              
              documents.push({
                filename,
                document_type: label,
                original_path: `uploads/bumdes_dokumen_badanhukum/${filename}`,
                url: `${baseUrl}/uploads/bumdes_dokumen_badanhukum/${filename}`,
                download_url: `${baseUrl}/uploads/bumdes_dokumen_badanhukum/${filename}`,
                file_exists: true, // File ada di database
                status: 'available',
                sumber: 'unggahan',
                bumdes_name: bumdes.namabumdesa || 'Tidak Diketahui',
                desa: bumdes.desa || '',
                kecamatan: bumdes.kecamatan || '',
                bumdes_id: bumdes.id, // Change from 'id' to 'bumdes_id' to be more explicit
                field: field
              });
            }
          }
        }

        for (const { relasi, field, label } of tautanProdukHukum) {
          const ph = bumdes[relasi];
          if (!ph || !ph.file) continue;

          const filename = ph.file.split('/').pop();
          const uniqueKey = `${bumdes.id}_${filename}_${field}`;
          if (seenFiles.has(uniqueKey)) continue;
          seenFiles.add(uniqueKey);

          documents.push({
            filename,
            document_type: label,
            original_path: `uploads/produk-hukum/${filename}`,
            url: `${baseUrl}/uploads/produk-hukum/${filename}`,
            download_url: `${baseUrl}/uploads/produk-hukum/${filename}`,
            file_exists: true,
            status: 'available',
            // Berkasnya milik arsip Produk Hukum desa; jangan dihapus dari sini.
            sumber: 'produk_hukum',
            produk_hukum: {
              id: ph.id,
              judul: ph.judul,
              nomor: ph.nomor,
              tahun: ph.tahun
            },
            bumdes_name: bumdes.namabumdesa || 'Tidak Diketahui',
            desa: bumdes.desa || '',
            kecamatan: bumdes.kecamatan || '',
            bumdes_id: bumdes.id,
            field: field
          });
        }
      }

      // Sort by bumdes name
      documents.sort((a, b) => a.bumdes_name.localeCompare(b.bumdes_name));

      logger.info(`Found ${documents.length} dokumen badan hukum records`);

      return res.json({
        status: 'success',
        message: 'Dokumen badan hukum berhasil diambil',
        data: documents,
        total: documents.length
      });

    } catch (error) {
      logger.error('Error getting dokumen badan hukum:', error);
      next(error);
    }
  }

  // GET /api/bumdes/laporan-keuangan - Get laporan keuangan files (OPTIMIZED - Lazy Load)
  async getLaporanKeuangan(req, res, next) {
    try {
      const { bumdes_id } = req.query; // Optional: filter by specific BUMDes
      
      logger.info('Getting laporan keuangan files (optimized)', { bumdes_id });

      // Get base URL for file serving
      const baseUrl = process.env.BASE_URL || `${req.protocol}://${req.get('host')}`;

      // Build where clause
      const whereClause = {};
      if (bumdes_id) {
        whereClause.id = parseInt(bumdes_id);
      }

      // Get all BUMDES data once (cached in memory)
      const allBumdes = await prisma.bumdes.findMany({
        where: whereClause,
        select: {
          id: true,
          namabumdesa: true,
          desa: true,
          kecamatan: true,
          LaporanKeuangan2021: true,
          LaporanKeuangan2022: true,
          LaporanKeuangan2023: true,
          LaporanKeuangan2024: true
        }
      });

      // Build lightweight file list from database (no filesystem scan)
      const documents = [];
      const seenFiles = new Set(); // Track seen files to prevent duplicates
      const yearFields = [
        { field: 'LaporanKeuangan2021', year: '2021' },
        { field: 'LaporanKeuangan2022', year: '2022' },
        { field: 'LaporanKeuangan2023', year: '2023' },
        { field: 'LaporanKeuangan2024', year: '2024' }
      ];

      for (const bumdes of allBumdes) {
        for (const { field, year } of yearFields) {
          if (bumdes[field]) {
            const filename = bumdes[field].split('/').pop();
            
            // Create unique key: bumdes_id + filename + field to prevent duplicates
            const uniqueKey = `${bumdes.id}_${filename}_${field}`;
            
            if (!seenFiles.has(uniqueKey)) {
              seenFiles.add(uniqueKey);
              
              documents.push({
                filename,
                document_type: `Laporan Keuangan ${year}`,
                year: year,
                original_path: `uploads/bumdes_laporan_keuangan/${filename}`,
                url: `${baseUrl}/uploads/bumdes_laporan_keuangan/${filename}`,
                download_url: `${baseUrl}/uploads/bumdes_laporan_keuangan/${filename}`,
                file_exists: true, // File ada di database
                status: 'available',
                bumdes_name: bumdes.namabumdesa || 'Tidak Diketahui',
                desa: bumdes.desa || '',
                kecamatan: bumdes.kecamatan || '',
                bumdes_id: bumdes.id, // Change from 'id' to 'bumdes_id' to be more explicit
                field: field
              });
            }
          }
        }
      }

      // Sort by year DESC, then bumdes name
      documents.sort((a, b) => {
        const yearDiff = b.year.localeCompare(a.year);
        if (yearDiff !== 0) return yearDiff;
        return a.bumdes_name.localeCompare(b.bumdes_name);
      });

      logger.info(`Found ${documents.length} laporan keuangan records`);

      return res.json({
        status: 'success',
        message: 'Laporan keuangan berhasil diambil',
        data: documents,
        total: documents.length
      });

    } catch (error) {
      logger.error('Error getting laporan keuangan:', error);
      next(error);
    }
  }

  // GET /api/bumdes/produk-hukum - Get produk hukum files (OPTIMIZED - Lazy Load)
  async getProdukHukum(req, res, next) {
    try {
      logger.info('Getting produk hukum files (optimized)');

      // Get base URL for file serving
      const baseUrl = process.env.BASE_URL || `${req.protocol}://${req.get('host')}`;

      // Get all BUMDES with produk hukum documents
      const allBumdes = await prisma.bumdes.findMany({
        select: {
          id: true,
          namabumdesa: true,
          desa: true,
          kecamatan: true,
          Perdes: true,
          SK_BUM_Desa: true
        }
      });
      
      const documents = [];

      for (const bumdes of allBumdes) {
        // Add Perdes file
        if (bumdes.Perdes) {
          const filename = bumdes.Perdes.split('/').pop();
          documents.push({
            filename,
            original_path: `uploads/bumdes_dokumen_badanhukum/${filename}`,
            url: `${baseUrl}/uploads/bumdes_dokumen_badanhukum/${filename}`,
            download_url: `${baseUrl}/uploads/bumdes_dokumen_badanhukum/${filename}`,
            file_exists: true, // File ada di database
            status: 'available',
            type: 'Perdes',
            document_type: 'Peraturan Desa',
            bumdes_name: bumdes.namabumdesa || 'Tidak Diketahui',
            desa: bumdes.desa || '',
            kecamatan: bumdes.kecamatan || '',
            id: bumdes.id
          });
        }

        // Add SK BUM Desa file
        if (bumdes.SK_BUM_Desa) {
          const filename = bumdes.SK_BUM_Desa.split('/').pop();
          documents.push({
            filename,
            original_path: `uploads/bumdes_dokumen_badanhukum/${filename}`,
            url: `${baseUrl}/uploads/bumdes_dokumen_badanhukum/${filename}`,
            download_url: `${baseUrl}/uploads/bumdes_dokumen_badanhukum/${filename}`,
            file_exists: true, // File ada di database
            status: 'available',
            type: 'SK_BUM_Desa',
            document_type: 'SK BUM Desa',
            bumdes_name: bumdes.namabumdesa || 'Tidak Diketahui',
            desa: bumdes.desa || '',
            kecamatan: bumdes.kecamatan || '',
            id: bumdes.id
          });
        }
      }

      // Sort by bumdes name
      documents.sort((a, b) => a.bumdes_name.localeCompare(b.bumdes_name));

      logger.info(`Found ${documents.length} produk hukum records`);

      return res.json({
        status: 'success',
        message: 'Produk hukum berhasil diambil',
        data: documents,
        total: documents.length,
        summary: {
          total_documents: documents.length,
          by_type: {
            perdes: documents.filter(d => d.type === 'Perdes').length,
            sk_bumdes: documents.filter(d => d.type === 'SK_BUM_Desa').length
          }
        }
      });

    } catch (error) {
      logger.error('Error getting produk hukum:', error);
      next(error);
    }
  }

  // GET /api/bumdes/statistics - Get BUMDES statistics (Admin)
  async getStatistics(req, res, next) {
    try {
      // Basic counts
      const total = await prisma.bumdes.count();
      const aktif = await prisma.bumdes.count({ where: { status: 'aktif' } });
      const tidakAktif = await prisma.bumdes.count({ where: { status: 'tidak_aktif' } });

      // Calculate progress to target (assuming target is 416 desa)
      const target = 416;
      const remaining = Math.max(0, target - total);
      const percentage = Math.min(100, Math.round((total / target) * 100));

      // Get all bumdes for detailed stats with actual database field names
      const allBumdes = await prisma.bumdes.findMany({
        select: {
          kecamatan: true,
          JenisUsaha: true,
          status: true,
          TahunPendirian: true,
          badanhukum: true,
          PenyertaanModal2019: true,
          PenyertaanModal2020: true,
          PenyertaanModal2021: true,
          PenyertaanModal2022: true,
          PenyertaanModal2023: true,
          PenyertaanModal2024: true,
          SumberLain: true,
          NilaiAset: true,
          Omset2024: true,
          Laba2024: true,
          TotalTenagaKerja: true
        }
      });

      // Statistics by Kecamatan
      const byKecamatan = {};
      allBumdes.forEach(b => {
        const kec = b.kecamatan || 'Tidak Diketahui';
        if (!byKecamatan[kec]) {
          byKecamatan[kec] = { total: 0, aktif: 0, tidak_aktif: 0 };
        }
        byKecamatan[kec].total++;
        if (b.status === 'aktif') byKecamatan[kec].aktif++;
        if (b.status === 'tidak_aktif') byKecamatan[kec].tidak_aktif++;
      });

      // Statistics by Jenis Usaha
      const byJenisUsaha = {};
      allBumdes.forEach(b => {
        const jenis = b.JenisUsaha || 'Tidak Diketahui';
        if (!byJenisUsaha[jenis]) {
          byJenisUsaha[jenis] = 0;
        }
        byJenisUsaha[jenis]++;
      });

      // Statistics by Tahun Pendirian (for trend chart)
      const byTahun = {};
      allBumdes.forEach(b => {
        if (b.TahunPendirian) {
          const tahun = b.TahunPendirian.toString();
          if (!byTahun[tahun]) {
            byTahun[tahun] = 0;
          }
          byTahun[tahun]++;
        }
      });

      // Calculate financial statistics
      let totalModal = 0;
      let totalAset = 0;
      let totalOmset = 0;
      let totalLaba = 0;
      let countWithModalData = 0;

      allBumdes.forEach(b => {
        // Calculate total modal from all penyertaan modal years + sumber lain
        let modal = 0;
        modal += parseFloat(b.PenyertaanModal2019) || 0;
        modal += parseFloat(b.PenyertaanModal2020) || 0;
        modal += parseFloat(b.PenyertaanModal2021) || 0;
        modal += parseFloat(b.PenyertaanModal2022) || 0;
        modal += parseFloat(b.PenyertaanModal2023) || 0;
        modal += parseFloat(b.PenyertaanModal2024) || 0;
        modal += parseFloat(b.SumberLain) || 0;
        
        if (modal > 0) {
          totalModal += modal;
          countWithModalData++;
        }
        
        if (b.NilaiAset) totalAset += parseFloat(b.NilaiAset) || 0;
        if (b.Omset2024) totalOmset += parseFloat(b.Omset2024) || 0;
        if (b.Laba2024) totalLaba += parseFloat(b.Laba2024) || 0;
      });

      // Workforce statistics (only total available, no gender breakdown in DB)
      let totalTenagaKerja = 0;

      allBumdes.forEach(b => {
        if (b.TotalTenagaKerja) totalTenagaKerja += parseInt(b.TotalTenagaKerja) || 0;
      });

      // Status Badan Hukum statistics
      const terbitSertifikat = allBumdes.filter(b => b.badanhukum === 'Terbit Sertifikat Badan Hukum').length;
      const namaTermerifikasi = allBumdes.filter(b => b.badanhukum === 'Nama Terverifikasi').length;
      const perbaikanDokumen = allBumdes.filter(b => b.badanhukum === 'Perbaikan Dokumen').length;
      const belumProses = allBumdes.filter(b => b.badanhukum === 'Belum Melakukan Proses').length;
      const percentageSertifikat = total > 0 ? Math.round((terbitSertifikat / total) * 100) : 0;

      return res.json({
        success: true,
        data: {
          overview: {
            total,
            aktif,
            tidak_aktif: tidakAktif,
            progress_to_target: {
              target,
              remaining,
              percentage
            }
          },
          by_kecamatan: Object.keys(byKecamatan).map(key => ({
            kecamatan: key,
            ...byKecamatan[key]
          })).sort((a, b) => b.total - a.total),
          by_jenis_usaha: Object.keys(byJenisUsaha).map(key => ({
            jenis_usaha: key,
            total: byJenisUsaha[key]
          })).sort((a, b) => b.total - a.total),
          by_tahun: Object.keys(byTahun).map(key => ({
            tahun: key,
            total: byTahun[key]
          })).sort((a, b) => a.tahun - b.tahun),
          financial: {
            total_modal: totalModal,
            total_aset: totalAset,
            total_volume_usaha: totalOmset,
            total_shu: totalLaba,
            rata_rata_modal: countWithModalData > 0 ? Math.round(totalModal / countWithModalData) : 0,
            rata_rata_aset: total > 0 ? Math.round(totalAset / total) : 0
          },
          workforce: {
            total_tenaga_kerja: totalTenagaKerja,
            laki_laki: 0, // Not available in database
            perempuan: 0, // Not available in database
            persentase_perempuan: 0 // Not available in database
          },
          badan_hukum: {
            terbit_sertifikat: terbitSertifikat,
            nama_terverifikasi: namaTermerifikasi,
            perbaikan_dokumen: perbaikanDokumen,
            belum_proses: belumProses,
            percentage_sertifikat: percentageSertifikat
          }
        }
      });

    } catch (error) {
      logger.error('Error getting BUMDES statistics:', error);
      next(error);
    }
  }

  // GET /api/desa/bumdes/produk-hukum-options - Get produk hukum options for dropdown
  async getProdukHukumForBumdes(req, res, next) {
    try {
      const desaId = req.user.desa_id;

      logger.info('Getting produk hukum options for BUMDES, desa_id:', desaId);

      // Fetch ALL Peraturan Desa (PERDES) - let user choose any PERDES
      const perdes = await prisma.produk_hukums.findMany({
        where: {
          desa_id: desaId,
          singkatan_jenis: 'PERDES',
          status_peraturan: 'berlaku'
        },
        orderBy: [
          { tahun: 'desc' },
          { nomor: 'desc' }
        ]
      });

      // Fetch ALL Surat Keputusan (SK KADES) - let user choose any SK
      const sk = await prisma.produk_hukums.findMany({
        where: {
          desa_id: desaId,
          singkatan_jenis: 'SK_KADES',
          status_peraturan: 'berlaku'
        },
        orderBy: [
          { tahun: 'desc' },
          { nomor: 'desc' }
        ]
      });

      logger.info(`Found ${perdes.length} PERDES and ${sk.length} SK for BUMDES`);

      return res.json({
        success: true,
        data: {
          perdes: perdes,
          sk: sk,
          sk_bumdes: sk // Alias for backward compatibility
        },
        message: 'Produk hukum options retrieved successfully'
      });

    } catch (error) {
      logger.error('Error getting produk hukum for bumdes:', error);
      next(error);
    }
  }

  // GET /api/bumdes/check-desa/:kode_desa - Check if kode_desa already has BUMDes
  async checkDesaBumdes(req, res, next) {
    try {
      const { kode_desa } = req.params;
      
      logger.info(`Checking if kode_desa ${kode_desa} has existing BUMDes`);

      const bumdes = await prisma.bumdes.findFirst({
        where: { kode_desa: kode_desa }
      });

      return res.json({
        success: true,
        exists: !!bumdes,
        data: bumdes ? { 
          id: bumdes.id.toString(), 
          namabumdesa: bumdes.namabumdesa,
          kode_desa: bumdes.kode_desa,
          desa_id: bumdes.desa_id?.toString()
        } : null
      });

    } catch (error) {
      logger.error('Error checking desa BUMDes:', error);
      next(error);
    }
  }

  // DELETE /api/bumdes/delete-file - Delete a file and update database
  async deleteFile(req, res, next) {
    try {
      const { filename, document_type, bumdes_id } = req.body;
      
      if (!filename || !document_type) {
        return res.status(400).json({
          success: false,
          message: 'filename and document_type are required'
        });
      }

      logger.info('Deleting file:', { filename, document_type, bumdes_id });

      // Determine folder based on document type
      let folder = '';
      if (document_type === 'dokumen_badan_hukum') {
        folder = 'bumdes_dokumen_badanhukum';
      } else if (document_type === 'laporan_keuangan') {
        folder = 'bumdes_laporan_keuangan';
      } else {
        return res.status(400).json({
          success: false,
          message: 'Invalid document_type'
        });
      }

      // Berkas yang berasal dari modul Produk Hukum desa tidak boleh dihapus dari
      // halaman BUMDes: pemiliknya arsip hukum desa, dan menghapusnya di sini akan
      // memutus dokumen yang masih dipakai di halaman desa.
      const dariProdukHukum = await prisma.produk_hukums.findFirst({
        where: {
          file: { contains: filename },
          OR: [
            { bumdes_bumdes_produk_hukum_perdes_idToproduk_hukums: { some: {} } },
            { bumdes_bumdes_produk_hukum_sk_bumdes_idToproduk_hukums: { some: {} } }
          ]
        },
        select: { id: true, judul: true }
      });

      if (dariProdukHukum) {
        return res.status(409).json({
          success: false,
          message: 'Berkas ini berasal dari Produk Hukum desa, bukan unggahan BUMDes. '
            + 'Hapus atau ganti lewat menu Produk Hukum di halaman desa.',
          produk_hukum: dariProdukHukum
        });
      }

      // Find BUMDes that has this file
      const documentFields = document_type === 'dokumen_badan_hukum' 
        ? ['Perdes', 'ProfilBUMDesa', 'BeritaAcara', 'AnggaranDasar', 'AnggaranRumahTangga', 'ProgramKerja', 'SK_BUM_Desa']
        : ['LaporanKeuangan2021', 'LaporanKeuangan2022', 'LaporanKeuangan2023', 'LaporanKeuangan2024'];

      let updatedCount = 0;

      for (const field of documentFields) {
        // Find all BUMDes that have this file in the specified field
        const bumdesList = await prisma.bumdes.findMany({
          where: {
            [field]: {
              contains: filename
            }
          }
        });

        for (const bumdes of bumdesList) {
          // Clear the field
          await prisma.bumdes.update({
            where: { id: bumdes.id },
            data: { [field]: null }
          });
          updatedCount++;
          logger.info(`Cleared field ${field} for BUMDes ${bumdes.id}`);
        }
      }

      // Delete physical file
      const filePath = path.join(__dirname, '../../storage/uploads', folder, filename);
      try {
        await fs.unlink(filePath);
        logger.info(`Physical file deleted: ${filePath}`);
      } catch (fileError) {
        logger.warn(`Could not delete physical file: ${filePath}`, fileError.message);
        // Continue even if file deletion fails (file might not exist)
      }

      return res.json({
        success: true,
        message: `File berhasil dihapus${updatedCount > 0 ? ` (${updatedCount} referensi database diperbarui)` : ''}`,
        deleted_file: filename,
        updated_records: updatedCount
      });

    } catch (error) {
      logger.error('Error deleting file:', error);
      next(error);
    }
  }

}

function formatBytes(bytes, decimals = 2) {
  if (bytes === 0) return '0 Bytes';

  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];

  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

module.exports = new BumdesController();
