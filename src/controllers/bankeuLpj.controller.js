const prisma = require('../config/prisma');
const sequelize = require('../config/database');
const logger = require('../utils/logger');
const path = require('path');
const fs = require('fs');

class BankeuLpjController {
  /**
   * Get LPJ for logged-in desa
   * GET /api/desa/bankeu-lpj?tahun=2025
   */
  async getMyLpj(req, res) {
    try {
      const userId = req.user.id;
      const tahun = parseInt(req.query.tahun) || 2025;

      // Get desa_id from user
      const user = await prisma.users.findUnique({
        where: { id: BigInt(userId) },
        select: { desa_id: true }
      });

      if (!user || !user.desa_id) {
        return res.status(403).json({
          success: false,
          message: 'User tidak terkait dengan desa manapun'
        });
      }

      const lpjList = await prisma.bankeu_lpj.findMany({
        where: {
          desa_id: user.desa_id,
          tahun_anggaran: tahun
        },
        orderBy: { created_at: 'desc' }
      });

      res.json({
        success: true,
        data: lpjList
      });
    } catch (error) {
      logger.error('Error fetching LPJ:', error);
      res.status(500).json({
        success: false,
        message: 'Gagal mengambil data LPJ',
        error: error.message
      });
    }
  }

  /**
   * Upload LPJ file(s) - supports multiple files
   * POST /api/desa/bankeu-lpj/upload
   */
  async uploadLpj(req, res) {
    try {
      const userId = req.user.id;
      const tahun = parseInt(req.body.tahun_anggaran) || 2025;
      const keterangan = req.body.keterangan || null;

      const files = req.files;
      if (!files || files.length === 0) {
        return res.status(400).json({
          success: false,
          message: 'File LPJ harus diupload. Pilih minimal satu file PDF.',
          error_code: 'NO_FILE'
        });
      }

      // Get desa_id and kecamatan_id from user
      const user = await prisma.users.findUnique({
        where: { id: BigInt(userId) },
        select: { desa_id: true }
      });

      if (!user || !user.desa_id) {
        // Remove uploaded files
        files.forEach(f => { try { if (f.path) fs.unlinkSync(f.path); } catch (e) {} });
        return res.status(403).json({
          success: false,
          message: 'User tidak terkait dengan desa manapun'
        });
      }

      // Get kecamatan_id from desa
      const desa = await prisma.desas.findUnique({
        where: { id: user.desa_id },
        select: { kecamatan_id: true }
      });

      if (!desa || !desa.kecamatan_id) {
        files.forEach(f => { try { if (f.path) fs.unlinkSync(f.path); } catch (e) {} });
        return res.status(403).json({
          success: false,
          message: 'Desa tidak terkait dengan kecamatan manapun'
        });
      }

      // Create target directory: bankeu_lpj/{kecamatan_id}/{desa_id}/
      const targetDir = path.join(__dirname, '../../storage/uploads/bankeu_lpj', String(desa.kecamatan_id), String(user.desa_id));
      if (!fs.existsSync(targetDir)) {
        fs.mkdirSync(targetDir, { recursive: true });
      }

      // Move files from temp to target directory and create records
      const createdLpjs = [];
      for (const file of files) {
        const targetPath = path.join(targetDir, file.filename);
        fs.renameSync(file.path, targetPath);

        // Store relative path: {kecamatan_id}/{desa_id}/{filename}
        const relativePath = `${desa.kecamatan_id}/${user.desa_id}/${file.filename}`;

        const lpj = await prisma.bankeu_lpj.create({
          data: {
            desa_id: user.desa_id,
            tahun_anggaran: tahun,
            nama_file: file.originalname,
            file_path: relativePath,
            file_size: file.size,
            keterangan,
            uploaded_by: BigInt(userId)
          }
        });
        createdLpjs.push(lpj);
      }

      logger.info(`LPJ Bankeu uploaded: desa_id=${user.desa_id}, kecamatan_id=${desa.kecamatan_id}, tahun=${tahun}, files=${files.length}`);

      res.status(201).json({
        success: true,
        message: `${files.length} file LPJ berhasil diupload`,
        data: createdLpjs
      });
    } catch (error) {
      // Remove uploaded files on error
      if (req.files) {
        req.files.forEach(f => { try { if (f.path) fs.unlinkSync(f.path); } catch (e) {} });
      }
      logger.error('Error uploading LPJ:', error);
      res.status(500).json({
        success: false,
        message: 'Gagal mengupload LPJ. Silakan coba lagi.',
        error: error.message
      });
    }
  }

