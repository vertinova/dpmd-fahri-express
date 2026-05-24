const sequelize = require('../config/database');
const logger = require('../utils/logger');
const ActivityLogger = require('../utils/activityLogger');
const path = require('path');
const fs = require('fs');

const MODULE_NAME = 'bankeu_perubahan';

function cleanupFiles(req) {
  if (req.files && req.files.length) {
    req.files.forEach(f => { try { fs.unlinkSync(f.path); } catch (e) {} });
  } else if (req.file && req.file.path) {
    try { fs.unlinkSync(req.file.path); } catch (e) {}
  }
}

class BankeuPerubahanLpjController {
  /**
   * DESA: Get LPJ for logged-in desa
   * GET /api/desa/bankeu-perubahan-lpj?tahun=2026
   */
  async getMyLpj(req, res) {
    try {
      const userId = req.user.id;
      const { tahun } = req.query;

      const [users] = await sequelize.query(`SELECT desa_id FROM users WHERE id = ?`, { replacements: [userId] });
      if (!users[0]?.desa_id) {
        return res.status(403).json({ success: false, message: 'User tidak terkait dengan desa' });
      }

      let where = 'WHERE desa_id = ?';
      const replacements = [users[0].desa_id];
      if (tahun) { where += ' AND tahun_anggaran = ?'; replacements.push(parseInt(tahun)); }

      const [rows] = await sequelize.query(`
        SELECT lpj.*, u.name AS dpmd_verified_by_name
        FROM bankeu_perubahan_lpj lpj
        LEFT JOIN users u ON lpj.dpmd_verified_by = u.id
        ${where}
        ORDER BY lpj.created_at DESC
      `, { replacements });

      res.json({ success: true, data: rows });
    } catch (error) {
      logger.error('[BankeuPerubahan LPJ] Error get:', error);
      res.status(500).json({ success: false, message: 'Gagal mengambil data LPJ', error: error.message });
    }
  }

  /**
   * DESA: Upload LPJ file(s)
   * POST /api/desa/bankeu-perubahan-lpj/upload
   */
  async uploadLpj(req, res) {
    try {
      const userId = req.user.id;
      const { tahun, keterangan } = req.body;

      if (!req.files || req.files.length === 0) {
        return res.status(400).json({ success: false, message: 'File LPJ wajib diupload' });
      }

      const [users] = await sequelize.query(`SELECT desa_id FROM users WHERE id = ?`, { replacements: [userId] });
      if (!users[0]?.desa_id) {
        cleanupFiles(req);
        return res.status(403).json({ success: false, message: 'User tidak terkait dengan desa' });
      }

      const desaId = users[0].desa_id;
      const tahunValue = tahun ? parseInt(tahun) : new Date().getFullYear();

      // Move files to permanent folder
      const targetDir = path.join(__dirname, `../../storage/uploads/bankeu-perubahan/lpj/desa_${desaId}`);
      if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true });

      const inserted = [];
      for (const file of req.files) {
        const newFilename = file.filename;
        const newPath = path.join(targetDir, newFilename);
        try {
          fs.renameSync(file.path, newPath);
        } catch (e) {
          // If rename fails, try copy+delete
          fs.copyFileSync(file.path, newPath);
          try { fs.unlinkSync(file.path); } catch (e2) {}
        }

        const relativePath = `bankeu-perubahan/lpj/desa_${desaId}/${newFilename}`;
        const [result] = await sequelize.query(`
          INSERT INTO bankeu_perubahan_lpj
            (desa_id, tahun_anggaran, nama_file, file_path, file_size, keterangan, status, uploaded_by)
          VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)
        `, {
          replacements: [
            desaId, tahunValue, file.originalname, relativePath, file.size,
            keterangan || null, userId
          ]
        });

        const insertId = result?.insertId || result;
        inserted.push({ id: insertId, nama_file: file.originalname, file_path: relativePath });
      }

