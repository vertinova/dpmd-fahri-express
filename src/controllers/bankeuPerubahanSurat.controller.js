const sequelize = require('../config/database');
const logger = require('../utils/logger');
const ActivityLogger = require('../utils/activityLogger');
const path = require('path');
const fs = require('fs');

const MODULE_NAME = 'bankeu_perubahan';

function cleanupFile(req) {
  if (req.file && req.file.path) {
    try { fs.unlinkSync(req.file.path); } catch (e) { /* ignore */ }
  }
}

class BankeuPerubahanSuratController {
  /**
   * Get surat desa (single record per desa per tahun)
   * GET /api/desa/bankeu-perubahan/surat?tahun=2026
   */
  async getMySurat(req, res) {
    try {
      const userId = req.user.id;
      const { tahun } = req.query;

      const [users] = await sequelize.query(`SELECT desa_id FROM users WHERE id = ?`, { replacements: [userId] });
      if (!users[0]?.desa_id) {
        return res.status(403).json({ success: false, message: 'User tidak terkait dengan desa' });
      }

      const tahunValue = tahun ? parseInt(tahun) : new Date().getFullYear();

      const [rows] = await sequelize.query(`
        SELECT * FROM desa_bankeu_perubahan_surat
        WHERE desa_id = ? AND tahun = ?
        LIMIT 1
      `, { replacements: [users[0].desa_id, tahunValue] });

      res.json({ success: true, data: rows[0] || null });
    } catch (error) {
      logger.error('[BankeuPerubahan Surat] Error get:', error);
      res.status(500).json({ success: false, message: 'Gagal mengambil data surat', error: error.message });
    }
  }

  /**
   * Upload surat pengantar atau permohonan
   * POST /api/desa/bankeu-perubahan/surat/upload
   * Body: jenis = 'pengantar' | 'permohonan', tahun
   */
  async uploadSurat(req, res) {
    try {
      const userId = req.user.id;
      const { jenis, tahun } = req.body;

      if (!['pengantar', 'permohonan'].includes(jenis)) {
        cleanupFile(req);
        return res.status(400).json({ success: false, message: 'Jenis surat tidak valid' });
      }
      if (!req.file) {
        return res.status(400).json({ success: false, message: 'File wajib diupload' });
      }

      const [users] = await sequelize.query(`SELECT desa_id FROM users WHERE id = ?`, { replacements: [userId] });
      if (!users[0]?.desa_id) {
        cleanupFile(req);
        return res.status(403).json({ success: false, message: 'User tidak terkait dengan desa' });
      }
      const desaId = users[0].desa_id;
      const tahunValue = tahun ? parseInt(tahun) : new Date().getFullYear();
      const fieldName = jenis === 'pengantar' ? 'surat_pengantar' : 'surat_permohonan';
      const filename = req.file.filename;

      // Get existing record
      const [existing] = await sequelize.query(`
        SELECT id, ${fieldName} as existing_file FROM desa_bankeu_perubahan_surat
        WHERE desa_id = ? AND tahun = ?
      `, { replacements: [desaId, tahunValue] });

      if (existing.length > 0) {
        // Delete old file
        if (existing[0].existing_file) {
          const oldPath = path.join(__dirname, '../../storage/uploads/bankeu-perubahan/surat', existing[0].existing_file);
          if (fs.existsSync(oldPath)) { try { fs.unlinkSync(oldPath); } catch (e) {} }
        }
        await sequelize.query(`
          UPDATE desa_bankeu_perubahan_surat
          SET ${fieldName} = ?, updated_at = NOW()
          WHERE desa_id = ? AND tahun = ?
        `, { replacements: [filename, desaId, tahunValue] });
      } else {
        await sequelize.query(`
          INSERT INTO desa_bankeu_perubahan_surat (desa_id, tahun, ${fieldName})
          VALUES (?, ?, ?)
        `, { replacements: [desaId, tahunValue, filename] });
      }

      ActivityLogger.log({
        userId,
        userName: req.user.name || `User ${userId}`,
        userRole: req.user.role,
        bidangId: 3,
        module: MODULE_NAME,
        action: 'upload',
        entityType: 'bankeu_perubahan_surat',
        description: `${req.user.name || 'User'} mengupload surat ${jenis} perubahan TA ${tahunValue}`,
        newValue: { jenis, file: filename, tahun: tahunValue },
        ipAddress: ActivityLogger.getIpFromRequest(req),
        userAgent: ActivityLogger.getUserAgentFromRequest(req)
      });

      res.json({
        success: true,
        message: `Surat ${jenis} berhasil diupload`,
        data: { [fieldName]: filename }
      });
    } catch (error) {
      cleanupFile(req);
      logger.error('[BankeuPerubahan Surat] Error upload:', error);
      res.status(500).json({ success: false, message: 'Gagal mengupload surat', error: error.message });
    }
  }

