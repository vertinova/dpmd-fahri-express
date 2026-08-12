const prisma = require('../config/prisma');
const sequelize = require('../config/database');
const logger = require('../utils/logger');
const path = require('path');
const fs = require('fs');

const TABLE_NAME = 'bantuan_provinsi_lpj';
const STORAGE_DIR = 'bantuan_provinsi_lpj';
const REFERENCE_TYPE = 'bantuan_provinsi_lpj';
const PROGRAM_LABEL = 'Bantuan Provinsi';

function cleanupFiles(files) {
  if (!files) return;
  files.forEach(f => { try { if (f.path) fs.unlinkSync(f.path); } catch (e) {} });
}

class BantuanProvinsiLpjController {
  /**
   * Get LPJ Bantuan Provinsi for logged-in desa
   * GET /api/desa/bantuan-provinsi-lpj?tahun=2025
   */
  async getMyLpj(req, res) {
    try {
      const userId = req.user.id;
      const tahun = parseInt(req.query.tahun) || 2025;

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

      const [lpjList] = await sequelize.query(`
        SELECT *
        FROM ${TABLE_NAME}
        WHERE desa_id = :desaId AND tahun_anggaran = :tahun
        ORDER BY created_at DESC
      `, {
        replacements: { desaId: user.desa_id, tahun }
      });

      res.json({ success: true, data: lpjList });
    } catch (error) {
      logger.error('Error fetching LPJ Bantuan Provinsi:', error);
      res.status(500).json({
        success: false,
        message: 'Gagal mengambil data LPJ Bantuan Provinsi',
        error: error.message
      });
    }
  }

  /**
   * Upload LPJ Bantuan Provinsi file(s)
   * POST /api/desa/bantuan-provinsi-lpj/upload
   */
  async uploadLpj(req, res) {
    try {
      const userId = req.user.id;
      const tahun = parseInt(req.body.tahun_anggaran || req.body.tahun) || 2025;
      const keterangan = req.body.keterangan || null;
      const files = req.files;

      if (!files || files.length === 0) {
        return res.status(400).json({
          success: false,
          message: 'File LPJ harus diupload. Pilih minimal satu file PDF.',
          error_code: 'NO_FILE'
        });
      }

      const user = await prisma.users.findUnique({
        where: { id: BigInt(userId) },
        select: { desa_id: true }
      });

      if (!user || !user.desa_id) {
        cleanupFiles(files);
        return res.status(403).json({
          success: false,
          message: 'User tidak terkait dengan desa manapun'
        });
      }

      const desa = await prisma.desas.findUnique({
        where: { id: user.desa_id },
        select: { kecamatan_id: true }
      });

      if (!desa || !desa.kecamatan_id) {
        cleanupFiles(files);
        return res.status(403).json({
          success: false,
          message: 'Desa tidak terkait dengan kecamatan manapun'
        });
      }

      const targetDir = path.join(__dirname, `../../storage/uploads/${STORAGE_DIR}`, String(desa.kecamatan_id), String(user.desa_id));
      if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true });

      const createdLpjs = [];
      for (const file of files) {
        const targetPath = path.join(targetDir, file.filename);
        fs.renameSync(file.path, targetPath);

        const relativePath = `${desa.kecamatan_id}/${user.desa_id}/${file.filename}`;
        const [result] = await sequelize.query(`
          INSERT INTO ${TABLE_NAME}
            (desa_id, tahun_anggaran, nama_file, file_path, file_size, keterangan, status, uploaded_by)
          VALUES
            (:desaId, :tahun, :namaFile, :filePath, :fileSize, :keterangan, 'pending', :uploadedBy)
        `, {
          replacements: {
            desaId: user.desa_id,
            tahun,
            namaFile: file.originalname,
            filePath: relativePath,
            fileSize: file.size,
            keterangan,
            uploadedBy: userId
          }
        });

        createdLpjs.push({
          id: result?.insertId || result,
          desa_id: user.desa_id,
          tahun_anggaran: tahun,
          nama_file: file.originalname,
          file_path: relativePath,
          file_size: file.size,
          keterangan,
          status: 'pending',
          uploaded_by: userId
        });
      }