  /**
   * Delete LPJ file
   * DELETE /api/desa/bankeu-lpj/:id
   */
  async deleteLpj(req, res) {
    try {
      const userId = req.user.id;
      const lpjId = BigInt(req.params.id);

      // Get user's desa
      const user = await prisma.users.findUnique({
        where: { id: BigInt(userId) },
        select: { desa_id: true }
      });

      if (!user || !user.desa_id) {
        return res.status(403).json({
          success: false,
          message: 'User tidak terkait dengan desa manapun'
        });
      }

      // Find the LPJ and verify ownership
      const lpj = await prisma.bankeu_lpj.findFirst({
        where: {
          id: lpjId,
          desa_id: user.desa_id
        }
      });

      if (!lpj) {
        return res.status(404).json({
          success: false,
          message: 'Data LPJ tidak ditemukan'
        });
      }

      // Cannot delete if approved
      if (lpj.status === 'approved') {
        return res.status(400).json({
          success: false,
          message: 'LPJ yang sudah disetujui tidak dapat dihapus'
        });
      }

      // Delete file
      const filePath = path.join(__dirname, '../../storage/uploads/bankeu_lpj', lpj.file_path);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }

      // Delete record
      await prisma.bankeu_lpj.delete({
        where: { id: lpjId }
      });

      logger.info(`LPJ Bankeu deleted: id=${lpjId}, desa_id=${user.desa_id}`);

      res.json({
        success: true,
        message: 'LPJ berhasil dihapus'
      });
    } catch (error) {
      logger.error('Error deleting LPJ:', error);
      res.status(500).json({
        success: false,
        message: 'Gagal menghapus LPJ',
        error: error.message
      });
    }
  }

  /**
   * DPMD/SPKED: Get all LPJ submissions grouped by kecamatan
   * GET /api/dpmd/bankeu-lpj?tahun=2025
   */
  async getAllLpj(req, res) {
    try {
      const tahun = parseInt(req.query.tahun) || 2025;

      // Get all desa with their kecamatan, and left join LPJ data (multiple per desa)
      const [rows] = await sequelize.query(`
        SELECT 
          d.id as desa_id,
          d.nama as desa_nama,
          d.kode as desa_kode,
          k.id as kecamatan_id,
          k.nama as kecamatan_nama,
          l.id as lpj_id,
          l.nama_file,
          l.file_path,
          l.file_size,
          l.keterangan,
          l.status as lpj_status,
          l.dpmd_catatan,
          l.dpmd_verified_by,
          l.dpmd_verified_at,
          l.uploaded_by,
          l.created_at as lpj_created_at,
          l.updated_at as lpj_updated_at,
          u.name as uploaded_by_name,
          v.name as verified_by_name
        FROM desas d
        JOIN kecamatans k ON d.kecamatan_id = k.id
        LEFT JOIN bankeu_lpj l ON l.desa_id = d.id AND l.tahun_anggaran = :tahun
        LEFT JOIN users u ON l.uploaded_by = u.id
        LEFT JOIN users v ON l.dpmd_verified_by = v.id
        WHERE d.status_pemerintahan = 'desa'
        ORDER BY k.nama, d.nama, l.created_at DESC
      `, {
        replacements: { tahun }
      });

      // Group by kecamatan, then by desa (handle multiple LPJ per desa)
      const grouped = {};
      const desaTracker = {}; // track unique desa
      let totalDesa = 0;
      let totalUploaded = 0;

      // Count verification statuses
      let totalApproved = 0;
      let totalRejected = 0;
      let totalRevision = 0;
      let totalPending = 0;

      rows.forEach(row => {
        if (!grouped[row.kecamatan_id]) {
          grouped[row.kecamatan_id] = {
            kecamatan_id: row.kecamatan_id,
            kecamatan_nama: row.kecamatan_nama,
            desa_list: [],
            total_desa: 0,
            uploaded_count: 0
          };
        }

        const desaKey = `${row.kecamatan_id}_${row.desa_id}`;
        if (!desaTracker[desaKey]) {
          desaTracker[desaKey] = {
            desa_id: row.desa_id,
            desa_nama: row.desa_nama,
            desa_kode: row.desa_kode,
            has_lpj: false,
            lpj_files: []
          };
          grouped[row.kecamatan_id].desa_list.push(desaTracker[desaKey]);
          grouped[row.kecamatan_id].total_desa++;
          totalDesa++;
        }

        if (row.lpj_id) {
          if (!desaTracker[desaKey].has_lpj) {
            desaTracker[desaKey].has_lpj = true;
            grouped[row.kecamatan_id].uploaded_count++;
            totalUploaded++;
          }

          const lpjItem = {
            id: row.lpj_id,
            nama_file: row.nama_file,
            file_path: row.file_path,
            file_size: row.file_size,
            keterangan: row.keterangan,
            status: row.lpj_status || 'pending',
            dpmd_catatan: row.dpmd_catatan,
            dpmd_verified_by: row.dpmd_verified_by,
            dpmd_verified_at: row.dpmd_verified_at,
            verified_by_name: row.verified_by_name,
            uploaded_by: row.uploaded_by,
            uploaded_by_name: row.uploaded_by_name,
            created_at: row.lpj_created_at,
            updated_at: row.lpj_updated_at
          };
          desaTracker[desaKey].lpj_files.push(lpjItem);

          if (row.lpj_status === 'approved') totalApproved++;
          else if (row.lpj_status === 'rejected') totalRejected++;
          else if (row.lpj_status === 'revision') totalRevision++;
          else totalPending++;
        }
      });

      res.json({
        success: true,
        data: {
          tahun_anggaran: tahun,
          summary: {
            total_desa: totalDesa,
            total_uploaded: totalUploaded,
            total_belum: totalDesa - totalUploaded,
            total_approved: totalApproved,
            total_rejected: totalRejected,
            total_revision: totalRevision,
            total_pending: totalPending,
            persentase: totalDesa > 0 ? Math.round((totalUploaded / totalDesa) * 100) : 0
          },
          kecamatan: Object.values(grouped)
        }
      });
    } catch (error) {
      logger.error('Error fetching all LPJ:', error);
      res.status(500).json({
        success: false,
        message: 'Gagal mengambil data LPJ',
        error: error.message
      });
    }
  }

  /**
   * DPMD: Verify LPJ (approve/reject/revision)
   * PUT /api/dpmd/bankeu-lpj/:id/verify
   * Body: { action: 'approved'|'rejected'|'revision', catatan?: string }
   */
  async verifyLpj(req, res) {
    try {
      const lpjId = BigInt(req.params.id);
      const userId = BigInt(req.user.id);
      const { action, catatan } = req.body;

      if (!['approved', 'rejected', 'revision'].includes(action)) {
        return res.status(400).json({
          success: false,
          message: 'Action tidak valid. Gunakan: approved, rejected, atau revision'
        });
      }

      // Catatan wajib untuk reject/revision
      if (['rejected', 'revision'].includes(action) && !catatan?.trim()) {
        return res.status(400).json({
          success: false,
          message: 'Catatan wajib diisi untuk penolakan atau revisi'
        });
      }

      const lpj = await prisma.bankeu_lpj.findUnique({
        where: { id: lpjId },
        include: { desas: { select: { nama: true } } }
      });

      if (!lpj) {
        return res.status(404).json({
          success: false,
          message: 'Data LPJ tidak ditemukan'
        });
      }

      const updated = await prisma.bankeu_lpj.update({
        where: { id: lpjId },
        data: {
          status: action,
          dpmd_catatan: catatan?.trim() || null,
          dpmd_verified_by: userId,
          dpmd_verified_at: new Date(),
          updated_at: new Date()
        }
      });

      // Auto-create chat conversation when revision is requested
      if (action === 'revision') {
        try {
          const { createVerificationChat } = require('./messaging.controller');
          await createVerificationChat(
            userId,                          // reviewer (DPMD staff)
            lpj.uploaded_by,                 // desa user who uploaded
            req.user.role || 'pegawai',      // reviewer role
            'desa',                          // desa role
            'bankeu_lpj',                    // reference type
            lpjId,                           // reference id
            `📋 Revisi LPJ Bankeu - ${lpj.desas?.nama || 'Desa'}\n\nCatatan: ${catatan?.trim()}`
          );
        } catch (chatErr) {
          logger.error('Failed to create verification chat:', chatErr.message);
        }
      }

      const actionLabels = { approved: 'disetujui', rejected: 'ditolak', revision: 'perlu revisi' };
      logger.info(`LPJ Bankeu verified: id=${lpjId}, desa=${lpj.desas?.nama}, action=${action}, by=${userId}`);

      res.json({
        success: true,
        message: `LPJ Desa ${lpj.desas?.nama || ''} berhasil ${actionLabels[action]}`,
        data: updated
      });
    } catch (error) {
      logger.error('Error verifying LPJ:', error);
      res.status(500).json({
        success: false,
        message: 'Gagal memverifikasi LPJ',
        error: error.message
      });
    }
  }

  /**
   * DPMD/Admin: Delete LPJ file (admin bidang SPKED)
   * DELETE /api/dpmd/bankeu-lpj/:id
   */
  async adminDeleteLpj(req, res) {
    try {
      const lpjId = BigInt(req.params.id);
      const userId = req.user.id;

      const lpj = await prisma.bankeu_lpj.findUnique({
        where: { id: lpjId },
        include: { desas: { select: { nama: true } } }
      });

      if (!lpj) {
        return res.status(404).json({
          success: false,
          message: 'Data LPJ tidak ditemukan'
        });
      }

      // Delete physical file
      const filePath = path.join(__dirname, '../../storage/uploads/bankeu_lpj', lpj.file_path);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }

      // Delete record
      await prisma.bankeu_lpj.delete({
        where: { id: lpjId }
      });

      logger.info(`LPJ Bankeu admin-deleted: id=${lpjId}, desa=${lpj.desas?.nama}, by=${userId}`);

      res.json({
        success: true,
        message: `LPJ Desa ${lpj.desas?.nama || ''} berhasil dihapus`
      });
    } catch (error) {
      logger.error('Error admin deleting LPJ:', error);
      res.status(500).json({
        success: false,
        message: 'Gagal menghapus LPJ',
        error: error.message
      });
    }
  }
}

module.exports = new BankeuLpjController();