  /**
   * Delete surat
   * DELETE /api/desa/bankeu-perubahan/surat/:jenis?tahun=2026
   */
  async deleteSurat(req, res) {
    try {
      const userId = req.user.id;
      const { jenis } = req.params;
      const { tahun } = req.query;

      if (!['pengantar', 'permohonan'].includes(jenis)) {
        return res.status(400).json({ success: false, message: 'Jenis surat tidak valid' });
      }

      const [users] = await sequelize.query(`SELECT desa_id FROM users WHERE id = ?`, { replacements: [userId] });
      if (!users[0]?.desa_id) return res.status(403).json({ success: false, message: 'Akses ditolak' });

      const tahunValue = tahun ? parseInt(tahun) : new Date().getFullYear();
      const fieldName = jenis === 'pengantar' ? 'surat_pengantar' : 'surat_permohonan';

      const [existing] = await sequelize.query(`
        SELECT id, ${fieldName} as existing_file, submitted_to_kecamatan FROM desa_bankeu_perubahan_surat
        WHERE desa_id = ? AND tahun = ?
      `, { replacements: [users[0].desa_id, tahunValue] });

      if (!existing.length) {
        return res.status(404).json({ success: false, message: 'Surat tidak ditemukan' });
      }
      if (existing[0].submitted_to_kecamatan) {
        return res.status(400).json({ success: false, message: 'Surat sudah dikirim ke kecamatan, tidak dapat dihapus' });
      }

      if (existing[0].existing_file) {
        const oldPath = path.join(__dirname, '../../storage/uploads/bankeu-perubahan/surat', existing[0].existing_file);
        if (fs.existsSync(oldPath)) { try { fs.unlinkSync(oldPath); } catch (e) {} }
      }

      await sequelize.query(`
        UPDATE desa_bankeu_perubahan_surat
        SET ${fieldName} = NULL, updated_at = NOW()
        WHERE desa_id = ? AND tahun = ?
      `, { replacements: [users[0].desa_id, tahunValue] });

      res.json({ success: true, message: 'Surat dihapus' });
    } catch (error) {
      logger.error('[BankeuPerubahan Surat] Error delete:', error);
      res.status(500).json({ success: false, message: 'Gagal menghapus surat', error: error.message });
    }
  }

  /**
   * Submit surat ke kecamatan
   * POST /api/desa/bankeu-perubahan/surat/submit
   */
  async submitSurat(req, res) {
    try {
      const userId = req.user.id;
      const { tahun } = req.body;

      const [users] = await sequelize.query(`SELECT desa_id FROM users WHERE id = ?`, { replacements: [userId] });
      if (!users[0]?.desa_id) return res.status(403).json({ success: false, message: 'Akses ditolak' });

      const tahunValue = tahun ? parseInt(tahun) : new Date().getFullYear();

      const [rows] = await sequelize.query(`
        SELECT id, surat_pengantar, surat_permohonan, submitted_to_kecamatan
        FROM desa_bankeu_perubahan_surat
        WHERE desa_id = ? AND tahun = ?
      `, { replacements: [users[0].desa_id, tahunValue] });

      if (!rows.length) {
        return res.status(404).json({ success: false, message: 'Belum ada surat untuk dikirim' });
      }
      if (!rows[0].surat_pengantar || !rows[0].surat_permohonan) {
        return res.status(400).json({
          success: false,
          message: 'Upload kedua surat (pengantar & permohonan) terlebih dahulu'
        });
      }
      if (rows[0].submitted_to_kecamatan) {
        return res.status(400).json({ success: false, message: 'Surat sudah dikirim ke kecamatan' });
      }

      await sequelize.query(`
        UPDATE desa_bankeu_perubahan_surat
        SET submitted_to_kecamatan = TRUE,
            submitted_at = NOW(),
            kecamatan_review_status = 'pending',
            updated_at = NOW()
        WHERE id = ?
      `, { replacements: [rows[0].id] });

      ActivityLogger.log({
        userId,
        userName: req.user.name || `User ${userId}`,
        userRole: req.user.role,
        bidangId: 3,
        module: MODULE_NAME,
        action: 'submit',
        entityType: 'bankeu_perubahan_surat',
        description: `${req.user.name || 'User'} mengirim surat perubahan ke kecamatan (TA ${tahunValue})`,
        ipAddress: ActivityLogger.getIpFromRequest(req),
        userAgent: ActivityLogger.getUserAgentFromRequest(req)
      });

      res.json({ success: true, message: 'Surat berhasil dikirim ke kecamatan' });
    } catch (error) {
      logger.error('[BankeuPerubahan Surat] Error submit:', error);
      res.status(500).json({ success: false, message: 'Gagal mengirim surat', error: error.message });
    }
  }

