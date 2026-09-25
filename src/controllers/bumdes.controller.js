const prisma = require('../config/prisma');
const {
  sinkronkanKeProdukHukum, KOLOM_TERSINKRON, PADANAN,
} = require('../services/sinkronProdukHukumBumdes.service');
const logger = require('../utils/logger');
const ActivityLogger = require('../utils/activityLogger');
const fs = require('fs').promises;
const path = require('path');
const { KOLOM_DESA, KOLOM_ADMIN, siapkanData, FOLDER_LAMPIRAN, bacaAngka } = require('../config/bumdesFields');
const { v4: uuidv4 } = require('uuid');

// Dokumen ketahanan pangan — kolom berkas biasa, diunggah lewat /upload-file.
const KOLOM_BERKAS_PANGAN = ['StudiKelayakanUsaha', 'RABKetahananPangan', 'DokumentasiGeotagging'];
const LABEL_BERKAS_PANGAN = {
  StudiKelayakanUsaha: 'Studi Kelayakan Usaha',
  RABKetahananPangan: 'RAB Ketahanan Pangan',
  DokumentasiGeotagging: 'Dokumentasi Geotagging',
};

const bacaDaftarJson = (v) => {
  if (!v) return [];
  try { const x = JSON.parse(v); return Array.isArray(x) ? x : []; } catch { return []; }
};

/**
 * Satu entri daftar dokumen untuk halaman Kelola Dokumen SPKED.
 *
 * `path` (folder/nama, relatif terhadap /uploads) atau `jalur` (URL-path utuh
 * untuk berkas di luar /uploads, mis. /storage/produk_hukum/...) yang dipakai
 * klien untuk merakit tautan — BUKAN url absolut dari BASE_URL, yang di
 * lingkungan dev menunjuk origin frontend sehingga tautannya mati.
 * `url`/`download_url` tetap dikirim untuk kompatibilitas.
 */