      ActivityLogger.log({
        userId,
        userName: req.user.name || `User ${userId}`,
        userRole: req.user.role,
        bidangId: 3,
        module: MODULE_NAME,
        action: 'upload',
        entityType: 'bankeu_perubahan_lpj',
        description: `${req.user.name || 'User'} mengupload ${req.files.length} file LPJ Bankeu Perubahan TA ${tahunValue}`,
        newValue: { count: req.files.length, tahun: tahunValue },
        ipAddress: ActivityLogger.getIpFromRequest(req),
        userAgent: ActivityLogger.getUserAgentFromRequest(req)
      });

      res.status(201).json({
        success: true,
        message: `${req.files.length} file LPJ berhasil diupload`,
        data: inserted
      });
    } catch (error) {
      cleanupFiles(req);
      logger.error('[BankeuPerubahan LPJ] Error upload:', error);
      res.status(500).json({ success: false, message: 'Gagal upload LPJ', error: error.message });
    }
  }

  /**
   * DESA: Delete LPJ
   * DELETE /api/desa/bankeu-perubahan-lpj/:id
   */
  async deleteLpj(req, res) {
    try {
      const { id } = req.params;
      const userId = req.user.id;

      const [users] = await sequelize.query(`SELECT desa_id FROM users WHERE id = ?`, { replacements: [userId] });
      if (!users[0]?.desa_id) return res.status(403).json({ success: false, message: 'Akses ditolak' });

      const [rows] = await sequelize.query(`
        SELECT id, desa_id, file_path, status FROM bankeu_perubahan_lpj WHERE id = ?
      `, { replacements: [id] });

      if (!rows.length) return res.status(404).json({ success: false, message: 'LPJ tidak ditemukan' });
      if (Number(rows[0].desa_id) !== Number(users[0].desa_id)) {
        return res.status(403).json({ success: false, message: 'Akses ditolak' });
      }
      if (rows[0].status === 'verified') {
        return res.status(400).json({ success: false, message: 'LPJ yang sudah diverifikasi tidak dapat dihapus' });
      }

      // Delete file
      if (rows[0].file_path) {
        const filePath = path.join(__dirname, '../../storage/uploads', rows[0].file_path);
        if (fs.existsSync(filePath)) { try { fs.unlinkSync(filePath); } catch (e) {} }
      }

      await sequelize.query(`DELETE FROM bankeu_perubahan_lpj WHERE id = ?`, { replacements: [id] });

      res.json({ success: true, message: 'LPJ dihapus' });
    } catch (error) {
      logger.error('[BankeuPerubahan LPJ] Error delete:', error);
      res.status(500).json({ success: false, message: 'Gagal hapus LPJ', error: error.message });
    }
  }

  // === DPMD MONITORING ===

  /**
   * DPMD: List all LPJ
   * GET /api/dpmd/bankeu-perubahan-lpj?tahun=2026
   */
  async listForDpmd(req, res) {
    try {
      const { tahun, status, desa_id } = req.query;

      let where = 'WHERE 1=1';
      const replacements = [];
      if (tahun) { where += ' AND lpj.tahun_anggaran = ?'; replacements.push(parseInt(tahun)); }
      if (status) { where += ' AND lpj.status = ?'; replacements.push(status); }
      if (desa_id) { where += ' AND lpj.desa_id = ?'; replacements.push(desa_id); }

      const [rows] = await sequelize.query(`
        SELECT lpj.*, d.nama AS desa_nama, k.nama AS kecamatan_nama,
               u.name AS uploaded_by_name, uv.name AS dpmd_verified_by_name
        FROM bankeu_perubahan_lpj lpj
        INNER JOIN desas d ON lpj.desa_id = d.id
        LEFT JOIN kecamatans k ON d.kecamatan_id = k.id
        LEFT JOIN users u ON lpj.uploaded_by = u.id
        LEFT JOIN users uv ON lpj.dpmd_verified_by = uv.id
        ${where}
        ORDER BY lpj.created_at DESC
      `, { replacements });

      res.json({ success: true, data: rows });
    } catch (error) {
      logger.error('[BankeuPerubahan LPJ DPMD] Error list:', error);
      res.status(500).json({ success: false, message: 'Gagal mengambil data LPJ', error: error.message });
    }
  }

  /**
   * DPMD: Verify LPJ
   * PATCH /api/dpmd/bankeu-perubahan-lpj/:id/verify
   */
  async verifyLpj(req, res) {
    try {
      const { id } = req.params;
      const { status, catatan } = req.body;
      const userId = req.user.id;

      if (!['verified', 'rejected', 'revision'].includes(status)) {
        return res.status(400).json({ success: false, message: 'Status tidak valid (verified/rejected/revision)' });
      }

      const [rows] = await sequelize.query(`
        SELECT lpj.id, lpj.nama_file, d.nama AS desa_nama
        FROM bankeu_perubahan_lpj lpj
        INNER JOIN desas d ON lpj.desa_id = d.id
        WHERE lpj.id = ?
      `, { replacements: [id] });

      if (!rows.length) return res.status(404).json({ success: false, message: 'LPJ tidak ditemukan' });

      const [users] = await sequelize.query(`SELECT name FROM users WHERE id = ?`, { replacements: [userId] });

      await sequelize.query(`
        UPDATE bankeu_perubahan_lpj
        SET status = ?, dpmd_catatan = ?, dpmd_verified_by = ?, dpmd_verified_at = NOW(), updated_at = NOW()
        WHERE id = ?
      `, { replacements: [status, catatan || null, userId, id] });

      ActivityLogger.log({
        userId,
        userName: users[0]?.name || `User ${userId}`,
        userRole: req.user.role,
        bidangId: 3,
        module: MODULE_NAME,
        action: status === 'verified' ? 'approve' : 'reject',
        entityType: 'bankeu_perubahan_lpj',
        entityId: parseInt(id),
        entityName: rows[0].nama_file,
        description: `${users[0]?.name || 'User'} ${status} LPJ Bankeu Perubahan dari Desa ${rows[0].desa_nama}`,
        newValue: { status, catatan },
        ipAddress: ActivityLogger.getIpFromRequest(req),
        userAgent: ActivityLogger.getUserAgentFromRequest(req)
      });

      res.json({ success: true, message: `LPJ berhasil di-${status}` });
    } catch (error) {
      logger.error('[BankeuPerubahan LPJ DPMD] Error verify:', error);
      res.status(500).json({ success: false, message: 'Gagal verifikasi LPJ', error: error.message });
    }
  }

  /**
   * DPMD: Statistik LPJ
   * GET /api/dpmd/bankeu-perubahan-lpj/statistics?tahun=2026
   */
  async getStatistics(req, res) {
    try {
      const { tahun } = req.query;

      let where = 'WHERE 1=1';
      const replacements = [];
      if (tahun) { where += ' AND tahun_anggaran = ?'; replacements.push(parseInt(tahun)); }

      const [stats] = await sequelize.query(`
        SELECT
          COUNT(*) AS total_files,
          COUNT(DISTINCT desa_id) AS total_desa,
          SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending,
          SUM(CASE WHEN status = 'verified' THEN 1 ELSE 0 END) AS verified,
          SUM(CASE WHEN status = 'rejected' THEN 1 ELSE 0 END) AS rejected,
          SUM(CASE WHEN status = 'revision' THEN 1 ELSE 0 END) AS revision
        FROM bankeu_perubahan_lpj
        ${where}
      `, { replacements });

      res.json({ success: true, data: stats[0] || {} });
    } catch (error) {
      logger.error('[BankeuPerubahan LPJ DPMD] Error stats:', error);
      res.status(500).json({ success: false, message: 'Gagal mengambil statistik', error: error.message });
    }
  }
}

module.exports = new BankeuPerubahanLpjController();