      logger.info(`LPJ ${PROGRAM_LABEL} uploaded: desa_id=${user.desa_id}, kecamatan_id=${desa.kecamatan_id}, tahun=${tahun}, files=${files.length}`);

      res.status(201).json({
        success: true,
        message: `${files.length} file LPJ Bantuan Provinsi berhasil diupload`,
        data: createdLpjs
      });
    } catch (error) {
      cleanupFiles(req.files);
      logger.error('Error uploading LPJ Bantuan Provinsi:', error);
      res.status(500).json({
        success: false,
        message: 'Gagal mengupload LPJ Bantuan Provinsi. Silakan coba lagi.',
        error: error.message
      });
    }
  }

  /**
   * Delete LPJ Bantuan Provinsi file by desa
   * DELETE /api/desa/bantuan-provinsi-lpj/:id
   */
  async deleteLpj(req, res) {
    try {
      const userId = req.user.id;
      const lpjId = BigInt(req.params.id);

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

      const [rows] = await sequelize.query(`
        SELECT *
        FROM ${TABLE_NAME}
        WHERE id = :lpjId AND desa_id = :desaId
        LIMIT 1
      `, {
        replacements: { lpjId, desaId: user.desa_id }
      });
      const lpj = rows[0];

      if (!lpj) {
        return res.status(404).json({
          success: false,
          message: 'Data LPJ Bantuan Provinsi tidak ditemukan'
        });
      }

      if (lpj.status === 'approved') {
        return res.status(400).json({
          success: false,
          message: 'LPJ yang sudah disetujui tidak dapat dihapus'
        });
      }

      const filePath = path.join(__dirname, `../../storage/uploads/${STORAGE_DIR}`, lpj.file_path);
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);

      await sequelize.query(`DELETE FROM ${TABLE_NAME} WHERE id = :lpjId`, {
        replacements: { lpjId }
      });

      logger.info(`LPJ ${PROGRAM_LABEL} deleted: id=${lpjId}, desa_id=${user.desa_id}`);

      res.json({
        success: true,
        message: 'LPJ Bantuan Provinsi berhasil dihapus'
      });
    } catch (error) {
      logger.error('Error deleting LPJ Bantuan Provinsi:', error);
      res.status(500).json({
        success: false,
        message: 'Gagal menghapus LPJ Bantuan Provinsi',
        error: error.message
      });
    }
  }

  /**
   * DPMD/SPKED: Get all LPJ Bantuan Provinsi submissions grouped by kecamatan
   * GET /api/dpmd/bantuan-provinsi-lpj?tahun=2025
   */
  async getAllLpj(req, res) {
    try {
      const tahun = parseInt(req.query.tahun) || 2025;

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
        LEFT JOIN ${TABLE_NAME} l ON l.desa_id = d.id AND l.tahun_anggaran = :tahun
        LEFT JOIN users u ON l.uploaded_by = u.id
        LEFT JOIN users v ON l.dpmd_verified_by = v.id
        WHERE d.status_pemerintahan = 'desa'
        ORDER BY k.nama, d.nama, l.created_at DESC
      `, {
        replacements: { tahun }
      });

      const grouped = {};
      const desaTracker = {};
      let totalDesa = 0;
      let totalUploaded = 0;
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
      logger.error('Error fetching all LPJ Bantuan Provinsi:', error);
      res.status(500).json({
        success: false,
        message: 'Gagal mengambil data LPJ Bantuan Provinsi',
        error: error.message
      });
    }
  }

  /**
   * DPMD: Verify LPJ Bantuan Provinsi
   * PUT /api/dpmd/bantuan-provinsi-lpj/:id/verify
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

      if (['rejected', 'revision'].includes(action) && !catatan?.trim()) {
        return res.status(400).json({
          success: false,
          message: 'Catatan wajib diisi untuk penolakan atau revisi'
        });
      }

      const [rows] = await sequelize.query(`
        SELECT l.*, d.nama AS desa_nama
        FROM ${TABLE_NAME} l
        LEFT JOIN desas d ON l.desa_id = d.id
        WHERE l.id = :lpjId
        LIMIT 1
      `, {
        replacements: { lpjId }
      });
      const lpj = rows[0];

      if (!lpj) {
        return res.status(404).json({
          success: false,
          message: 'Data LPJ Bantuan Provinsi tidak ditemukan'
        });
      }

      await sequelize.query(`
        UPDATE ${TABLE_NAME}
        SET status = :action,
            dpmd_catatan = :catatan,
            dpmd_verified_by = :userId,
            dpmd_verified_at = NOW(),
            updated_at = NOW()
        WHERE id = :lpjId
      `, {
        replacements: {
          action,
          catatan: catatan?.trim() || null,
          userId,
          lpjId
        }
      });

      if (action === 'revision') {
        try {
          const { createVerificationChat } = require('./messaging.controller');
          await createVerificationChat(
            userId,
            lpj.uploaded_by,
            req.user.role || 'pegawai',
            'desa',
            REFERENCE_TYPE,
            lpjId,
            `Revisi LPJ ${PROGRAM_LABEL} - ${lpj.desa_nama || 'Desa'}\n\nCatatan: ${catatan?.trim()}`
          );
        } catch (chatErr) {
          logger.error('Failed to create LPJ Bantuan Provinsi verification chat:', chatErr.message);
        }
      }

      const [updatedRows] = await sequelize.query(`SELECT * FROM ${TABLE_NAME} WHERE id = :lpjId`, {
        replacements: { lpjId }
      });

      const actionLabels = { approved: 'disetujui', rejected: 'ditolak', revision: 'perlu revisi' };
      logger.info(`LPJ ${PROGRAM_LABEL} verified: id=${lpjId}, desa=${lpj.desa_nama}, action=${action}, by=${userId}`);

      res.json({
        success: true,
        message: `LPJ Bantuan Provinsi Desa ${lpj.desa_nama || ''} berhasil ${actionLabels[action]}`,
        data: updatedRows[0]
      });
    } catch (error) {
      logger.error('Error verifying LPJ Bantuan Provinsi:', error);
      res.status(500).json({
        success: false,
        message: 'Gagal memverifikasi LPJ Bantuan Provinsi',
        error: error.message
      });
    }
  }

  /**
   * DPMD/Admin: Delete LPJ Bantuan Provinsi file
   * DELETE /api/dpmd/bantuan-provinsi-lpj/:id
   */
  async adminDeleteLpj(req, res) {
    try {
      const lpjId = BigInt(req.params.id);
      const userId = req.user.id;

      const [rows] = await sequelize.query(`
        SELECT l.*, d.nama AS desa_nama
        FROM ${TABLE_NAME} l
        LEFT JOIN desas d ON l.desa_id = d.id
        WHERE l.id = :lpjId
        LIMIT 1
      `, {
        replacements: { lpjId }
      });
      const lpj = rows[0];

      if (!lpj) {
        return res.status(404).json({
          success: false,
          message: 'Data LPJ Bantuan Provinsi tidak ditemukan'
        });
      }

      const filePath = path.join(__dirname, `../../storage/uploads/${STORAGE_DIR}`, lpj.file_path);
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);

      await sequelize.query(`DELETE FROM ${TABLE_NAME} WHERE id = :lpjId`, {
        replacements: { lpjId }
      });

      logger.info(`LPJ ${PROGRAM_LABEL} admin-deleted: id=${lpjId}, desa=${lpj.desa_nama}, by=${userId}`);

      res.json({
        success: true,
        message: `LPJ Bantuan Provinsi Desa ${lpj.desa_nama || ''} berhasil dihapus`
      });
    } catch (error) {
      logger.error('Error admin deleting LPJ Bantuan Provinsi:', error);
      res.status(500).json({
        success: false,
        message: 'Gagal menghapus LPJ Bantuan Provinsi',
        error: error.message
      });
    }
  }
}

module.exports = new BantuanProvinsiLpjController();