const entriDokumen = (bumdes, baseUrl, { nilai, folder, field, label, tahun, jalur, tambahan = {} }) => {
  const filename = String(nilai).split('/').pop();
  const relatif = jalur || `/uploads/${folder}/${filename}`;
  return {
    filename,
    document_type: label,
    field,
    year: tahun ? String(tahun) : undefined,
    path: jalur ? null : `${folder}/${filename}`,
    jalur: jalur || null,
    original_path: relatif.replace(/^\//, ''),
    url: `${baseUrl}${relatif}`,
    download_url: `${baseUrl}${relatif}`,
    file_exists: true,
    status: 'available',
    sumber: 'unggahan',
    bumdes_name: bumdes.namabumdesa || 'Tidak Diketahui',
    desa: bumdes.desa || '',
    kecamatan: bumdes.kecamatan || '',
    bumdes_id: bumdes.id,
    ...tambahan,
  };
};

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
      } else if (KOLOM_BERKAS_PANGAN.includes(field_name)) {
        folder = 'bumdes_ketahanan_pangan';
      } else {
        // field_name menentukan kolom yang ditulis: nama di luar daftar berkas
        // tidak boleh dipakai untuk menimpa kolom data biasa.
        return res.status(400).json({ success: false, message: 'field_name tidak dikenal' });
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

      // Perdes dan SK BUM Desa sekalian didaftarkan ke modul Produk Hukum
      // Desa, supaya dokumen yang diunggah SPKED juga terlihat oleh desanya.
      // Kegagalan di sini TIDAK menggagalkan unggahan: berkasnya sudah tersimpan
      // dan tercatat di kolom BUM Desa, jadi membalas error hanya akan membuat
      // petugas mengunggah ulang berkas yang sebenarnya sudah masuk.
      let sinkronProdukHukum = null;
      if (KOLOM_TERSINKRON.includes(field_name)) {
        try {
          sinkronProdukHukum = await sinkronkanKeProdukHukum(
            { ...bumdes, [field_name]: newFilePath },
            field_name,
            req.file.filename
          );
        } catch (errSinkron) {
          logger.error('Gagal menyinkronkan dokumen BUM Desa ke Produk Hukum:', errSinkron);
        }
      }

      return res.json({
        success: true,
        message: sinkronProdukHukum
          ? 'File berhasil diupload dan terdaftar di Produk Hukum Desa'
          : 'File berhasil diupload',
        data: {
          field_name,
          file_path: newFilePath,
          bumdes_id: parseInt(bumdes_id),
          produk_hukum: sinkronProdukHukum,
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
        'Perdes', 'SK_BUM_Desa', ...KOLOM_BERKAS_PANGAN
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
      const bidangId = req.user.bidang_id;

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
      } else if (['pegawai', 'kepala_bidang', 'kepala_dinas', 'ketua_tim'].includes(userRole)) {
        // Pegawai SPKED (bidang 3) boleh membaca BUMDes mana pun.
        //
        // Cabang ini dulu tidak ada di sini, padahal updateDesaBumdes dan
        // deleteDesaBumdes sudah punya — jadi SPKED boleh MENGUBAH dan
        // MENGHAPUS tapi tidak boleh MEMBACA satu baris. Tidak pernah ketahuan
        // karena halaman lama menyunting dari baris yang sudah ada di daftar
        // dan tidak pernah memanggil endpoint ini. Begitu formulir ubah dibuka
        // dari halaman Statistik, barisnya harus diambil ulang lewat sini.
        if (bidangId !== 3) {
          return res.status(403).json({
            success: false,
            message: 'Role Anda tidak memiliki akses ke data BUMDes (hanya SPKED/Bidang 3)'
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
        { field: 'ProfilBUMDesa', label: 'Profil BUM Desa' },
        { field: 'BeritaAcara', label: 'Berita Acara' },
        { field: 'AnggaranDasar', label: 'Anggaran Dasar (AD)' },
        { field: 'AnggaranRumahTangga', label: 'Anggaran Rumah Tangga (ART)' },
        { field: 'ProgramKerja', label: 'Program Kerja' },
        { field: 'Perdes', label: 'Perdes Pendirian' },
        { field: 'SK_BUM_Desa', label: 'SK Pendirian BUM Desa' }
      ];

      // Perdes dan SK BUM Desa punya dua jalur: diunggah langsung di halaman ini,
      // atau dipilih desa dari modul Produk Hukum. Keduanya harus terlihat di sini,
      // kalau tidak dokumen yang sudah ada di halaman desa seolah-olah hilang.
      const tautanProdukHukum = [
        {
          relasi: 'produk_hukums_bumdes_produk_hukum_perdes_idToproduk_hukums',
          field: 'Perdes',
          label: 'Perdes Pendirian'
        },
        {
          relasi: 'produk_hukums_bumdes_produk_hukum_sk_bumdes_idToproduk_hukums',
          field: 'SK_BUM_Desa',
          label: 'SK Pendirian BUM Desa'
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
              documents.push(entriDokumen(bumdes, baseUrl, {
                nilai: bumdes[field], folder: 'bumdes_dokumen_badanhukum', field, label,
              }));
            }
          }
        }

        for (const { relasi, field, label } of tautanProdukHukum) {
          const ph = bumdes[relasi];
          if (!ph || !ph.file) continue;

          const filename = ph.file.split('/').pop();
          // Dokumen yang sama bisa tercatat lewat dua jalur (unggahan SPKED
          // ikut didaftarkan ke Produk Hukum) — jangan tampil kembar.
          if (seenFiles.has(`${bumdes.id}_${filename}_${field}`)) continue;
          seenFiles.add(`${bumdes.id}_${filename}_${field}`);

          // Berkas Produk Hukum ada di storage/produk_hukum, BUKAN /uploads.
          documents.push(entriDokumen(bumdes, baseUrl, {
            nilai: filename, field, label,
            jalur: `/storage/produk_hukum/${encodeURIComponent(filename)}`,
            tambahan: {
              // Berkasnya milik arsip Produk Hukum desa; jangan dihapus dari sini.
              sumber: 'produk_hukum',
              produk_hukum: { id: ph.id, judul: ph.judul, nomor: ph.nomor, tahun: ph.tahun },
            },
          }));
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
          LaporanKeuangan2024: true,
          // LPJ tahun berapa pun dari formulir baru.
          LaporanPertanggungjawaban: true
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
              documents.push(entriDokumen(bumdes, baseUrl, {
                nilai: bumdes[field], folder: 'bumdes_laporan_keuangan', field,
                label: `Laporan Pertanggungjawaban ${year}`, tahun: year,
              }));
            }
          }
        }

        for (const lpj of bacaDaftarJson(bumdes.LaporanPertanggungjawaban)) {
          if (!lpj?.berkas) continue;
          const filename = String(lpj.berkas).split('/').pop();
          const uniqueKey = `${bumdes.id}_${filename}_LPJ`;
          if (seenFiles.has(uniqueKey)) continue;
          seenFiles.add(uniqueKey);
          documents.push(entriDokumen(bumdes, baseUrl, {
            nilai: lpj.berkas, folder: 'bumdes_lampiran', field: 'LaporanPertanggungjawaban',
            label: `Laporan Pertanggungjawaban ${lpj.tahun || ''}`.trim(), tahun: lpj.tahun || '',
          }));
        }
      }

      // Sort by year DESC, then bumdes name
      documents.sort((a, b) => {
        const yearDiff = String(b.year || '').localeCompare(String(a.year || ''));
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

  /**
   * GET /api/bumdes/dokumen-pendukung — berkas dari formulir baru di luar
   * dokumen pendirian & LPJ: dokumen ketahanan pangan (kolom berkas biasa),
   * bukti penyerahan PADes, dan MoU kemitraan (di dalam daftar JSON).
   */
  async getDokumenPendukung(req, res, next) {
    try {
      const { bumdes_id } = req.query;
      const baseUrl = process.env.BASE_URL || `${req.protocol}://${req.get('host')}`;

      const allBumdes = await prisma.bumdes.findMany({
        where: bumdes_id ? { id: parseInt(bumdes_id, 10) } : {},
        select: {
          id: true, namabumdesa: true, desa: true, kecamatan: true,
          StudiKelayakanUsaha: true, RABKetahananPangan: true, DokumentasiGeotagging: true,
          RiwayatKontribusiPADes: true, RiwayatKemitraan: true,
        },
      });

      const documents = [];
      for (const b of allBumdes) {
        for (const field of KOLOM_BERKAS_PANGAN) {
          if (!b[field]) continue;
          documents.push(entriDokumen(b, baseUrl, {
            nilai: b[field], folder: 'bumdes_ketahanan_pangan', field, label: LABEL_BERKAS_PANGAN[field],
            tambahan: { kelompok: 'Ketahanan Pangan' },
          }));
        }
        for (const p of bacaDaftarJson(b.RiwayatKontribusiPADes)) {
          if (!p?.bukti) continue;
          documents.push(entriDokumen(b, baseUrl, {
            nilai: p.bukti, folder: FOLDER_LAMPIRAN, field: 'BuktiPADes', tahun: p.tahun,
            label: `Bukti Penyerahan PADes ${p.tahun || ''}`.trim(),
            tambahan: { kelompok: 'Kontribusi PADes' },
          }));
        }
        for (const k of bacaDaftarJson(b.RiwayatKemitraan)) {
          if (!k?.mou) continue;
          documents.push(entriDokumen(b, baseUrl, {
            nilai: k.mou, folder: FOLDER_LAMPIRAN, field: 'MoUKemitraan', tahun: k.tahun,
            label: `MoU Kemitraan${k.mitra ? ` — ${k.mitra}` : ''}`,
            tambahan: { kelompok: 'Kemitraan' },
          }));
        }
      }

      documents.sort((a, b) => a.bumdes_name.localeCompare(b.bumdes_name));
      return res.json({
        status: 'success',
        message: 'Dokumen pendukung berhasil diambil',
        data: documents,
        total: documents.length,
      });
    } catch (error) {
      logger.error('Error getting dokumen pendukung:', error);
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

  /**
   * POST /api/desa/bumdes/produk-hukum
   *
   * Desa membuat Perdes / SK BUM Desa langsung dari formulir BUM Desa.
   *
   * MASALAH YANG DISELESAIKAN. Dasar hukum BUM Desa di halaman desa hanya bisa
   * DIPILIH dari dokumen yang sudah ada di modul Produk Hukum. Padahal hak akses
   * desa diberikan per fitur: banyak operator BUM Desa tidak dipegangi akses
   * "produk-hukum" oleh Admin Desa-nya. Bagi mereka dropdown itu kosong dan
   * tidak ada jalan mengisinya sendiri — datanya macet bukan karena dokumennya
   * tidak ada, melainkan karena pintunya ada di ruangan lain.
   *
   * Yang dibuat di sini BUKAN dokumen kelas dua: barisnya masuk ke tabel
   * produk_hukums yang sama, berkasnya ke folder yang sama, jenis dan
   * singkatannya memakai PADANAN yang sama dengan unggahan SPKED. Jadi dokumen
   * ini juga muncul di modul Produk Hukum untuk petugas desa yang memang
   * memegang akses ke sana.
   *
   * Tautannya ke baris BUM Desa dipasang di sini juga, tidak menunggu formulir
   * disimpan: petugas yang mengunggah lalu menutup halaman tetap mendapat
   * hasilnya, dan formulir yang kemudian disimpan hanya menulis nilai yang sama.
   */
  async storeProdukHukumDesa(req, res, next) {
    // Berkas sudah terlanjur ditulis multer sebelum validasi jalan. Apa pun
    // yang gagal sesudah ini harus membersihkannya, kalau tidak folder produk
    // hukum berisi PDF yatim yang tidak tercatat di mana pun.
    const bersihkanBerkas = async () => {
      if (req.file?.path) {
        await fs.unlink(req.file.path).catch(() => {});
      }
    };

    try {
      const desaId = req.user.desa_id;
      if (!desaId) {
        await bersihkanBerkas();
        return res.status(403).json({
          success: false,
          message: 'Akun Anda tidak terhubung dengan desa mana pun',
        });
      }

      const fieldName = String(req.body.field_name || '').trim();
      const padanan = PADANAN[fieldName];
      if (!padanan) {
        await bersihkanBerkas();
        return res.status(422).json({
          success: false,
          message: `Jenis dokumen tidak dikenali. Pilihannya: ${Object.keys(PADANAN).join(', ')}`,
        });
      }

      if (!req.file) {
        return res.status(422).json({ success: false, message: 'Berkas PDF wajib diunggah' });
      }

      const nomor = String(req.body.nomor || '').trim();
      const tahun = parseInt(req.body.tahun, 10);
      const tanggalPenetapan = req.body.tanggal_penetapan
        ? new Date(req.body.tanggal_penetapan)
        : null;

      if (!nomor) {
        await bersihkanBerkas();
        return res.status(422).json({ success: false, message: 'Nomor dokumen wajib diisi' });
      }

      const tahunSekarang = new Date().getFullYear();
      if (!Number.isInteger(tahun) || tahun < 1945 || tahun > tahunSekarang + 1) {
        await bersihkanBerkas();
        return res.status(422).json({
          success: false,
          message: `Tahun tidak masuk akal. Isi antara 1945 dan ${tahunSekarang + 1}.`,
        });
      }

      if (!tanggalPenetapan || Number.isNaN(tanggalPenetapan.getTime())) {
        await bersihkanBerkas();
        return res.status(422).json({
          success: false,
          message: 'Tanggal penetapan wajib diisi',
        });
      }

      // Nama desa dipakai sebagai tempat penetapan bawaan. Diambil dari basis
      // data, bukan dari kiriman klien: kolom ini muncul di dokumen resmi, dan
      // akun desa tidak berkepentingan menuliskannya sebagai desa lain.
      const desa = await prisma.desas.findUnique({
        where: { id: BigInt(String(desaId)) },
        select: { nama: true, kode: true },
      });

      /**
       * Cari baris BUM Desa milik desa ini lewat DUA kunci.
       *
       * `bumdes.desa_id` adalah kunci yang benar secara skema, tapi seluruh data
       * BUM Desa hasil impor CSV meninggalkannya NULL dan menyambung lewat
       * `kode_desa` (mis. "32.01.11.2001") — 186 dari 187 baris di basis data
       * saat ini seperti itu. Mencari lewat desa_id saja berarti dokumen yang
       * baru diunggah tidak pernah tertaut ke BUM Desa mana pun, padahal
       * barisnya ada.
       *
       * Catatan tipe: desa_id di tabel bumdes bertipe Int, sedangkan di desas
       * dan produk_hukums bertipe BigInt — menyamakan ketiganya akan ditolak
       * Prisma.
       */
      const bumdes = await prisma.bumdes.findFirst({
        where: {
          OR: [
            { desa_id: Number(desaId) },
            ...(desa?.kode ? [{ kode_desa: desa.kode }] : []),
          ],
        },
        select: { id: true, namabumdesa: true },
      });

      const judul =
        String(req.body.judul || '').trim() || padanan.judul(bumdes?.namabumdesa);

      const id = uuidv4();
      const sekarang = new Date();

      const produkHukum = await prisma.produk_hukums.create({
        data: {
          id,
          uuid: id,
          desa_id: BigInt(String(desaId)),
          judul: judul.slice(0, 255),
          nomor: nomor.slice(0, 255),
          tahun,
          jenis: padanan.jenis,
          singkatan_jenis: padanan.singkatan_jenis,
          tempat_penetapan: (desa?.nama || 'Kabupaten Bogor').slice(0, 255),
          tanggal_penetapan: tanggalPenetapan,
          status_peraturan: 'berlaku',
          sumber: 'Diunggah desa lewat modul BUM Desa',
          subjek: 'BUM Desa',
          file: req.file.filename,
          created_at: sekarang,
          updated_at: sekarang,
        },
      });

      // Tautkan ke baris BUM Desa bila desanya sudah punya. Kegagalan di sini
      // tidak menggagalkan permintaan: produk hukumnya sudah sah berdiri
      // sendiri, dan formulir yang disimpan berikutnya akan memasang tautannya.
      let tertaut = false;
      if (bumdes) {
        try {
          await prisma.bumdes.update({
            where: { id: bumdes.id },
            data: { [padanan.kolomRelasi]: id },
          });
          tertaut = true;
        } catch (errTaut) {
          logger.error('Gagal menautkan produk hukum ke BUM Desa:', errTaut);
        }
      }

      logger.info('Produk hukum BUM Desa dibuat desa', {
        id,
        desa_id: String(desaId),
        field_name: fieldName,
        tertaut,
      });

      ActivityLogger.log({
        userId: BigInt(String(req.user.id)),
        userName: req.user.name || req.user.email,
        userRole: req.user.role,
        module: 'bumdes',
        action: 'create',
        entityType: 'produk_hukum',
        entityId: null,
        entityName: judul,
        description: `${req.user.name || req.user.email} membuat ${padanan.singkatan_jenis} "${judul}" (${nomor} Tahun ${tahun}) dari formulir BUM Desa`,
        newValue: { id, nomor, tahun, jenis: padanan.jenis, field_name: fieldName },
        ipAddress: ActivityLogger.getIpFromRequest(req),
        userAgent: ActivityLogger.getUserAgentFromRequest(req),
      }).catch(() => {});

      return res.status(201).json({
        success: true,
        message: tertaut
          ? 'Dokumen tersimpan dan langsung terpasang sebagai dasar hukum BUM Desa'
          : 'Dokumen tersimpan sebagai produk hukum desa',
        data: {
          produk_hukum: produkHukum,
          field_name: fieldName,
          kolom_relasi: padanan.kolomRelasi,
          tertaut,
        },
      });
    } catch (error) {
      await bersihkanBerkas();
      logger.error('Gagal membuat produk hukum dari modul BUM Desa:', error);
      return next(error);
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

      logger.info('Deleting file:', { filename, document_type, bumdes_id, field: req.body.field });

      // Berkas dari formulir baru (LPJ tahun baru, ketahanan pangan, bukti
      // PADes, MoU) punya jalur hapus sendiri.
      if (FIELD_BERKAS_BARU.includes(req.body.field)) {
        return hapusBerkasBaru(req, res);
      }

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

  /**
   * POST /api/desa/bumdes/lampiran — simpan satu berkas lampiran daftar JSON
   * (bukti penyerahan PADes, MoU kemitraan, laporan pertanggungjawaban).
   *
   * Tidak menulis ke basis data: path yang dikembalikan ikut tersimpan
   * bersama daftarnya saat formulir disimpan, dan backend hanya menerima path
   * di folder lampiran (lihat bacaIsian 'berkas' di bumdesFields.js).
   */
  async uploadLampiran(req, res, next) {
    try {
      if (!req.file) {
        return res.status(400).json({ success: false, message: 'Berkas belum dipilih' });
      }
      if (!bolehKelolaBumdes(req.user)) {
        await fs.unlink(req.file.path).catch(() => {});
        return res.status(403).json({ success: false, message: 'Tidak berhak mengunggah lampiran BUMDes' });
      }
      return res.json({
        success: true,
        data: {
          path: `${FOLDER_LAMPIRAN}/${req.file.filename}`,
          nama_asli: req.file.originalname,
          ukuran: req.file.size,
        },
      });
    } catch (error) {
      logger.error('Error uploading BUMDes lampiran:', error);
      next(error);
    }
  }

  /* ───────────────────────── Katalog produk BUM Desa ───────────────────────── */

  /**
   * GET /api/desa/bumdes/katalog-produk — etalase produk SELURUH BUM Desa.
   * Tanpa transaksi: yang ditampilkan hanya informasi & kontak penjualnya.
   * Query: q, kategori, kecamatan, jenis=produk|wisata, unggulan=1, page, limit
   */
  async getKatalogProduk(req, res, next) {
    try {
      const { q, kategori, kecamatan, jenis } = req.query;
      const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 24, 1), 60);
      const page = Math.max(parseInt(req.query.page, 10) || 1, 1);

      // Syarat digabung lewat AND supaya pencarian (OR) dan jenis (OR untuk
      // kategori kosong) tidak saling menimpa.
      const syarat = [{ is_active: true }];
      if (kategori) syarat.push({ kategori: String(kategori) });
      if (jenis === 'wisata') syarat.push({ kategori: { in: KATEGORI_WISATA } });
      if (jenis === 'produk') syarat.push({ OR: [{ kategori: null }, { kategori: { notIn: KATEGORI_WISATA } }] });
      if (req.query.unggulan === '1') syarat.push({ unggulan: true });
      if (kecamatan) syarat.push({ bumdes: { kecamatan: String(kecamatan) } });
      if (q && String(q).trim()) {
        const kata = String(q).trim().slice(0, 100);
        syarat.push({
          OR: [
            { nama: { contains: kata } },
            { deskripsi: { contains: kata } },
            { bumdes: { namabumdesa: { contains: kata } } },
            { bumdes: { desa: { contains: kata } } },
          ],
        });
      }
      const where = { AND: syarat };
      const tigaPuluhHariLalu = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

      const [
        total, produk, totalSemua, perKategori, jumlahUnggulan, bumdesBerproduk, totalBumdes,
        unggulan, kecamatanRows, produkBaru, jumlahWisata,
      ] =
        await Promise.all([
          prisma.bumdes_produk.count({ where }),
          prisma.bumdes_produk.findMany({
            where,
            include: { bumdes: { select: PILIH_BUMDES_KATALOG } },
            orderBy: [{ unggulan: 'desc' }, { updated_at: 'desc' }],
            skip: (page - 1) * limit,
            take: limit,
          }),
          prisma.bumdes_produk.count({ where: { is_active: true } }),
          prisma.bumdes_produk.groupBy({ by: ['kategori'], where: { is_active: true }, _count: { _all: true } }),
          prisma.bumdes_produk.count({ where: { is_active: true, unggulan: true } }),
          prisma.bumdes_produk.groupBy({ by: ['bumdes_id'], where: { is_active: true } }),
          prisma.bumdes.count(),
          prisma.bumdes_produk.findMany({
            where: { is_active: true, unggulan: true },
            include: { bumdes: { select: PILIH_BUMDES_KATALOG } },
            orderBy: { updated_at: 'desc' },
            take: 6,
          }),
          prisma.bumdes.findMany({
            where: { bumdes_produk: { some: { is_active: true } } },
            select: { kecamatan: true },
            distinct: ['kecamatan'],
            orderBy: { kecamatan: 'asc' },
          }),
          prisma.bumdes_produk.count({ where: { is_active: true, created_at: { gte: tigaPuluhHariLalu } } }),
          prisma.bumdes_produk.count({ where: { is_active: true, kategori: { in: KATEGORI_WISATA } } }),
        ]);

      return res.json({
        success: true,
        data: {
          produk: produk.map(bentukProduk),
          unggulan: unggulan.map(bentukProduk),
          halaman: { page, limit, total, total_halaman: Math.max(1, Math.ceil(total / limit)) },
          ringkasan: {
            total_produk: totalSemua,
            bumdes_berproduk: bumdesBerproduk.length,
            total_bumdes: totalBumdes,
            jumlah_kategori: perKategori.filter((k) => k.kategori).length,
            produk_unggulan: jumlahUnggulan,
            // Angka nyata untuk penanda tren di kartu statistik.
            produk_baru_30_hari: produkBaru,
            jumlah_wisata: jumlahWisata,
            jumlah_kecamatan: kecamatanRows.filter((k) => k.kecamatan).length,
          },
          kategori: perKategori
            .filter((k) => k.kategori)
            .map((k) => ({ nama: k.kategori, jumlah: k._count._all }))
            .sort((a, b) => b.jumlah - a.jumlah),
          kecamatan: kecamatanRows.map((k) => k.kecamatan).filter(Boolean),
          kategori_opsi: KATEGORI_PRODUK,
        },
      });
    } catch (error) {
      logger.error('Error getting katalog produk BUMDes:', error);
      next(error);
    }
  }

  /** GET /api/desa/bumdes/produk?bumdes_id= — produk milik satu BUM Desa. */
  async getProdukBumdes(req, res, next) {
    try {
      const bumdes = await cariBumdesKelolaan(req, req.query.bumdes_id);
      if (bumdes.galat) return res.status(bumdes.status).json({ success: false, message: bumdes.galat });
      const produk = await prisma.bumdes_produk.findMany({
        where: { bumdes_id: bumdes.id },
        include: { bumdes: { select: PILIH_BUMDES_KATALOG } },
        orderBy: [{ unggulan: 'desc' }, { created_at: 'desc' }],
      });
      return res.json({ success: true, data: produk.map(bentukProduk), kategori_opsi: KATEGORI_PRODUK });
    } catch (error) {
      logger.error('Error getting produk BUMDes:', error);
      next(error);
    }
  }

  /** POST /api/desa/bumdes/produk (multipart: foto) */
  async storeProdukBumdes(req, res, next) {
    try {
      const bumdes = await cariBumdesKelolaan(req, req.body.bumdes_id);
      if (bumdes.galat) return res.status(bumdes.status).json({ success: false, message: bumdes.galat });

      const isian = bacaIsianProduk(req.body);
      if (isian.galat) return res.status(400).json({ success: false, message: isian.galat });
      if (isian.data.unggulan) {
        const galat = await cekBatasUnggulan(bumdes.id);
        if (galat) return res.status(400).json({ success: false, message: galat });
      }

      const sekarang = new Date();
      let produk = await prisma.bumdes_produk.create({
        data: {
          ...isian.data,
          bumdes_id: bumdes.id,
          desa_id: bumdes.desa_id ? BigInt(bumdes.desa_id) : null,
          created_by: BigInt(String(req.user.id)),
          created_at: sekarang,
          updated_at: sekarang,
        },
      });
      if (req.file) {
        const foto = await simpanFotoProduk(req.file.buffer, produk.id);
        produk = await prisma.bumdes_produk.update({ where: { id: produk.id }, data: { foto } });
      }

      logger.info(`Produk BUMDes ${produk.id} ditambahkan untuk bumdes ${bumdes.id} oleh ${req.user.email}`);
      return res.status(201).json({ success: true, message: 'Produk berhasil ditambahkan', data: bentukProduk(produk) });
    } catch (error) {
      logger.error('Error storing produk BUMDes:', error);
      next(error);
    }
  }

  /** PUT /api/desa/bumdes/produk/:produkId (multipart: foto opsional, hapus_foto=1) */
  async updateProdukBumdes(req, res, next) {
    try {
      const lama = await cariProdukKelolaan(req, req.params.produkId);
      if (lama.galat) return res.status(lama.status).json({ success: false, message: lama.galat });

      const isian = bacaIsianProduk(req.body);
      if (isian.galat) return res.status(400).json({ success: false, message: isian.galat });
      if (isian.data.unggulan && !lama.unggulan) {
        const galat = await cekBatasUnggulan(lama.bumdes_id);
        if (galat) return res.status(400).json({ success: false, message: galat });
      }

      const data = { ...isian.data, updated_at: new Date() };
      if (req.file) {
        data.foto = await simpanFotoProduk(req.file.buffer, lama.id);
        hapusFotoProduk(lama.foto);
      } else if (req.body.hapus_foto === '1') {
        data.foto = null;
        hapusFotoProduk(lama.foto);
      }

      const produk = await prisma.bumdes_produk.update({ where: { id: lama.id }, data });
      return res.json({ success: true, message: 'Produk diperbarui', data: bentukProduk(produk) });
    } catch (error) {
      logger.error('Error updating produk BUMDes:', error);
      next(error);
    }
  }

  /** DELETE /api/desa/bumdes/produk/:produkId */
  async deleteProdukBumdes(req, res, next) {
    try {
      const lama = await cariProdukKelolaan(req, req.params.produkId);
      if (lama.galat) return res.status(lama.status).json({ success: false, message: lama.galat });
      await prisma.bumdes_produk.delete({ where: { id: lama.id } });
      hapusFotoProduk(lama.foto);
      return res.json({ success: true, message: 'Produk dihapus' });
    } catch (error) {
      logger.error('Error deleting produk BUMDes:', error);
      next(error);
    }
  }

}

/* ─────────────────── Hapus berkas dari formulir baru ─────────────────── */

// Field "virtual" yang dikirim halaman Kelola Dokumen untuk berkas di dalam
// daftar JSON, ditambah kolom berkas ketahanan pangan.
const FIELD_BERKAS_BARU = ['LaporanPertanggungjawaban', 'BuktiPADes', 'MoUKemitraan', ...KOLOM_BERKAS_PANGAN];

const hapusBerkasBaru = async (req, res) => {
  const { filename, bumdes_id, field } = req.body;
  const nama = path.basename(String(filename || ''));
  const id = parseInt(bumdes_id, 10);
  if (!nama || !id) {
    return res.status(400).json({ success: false, message: 'filename dan bumdes_id wajib diisi' });
  }

  const bumdes = await prisma.bumdes.findUnique({ where: { id } });
  if (!bumdes) return res.status(404).json({ success: false, message: 'BUMDes tidak ditemukan' });
  if (req.user.role === 'desa' && Number(bumdes.desa_id) !== Number(req.user.desa_id)) {
    return res.status(403).json({ success: false, message: 'Berkas ini bukan milik BUMDes desa Anda' });
  }

  const cocok = (v) => v && path.basename(String(v)) === nama;
  let data = null;
  let folder = FOLDER_LAMPIRAN;

  if (KOLOM_BERKAS_PANGAN.includes(field)) {
    if (!cocok(bumdes[field])) return res.status(404).json({ success: false, message: 'Berkas tidak ditemukan pada BUMDes ini' });
    data = { [field]: null };
    folder = 'bumdes_ketahanan_pangan';
  } else {
    const kolom = { LaporanPertanggungjawaban: 'LaporanPertanggungjawaban', BuktiPADes: 'RiwayatKontribusiPADes', MoUKemitraan: 'RiwayatKemitraan' }[field];
    const kunci = { LaporanPertanggungjawaban: 'berkas', BuktiPADes: 'bukti', MoUKemitraan: 'mou' }[field];
    const daftar = bacaDaftarJson(bumdes[kolom]);
    if (!daftar.some((b) => cocok(b?.[kunci]))) {
      return res.status(404).json({ success: false, message: 'Berkas tidak ditemukan pada BUMDes ini' });
    }
    // LPJ: barisnya dibuang (LPJ tanpa berkas tidak bermakna). PADes & MoU:
    // hanya lampirannya yang dilepas — angka kontribusi/mitra tetap tercatat.
    const baru = field === 'LaporanPertanggungjawaban'
      ? daftar.filter((b) => !cocok(b?.[kunci]))
      : daftar.map((b) => {
        if (!cocok(b?.[kunci])) return b;
        const { [kunci]: _dibuang, ...sisa } = b;
        return sisa;
      });
    data = { [kolom]: JSON.stringify(baru) };
  }

  await prisma.bumdes.update({ where: { id }, data: { ...data, updated_at: new Date() } });

  // Hanya berkas di dalam folder yang semestinya yang boleh dihapus.
  const target = path.resolve(path.join(__dirname, '../../storage/uploads', folder, nama));
  if (target.startsWith(path.resolve(path.join(__dirname, '../../storage/uploads', folder)))) {
    await fs.unlink(target).catch((e) => logger.warn(`Berkas fisik tidak terhapus: ${target} — ${e.message}`));
  }

  logger.info(`Berkas ${field} ${nama} dihapus dari BUMDes ${id} oleh ${req.user.email}`);
  return res.json({ success: true, message: 'File berhasil dihapus', deleted_file: nama, updated_records: 1 });
};

/* ─────────────────────── Pembantu katalog produk ─────────────────────── */

const KATEGORI_PRODUK = [
  'Makanan & Minuman', 'Makanan Ringan', 'Hasil Pertanian', 'Perkebunan',
  'Peternakan', 'Perikanan', 'Produk Olahan', 'Kerajinan Tangan',
  'Fashion & Aksesoris', 'Produk Herbal', 'Kesehatan & Kecantikan', 'Jasa',
  'Wisata Desa', 'Lainnya',
];
// Nama kategori versi pertama katalog — tetap diterima supaya produk lama
// masih bisa disimpan ulang, tapi tidak lagi ditawarkan di pilihan.
const KATEGORI_PRODUK_LAMA = ['Pertanian', 'Kerajinan', 'Fashion & Tekstil', 'Wisata'];
// Kategori yang dihitung sebagai WISATA desa (tab Wisata Desa di katalog).
const KATEGORI_WISATA = ['Wisata Desa', 'Wisata'];

/** Nomor HP/WA → 62xxxxxxxxxx (format wa.me); null bila tidak masuk akal. */
const nomorWhatsapp = (v) => {
  let d = String(v || '').replace(/[^\d]/g, '');
  if (!d) return null;
  if (d.startsWith('0')) d = `62${d.slice(1)}`;
  else if (d.startsWith('8')) d = `62${d}`;
  return /^62\d{8,13}$/.test(d) ? d : null;
};
const MAKS_UNGGULAN = 3;
const FOLDER_PRODUK = 'bumdes_produk';
const DIR_PRODUK = path.join(__dirname, '../../storage/uploads', FOLDER_PRODUK);
const ROLE_SPKED = ['pegawai', 'kepala_bidang', 'kepala_dinas', 'ketua_tim'];

const PILIH_BUMDES_KATALOG = {
  id: true, namabumdesa: true, desa: true, kecamatan: true,
  TelfonBumdes: true, HPDirektur: true, MediaSosial: true,
};

/** Desa (miliknya sendiri), SPKED (bidang 3), dan admin boleh mengelola. */
const bolehKelolaBumdes = (user) => {
  if (!user) return false;
  if (user.role === 'desa') return Boolean(user.desa_id);
  if (['dinas', 'superadmin', 'sarana_prasarana'].includes(user.role)) return true;
  return ROLE_SPKED.includes(user.role) && Number(user.bidang_id) === 3;
};

const cariBumdesKelolaan = async (req, bumdesId) => {
  if (!bolehKelolaBumdes(req.user)) return { galat: 'Tidak berhak mengelola produk BUMDes', status: 403 };
  const where = req.user.role === 'desa'
    ? { desa_id: Number(req.user.desa_id) }
    : { id: parseInt(bumdesId, 10) || -1 };
  const bumdes = await prisma.bumdes.findFirst({ where, select: { id: true, desa_id: true } });
  if (!bumdes) {
    return {
      galat: req.user.role === 'desa'
        ? 'Simpan data BUMDes terlebih dahulu sebelum menambahkan produk'
        : 'BUMDes tidak ditemukan',
      status: 404,
    };
  }
  return bumdes;
};

const cariProdukKelolaan = async (req, produkId) => {
  let id;
  try { id = BigInt(String(produkId)); } catch { return { galat: 'Produk tidak valid', status: 400 }; }
  const produk = await prisma.bumdes_produk.findUnique({ where: { id }, include: { bumdes: { select: { desa_id: true } } } });
  if (!produk) return { galat: 'Produk tidak ditemukan', status: 404 };
  if (!bolehKelolaBumdes(req.user)) return { galat: 'Tidak berhak mengelola produk BUMDes', status: 403 };
  if (req.user.role === 'desa' && Number(produk.bumdes?.desa_id) !== Number(req.user.desa_id)) {
    return { galat: 'Produk ini bukan milik BUMDes desa Anda', status: 403 };
  }
  return produk;
};

const bacaIsianProduk = (body) => {
  const teks = (v, maks) => { const s = String(v ?? '').trim(); return s ? s.slice(0, maks) : null; };
  const nama = teks(body.nama, 255);
  if (!nama) return { galat: 'Nama produk wajib diisi' };

  const kategori = teks(body.kategori, 100);
  if (kategori && ![...KATEGORI_PRODUK, ...KATEGORI_PRODUK_LAMA].includes(kategori)) {
    return { galat: 'Kategori produk tidak dikenal' };
  }

  // Nomor WhatsApp penjual — tujuan tombol "Pesan" di katalog.
  let whatsapp = null;
  if (String(body.whatsapp ?? '').trim()) {
    whatsapp = nomorWhatsapp(body.whatsapp);
    if (!whatsapp) return { galat: 'Nomor WhatsApp tidak valid. Contoh: 081234567890' };
  }

  let harga = null;
  if (body.harga !== undefined && String(body.harga).trim() !== '') {
    const hasil = bacaAngka(body.harga);
    if (!hasil.ok || hasil.nilai < 0) return { galat: 'Harga tidak valid' };
    harga = hasil.nilai;
  }

  let tautan = teks(body.tautan, 500);
  if (tautan && !/^https?:\/\//i.test(tautan)) tautan = `https://${tautan}`;

  const benar = (v) => ['1', 'true', 'on', true, 1].includes(v);
  return {
    data: {
      nama,
      kategori,
      deskripsi: teks(body.deskripsi, 2000),
      harga,
      satuan: teks(body.satuan, 50),
      tautan,
      // Hanya ditulis bila dikirim, supaya klien lama tidak mengosongkannya.
      ...(body.whatsapp !== undefined ? { whatsapp } : {}),
      unggulan: benar(body.unggulan),
      is_active: body.is_active === undefined ? true : benar(body.is_active),
    },
  };
};

const cekBatasUnggulan = async (bumdesId) => {
  const n = await prisma.bumdes_produk.count({ where: { bumdes_id: bumdesId, unggulan: true } });
  return n >= MAKS_UNGGULAN ? `Maksimal ${MAKS_UNGGULAN} produk unggulan per BUMDes` : null;
};

/** Foto selalu di-re-encode ke WebP; .rotate() mengikuti orientasi EXIF foto HP. */
const simpanFotoProduk = async (buffer, produkId) => {
  const sharp = require('sharp');
  await fs.mkdir(DIR_PRODUK, { recursive: true });
  const nama = `produk_${produkId}_${Date.now()}.webp`;
  await sharp(buffer)
    .rotate()
    .resize(1000, 1000, { fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 80 })
    .toFile(path.join(DIR_PRODUK, nama));
  return `${FOLDER_PRODUK}/${nama}`;
};

const hapusFotoProduk = (foto) => {
  if (!foto) return;
  const target = path.resolve(path.join(__dirname, '../../storage/uploads', foto));
  if (!target.startsWith(path.resolve(DIR_PRODUK))) return;
  fs.unlink(target).catch(() => {});
};

const bacaJson = (s, cadangan) => {
  if (!s) return cadangan;
  try { return JSON.parse(s); } catch { return cadangan; }
};

const bentukProduk = (p) => ({
  id: String(p.id),
  bumdes_id: p.bumdes_id,
  nama: p.nama,
  kategori: p.kategori,
  deskripsi: p.deskripsi,
  harga: p.harga === null || p.harga === undefined ? null : Number(p.harga),
  satuan: p.satuan,
  foto: p.foto,
  tautan: p.tautan,
  jenis: KATEGORI_WISATA.includes(p.kategori) ? 'wisata' : 'produk',
  // Nomor yang diisi penjual untuk produk ini (untuk formulir).
  whatsapp_produk: p.whatsapp || null,
  // Tujuan tombol Pesan: nomor produk → telepon BUM Desa → HP Direktur.
  whatsapp: p.whatsapp
    || nomorWhatsapp(p.bumdes?.TelfonBumdes)
    || nomorWhatsapp(p.bumdes?.HPDirektur)
    || null,
  unggulan: p.unggulan,
  is_active: p.is_active,
  created_at: p.created_at,
  updated_at: p.updated_at,
  bumdes: p.bumdes && p.bumdes.namabumdesa !== undefined
    ? {
      id: p.bumdes.id,
      nama: p.bumdes.namabumdesa,
      desa: p.bumdes.desa,
      kecamatan: p.bumdes.kecamatan,
      telepon: p.bumdes.TelfonBumdes,
      media_sosial: bacaJson(p.bumdes.MediaSosial, {}),
    }
    : undefined,
});

function formatBytes(bytes, decimals = 2) {
  if (bytes === 0) return '0 Bytes';

  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];

  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

module.exports = new BumdesController();