  /**
   * KECAMATAN: List surat dari desa-desa
   * GET /api/kecamatan/bankeu-perubahan/surat?tahun=2026
   */
  async listForKecamatan(req, res) {
    try {
      const userId = req.user.id;
      const { tahun, desa_id, status } = req.query;

      const [users] = await sequelize.query(`SELECT kecamatan_id FROM users WHERE id = ?`, { replacements: [userId] });
      if (!users[0]?.kecamatan_id) {
        return res.status(403).json({ success: false, message: 'User tidak terkait dengan kecamatan' });
      }

      let where = 'WHERE d.kecamatan_id = ? AND s.submitted_to_kecamatan = TRUE';
      const replacements = [users[0].kecamatan_id];
      if (tahun) { where += ' AND s.tahun = ?'; replacements.push(parseInt(tahun)); }
      if (desa_id) { where += ' AND s.desa_id = ?'; replacements.push(desa_id); }
      if (status) { where += ' AND s.kecamatan_review_status = ?'; replacements.push(status); }

      const [rows] = await sequelize.query(`
        SELECT s.*, d.nama AS desa_nama, u.name AS review_by_name
        FROM desa_bankeu_perubahan_surat s
        INNER JOIN desas d ON s.desa_id = d.id
        LEFT JOIN users u ON s.kecamatan_review_by = u.id
        ${where}
        ORDER BY s.submitted_at DESC
      `, { replacements });

      res.json({ success: true, data: rows });
    } catch (error) {
      logger.error('[BankeuPerubahan Surat Kec] Error list:', error);
      res.status(500).json({ success: false, message: 'Gagal mengambil data surat', error: error.message });
    }
  }

  /**
   * KECAMATAN: Review surat (approve/reject/revision)
   * PATCH /api/kecamatan/bankeu-perubahan/surat/:id/review
   */
  async reviewSurat(req, res) {
    try {
      const { id } = req.params;
      const { status, catatan } = req.body;
      const userId = req.user.id;

      if (!['approved', 'rejected', 'revision'].includes(status)) {
        return res.status(400).json({ success: false, message: 'Status tidak valid' });
      }

      const [users] = await sequelize.query(`SELECT kecamatan_id, name FROM users WHERE id = ?`, { replacements: [userId] });
      if (!users[0]?.kecamatan_id) {
        return res.status(403).json({ success: false, message: 'User tidak terkait dengan kecamatan' });
      }

      const [rows] = await sequelize.query(`
        SELECT s.id, d.kecamatan_id, d.nama AS desa_nama
        FROM desa_bankeu_perubahan_surat s
        INNER JOIN desas d ON s.desa_id = d.id
        WHERE s.id = ?
      `, { replacements: [id] });

      if (!rows.length) return res.status(404).json({ success: false, message: 'Surat tidak ditemukan' });
      if (Number(rows[0].kecamatan_id) !== Number(users[0].kecamatan_id)) {
        return res.status(403).json({ success: false, message: 'Akses ditolak' });
      }

      // Jika rejected/revision, kembalikan ke desa: submitted_to_kecamatan = FALSE
      const returnToDesa = (status === 'rejected' || status === 'revision');

      await sequelize.query(`
        UPDATE desa_bankeu_perubahan_surat
        SET kecamatan_review_status = ?,
            kecamatan_review_catatan = ?,
            kecamatan_review_by = ?,
            kecamatan_review_at = NOW(),
            submitted_to_kecamatan = ?,
            updated_at = NOW()
        WHERE id = ?
      `, { replacements: [status, catatan || null, userId, !returnToDesa, id] });

      ActivityLogger.log({
        userId,
        userName: users[0].name || `User ${userId}`,
        userRole: req.user.role,
        bidangId: 3,
        module: MODULE_NAME,
        action: status === 'approved' ? 'approve' : 'reject',
        entityType: 'bankeu_perubahan_surat',
        entityId: parseInt(id),
        description: `${users[0].name || 'User'} ${status === 'approved' ? 'menyetujui' : 'menolak/meminta revisi'} surat perubahan dari Desa ${rows[0].desa_nama}`,
        newValue: { status, catatan },
        ipAddress: ActivityLogger.getIpFromRequest(req),
        userAgent: ActivityLogger.getUserAgentFromRequest(req)
      });

      res.json({ success: true, message: `Surat berhasil di-${status}` });
    } catch (error) {
      logger.error('[BankeuPerubahan Surat Kec] Error review:', error);
      res.status(500).json({ success: false, message: 'Gagal review surat', error: error.message });
    }
  }
}

module.exports = new BankeuPerubahanSuratController();
