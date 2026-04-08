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

      const lpj = await prisma.bankeu_lpj.findUnique({
        where: {
          desa_id_tahun_anggaran: {
            desa_id: user.desa_id,
            tahun_anggaran: tahun
          }
        }
      });

      res.json({
        success: true,
        data: lpj
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
   * Upload or replace LPJ file
   * POST /api/desa/bankeu-lpj/upload
   */
  async uploadLpj(req, res) {
    try {
      const userId = req.user.id;
      const tahun = parseInt(req.body.tahun_anggaran) || 2025;
      const keterangan = req.body.keterangan || null;

      if (!req.file) {
        return res.status(400).json({
          success: false,
          message: 'File LPJ harus diupload'
        });
      }

      // Get desa_id from user
      const user = await prisma.users.findUnique({
        where: { id: BigInt(userId) },
        select: { desa_id: true }
      });

      if (!user || !user.desa_id) {
        // Remove uploaded file
        if (req.file?.path) fs.unlinkSync(req.file.path);
        return res.status(403).json({
          success: false,
          message: 'User tidak terkait dengan desa manapun'
        });
      }

      // Check if LPJ already exists for this desa+tahun
      const existing = await prisma.bankeu_lpj.findUnique({
        where: {
          desa_id_tahun_anggaran: {
            desa_id: user.desa_id,
            tahun_anggaran: tahun
          }
        }
      });

      if (existing) {
        // Delete old file
        const oldFilePath = path.join(__dirname, '../../storage/uploads/bankeu_lpj', existing.file_path);
        if (fs.existsSync(oldFilePath)) {
          fs.unlinkSync(oldFilePath);
        }

        // Update existing record
        const updated = await prisma.bankeu_lpj.update({
          where: { id: existing.id },
          data: {
            nama_file: req.file.originalname,
            file_path: req.file.filename,
            file_size: req.file.size,
            keterangan,
            uploaded_by: BigInt(userId),
            updated_at: new Date()
          }
        });

        logger.info(`LPJ Bankeu updated: desa_id=${user.desa_id}, tahun=${tahun}, file=${req.file.filename}`);

        return res.json({
          success: true,
          message: 'File LPJ berhasil diperbarui',
          data: updated
        });
      }

      // Create new record
      const lpj = await prisma.bankeu_lpj.create({
        data: {
          desa_id: user.desa_id,
          tahun_anggaran: tahun,
          nama_file: req.file.originalname,
          file_path: req.file.filename,
          file_size: req.file.size,
          keterangan,
          uploaded_by: BigInt(userId)
        }
      });

      logger.info(`LPJ Bankeu created: desa_id=${user.desa_id}, tahun=${tahun}, file=${req.file.filename}`);

      res.status(201).json({
        success: true,
        message: 'File LPJ berhasil diupload',
        data: lpj
      });
    } catch (error) {
      // Remove uploaded file on error
      if (req.file?.path) {
        try { fs.unlinkSync(req.file.path); } catch (e) {}
      }
      logger.error('Error uploading LPJ:', error);
      res.status(500).json({
        success: false,
        message: 'Gagal mengupload LPJ',
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

      // Get all desa with their kecamatan, and left join LPJ data
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
          l.uploaded_by,
          l.created_at as lpj_created_at,
          l.updated_at as lpj_updated_at,
          u.name as uploaded_by_name
        FROM desas d
        JOIN kecamatans k ON d.kecamatan_id = k.id
        LEFT JOIN bankeu_lpj l ON l.desa_id = d.id AND l.tahun_anggaran = :tahun
        LEFT JOIN users u ON l.uploaded_by = u.id
        WHERE d.status_pemerintahan = 'desa'
        ORDER BY k.nama, d.nama
      `, {
        replacements: { tahun }
      });

      // Group by kecamatan
      const grouped = {};
      let totalDesa = 0;
      let totalUploaded = 0;

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

        const desaItem = {
          desa_id: row.desa_id,
          desa_nama: row.desa_nama,
          desa_kode: row.desa_kode,
          has_lpj: !!row.lpj_id,
          lpj: row.lpj_id ? {
            id: row.lpj_id,
            nama_file: row.nama_file,
            file_path: row.file_path,
            file_size: row.file_size,
            keterangan: row.keterangan,
            uploaded_by: row.uploaded_by,
            uploaded_by_name: row.uploaded_by_name,
            created_at: row.lpj_created_at,
            updated_at: row.lpj_updated_at
          } : null
        };

        grouped[row.kecamatan_id].desa_list.push(desaItem);
        grouped[row.kecamatan_id].total_desa++;
        totalDesa++;

        if (row.lpj_id) {
          grouped[row.kecamatan_id].uploaded_count++;
          totalUploaded++;
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
}

module.exports = new BankeuLpjController();
