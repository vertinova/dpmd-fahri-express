const sequelize = require('../config/database');
const logger = require('../utils/logger');
const ActivityLogger = require('../utils/activityLogger');
const path = require('path');
const fs = require('fs');

const MODULE_NAME = 'bankeu_perubahan';

function cleanupFile(req) {
  if (req.file && req.file.path) {
    try { fs.unlinkSync(req.file.path); } catch (e) {}
  }
}

class BankeuPerubahanConfigController {
  /**
   * Get kecamatan config
   * GET /api/kecamatan/bankeu-perubahan/config/:kecamatanId
   */
  async getConfig(req, res) {
    try {
      const { kecamatanId } = req.params;
      const userId = req.user.id;

      // Validate user-kecamatan match
      const [users] = await sequelize.query(`SELECT kecamatan_id FROM users WHERE id = ?`, { replacements: [userId] });
      if (Number(users[0]?.kecamatan_id) !== Number(kecamatanId)) {
        return res.status(403).json({ success: false, message: 'Akses ditolak' });
      }

      const [rows] = await sequelize.query(`
        SELECT * FROM kecamatan_bankeu_perubahan_config WHERE kecamatan_id = ?
      `, { replacements: [kecamatanId] });

      res.json({ success: true, data: rows[0] || null });
    } catch (error) {
      logger.error('[BankeuPerubahan Config] Error get:', error);
      res.status(500).json({ success: false, message: 'Gagal mengambil config', error: error.message });
    }
  }

  /**
   * Save config (create or update)
   * POST /api/kecamatan/bankeu-perubahan/config/:kecamatanId
   */
  async saveConfig(req, res) {
    try {
      const { kecamatanId } = req.params;
      const userId = req.user.id;
      const { nama_camat, nip_camat, jabatan_penandatangan, alamat, telepon, email, website, kode_pos } = req.body;

      const [users] = await sequelize.query(`SELECT kecamatan_id FROM users WHERE id = ?`, { replacements: [userId] });
      if (Number(users[0]?.kecamatan_id) !== Number(kecamatanId)) {
        return res.status(403).json({ success: false, message: 'Akses ditolak' });
      }

      if (!nama_camat) {
        return res.status(400).json({ success: false, message: 'Nama camat wajib diisi' });
      }

      const [existing] = await sequelize.query(`
        SELECT id FROM kecamatan_bankeu_perubahan_config WHERE kecamatan_id = ?
      `, { replacements: [kecamatanId] });

      if (existing.length > 0) {
        await sequelize.query(`
          UPDATE kecamatan_bankeu_perubahan_config
          SET nama_camat = ?, nip_camat = ?, jabatan_penandatangan = ?,
              alamat = ?, telepon = ?, email = ?, website = ?, kode_pos = ?, updated_at = NOW()
          WHERE kecamatan_id = ?
        `, {
          replacements: [
            nama_camat, nip_camat || null, jabatan_penandatangan || 'Camat',
            alamat || null, telepon || null, email || null, website || null, kode_pos || null,
            kecamatanId
          ]
        });
      } else {
        await sequelize.query(`
          INSERT INTO kecamatan_bankeu_perubahan_config
            (kecamatan_id, nama_camat, nip_camat, jabatan_penandatangan, alamat, telepon, email, website, kode_pos)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, {
          replacements: [
            kecamatanId, nama_camat, nip_camat || null, jabatan_penandatangan || 'Camat',
            alamat || null, telepon || null, email || null, website || null, kode_pos || null
          ]
        });
      }

      ActivityLogger.log({
        userId,
        userName: req.user.name || `User ${userId}`,
        userRole: req.user.role,
        bidangId: 3,
        module: MODULE_NAME,
        action: 'update',
        entityType: 'bankeu_perubahan_config',
        entityId: parseInt(kecamatanId),
        description: `${req.user.name || 'User'} menyimpan config kecamatan untuk Bankeu Perubahan`,
        ipAddress: ActivityLogger.getIpFromRequest(req),
        userAgent: ActivityLogger.getUserAgentFromRequest(req)
      });

      res.json({ success: true, message: 'Config berhasil disimpan' });
    } catch (error) {
      logger.error('[BankeuPerubahan Config] Error save:', error);
      res.status(500).json({ success: false, message: 'Gagal menyimpan config', error: error.message });
    }
  }

  /**
   * Upload helper - logo/ttd-camat/stempel
   */
  async _uploadFile(req, res, fieldName, label) {
    try {
      const { kecamatanId } = req.params;
      const userId = req.user.id;

      if (!req.file) return res.status(400).json({ success: false, message: 'File wajib diupload' });

      const [users] = await sequelize.query(`SELECT kecamatan_id FROM users WHERE id = ?`, { replacements: [userId] });
      if (Number(users[0]?.kecamatan_id) !== Number(kecamatanId)) {
        cleanupFile(req);
        return res.status(403).json({ success: false, message: 'Akses ditolak' });
      }

      // Get old file
      const [rows] = await sequelize.query(`
        SELECT ${fieldName} FROM kecamatan_bankeu_perubahan_config WHERE kecamatan_id = ?
      `, { replacements: [kecamatanId] });

      const oldFile = rows[0]?.[fieldName];
      const newFilename = req.file.filename;

      // Insert if not exists
      if (rows.length === 0) {
        await sequelize.query(`
          INSERT INTO kecamatan_bankeu_perubahan_config (kecamatan_id, nama_camat, ${fieldName})
          VALUES (?, 'Camat', ?)
        `, { replacements: [kecamatanId, newFilename] });
      } else {
        await sequelize.query(`
          UPDATE kecamatan_bankeu_perubahan_config
          SET ${fieldName} = ?, updated_at = NOW()
          WHERE kecamatan_id = ?
        `, { replacements: [newFilename, kecamatanId] });
      }

      // Delete old file
      if (oldFile) {
        const oldPath = path.join(__dirname, '../../storage/uploads/bankeu-perubahan/config', oldFile);
        if (fs.existsSync(oldPath)) { try { fs.unlinkSync(oldPath); } catch (e) {} }
      }

      ActivityLogger.log({
        userId,
        userName: req.user.name || `User ${userId}`,
        userRole: req.user.role,
        bidangId: 3,
        module: MODULE_NAME,
        action: 'upload',
        entityType: 'bankeu_perubahan_config',
        entityId: parseInt(kecamatanId),
        description: `${req.user.name || 'User'} upload ${label} kecamatan untuk Bankeu Perubahan`,
        ipAddress: ActivityLogger.getIpFromRequest(req),
        userAgent: ActivityLogger.getUserAgentFromRequest(req)
      });

      res.json({ success: true, message: `${label} berhasil diupload`, data: { [fieldName]: newFilename } });
    } catch (error) {
      cleanupFile(req);
      logger.error(`[BankeuPerubahan Config] Error upload ${label}:`, error);
      res.status(500).json({ success: false, message: `Gagal upload ${label}`, error: error.message });
    }
  }

  uploadLogo = (req, res) => this._uploadFile(req, res, 'logo_path', 'Logo');
  uploadCamatSignature = (req, res) => this._uploadFile(req, res, 'ttd_camat_path', 'TTD Camat');
  uploadStempel = (req, res) => this._uploadFile(req, res, 'stempel_path', 'Stempel');

  /**
   * Delete file helper
   */
  async _deleteFile(req, res, fieldName, label) {
    try {
      const { kecamatanId } = req.params;
      const userId = req.user.id;

      const [users] = await sequelize.query(`SELECT kecamatan_id FROM users WHERE id = ?`, { replacements: [userId] });
      if (Number(users[0]?.kecamatan_id) !== Number(kecamatanId)) {
        return res.status(403).json({ success: false, message: 'Akses ditolak' });
      }

      const [rows] = await sequelize.query(`
        SELECT ${fieldName} FROM kecamatan_bankeu_perubahan_config WHERE kecamatan_id = ?
      `, { replacements: [kecamatanId] });

      const file = rows[0]?.[fieldName];
      if (file) {
        const filePath = path.join(__dirname, '../../storage/uploads/bankeu-perubahan/config', file);
        if (fs.existsSync(filePath)) { try { fs.unlinkSync(filePath); } catch (e) {} }
      }

      await sequelize.query(`
        UPDATE kecamatan_bankeu_perubahan_config
        SET ${fieldName} = NULL, updated_at = NOW()
        WHERE kecamatan_id = ?
      `, { replacements: [kecamatanId] });

      res.json({ success: true, message: `${label} berhasil dihapus` });
    } catch (error) {
      logger.error(`[BankeuPerubahan Config] Error delete ${label}:`, error);
      res.status(500).json({ success: false, message: `Gagal hapus ${label}`, error: error.message });
    }
  }

  deleteCamatSignature = (req, res) => this._deleteFile(req, res, 'ttd_camat_path', 'TTD Camat');
  deleteStempel = (req, res) => this._deleteFile(req, res, 'stempel_path', 'Stempel');

  /**
   * Sinkron data konfigurasi dari Bankeu reguler (kecamatan_bankeu_config)
   * ke config Bankeu Perubahan. Menyalin field teks + file TTD camat & stempel.
   * POST /api/kecamatan/bankeu-perubahan/config/:kecamatanId/sync-from-reguler
   * (handler tidak memakai `this`)
   */
  async syncFromReguler(req, res) {
    try {
      const { kecamatanId } = req.params;
      const userId = req.user.id;
      const [users] = await sequelize.query(`SELECT kecamatan_id FROM users WHERE id = ?`, { replacements: [userId] });
      if (Number(users[0]?.kecamatan_id) !== Number(kecamatanId)) {
        return res.status(403).json({ success: false, message: 'Akses ditolak' });
      }

      const [regRows] = await sequelize.query(
        `SELECT nama_camat, nip_camat, jabatan_penandatangan, alamat, telepon, email, website, kode_pos, ttd_camat_path, stempel_path
         FROM kecamatan_bankeu_config WHERE kecamatan_id = ? LIMIT 1`,
        { replacements: [kecamatanId] }
      );
      if (!regRows.length) {
        return res.status(404).json({ success: false, message: 'Konfigurasi Bankeu reguler belum dibuat untuk kecamatan ini' });
      }
      const reg = regRows[0];

      // Salin file dari folder reguler ke folder config perubahan
      const srcBase = path.join(__dirname, '../../storage/uploads');
      const destDir = path.join(__dirname, '../../storage/uploads/bankeu-perubahan/config');
      if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });
      const copyFile = (relPath, prefix) => {
        if (!relPath) return null;
        try {
          const src = path.join(srcBase, relPath);
          if (!fs.existsSync(src)) return null;
          const ext = path.extname(relPath) || '.png';
          const name = `sync_${prefix}_${kecamatanId}_${Date.now()}${ext}`;
          fs.copyFileSync(src, path.join(destDir, name));
          return name;
        } catch (e) {
          logger.error(`[BankeuPerubahan Config] sync copy ${prefix} gagal:`, e.message);
          return null;
        }
      };
      const newTtd = copyFile(reg.ttd_camat_path, 'ttd');
      const newStempel = copyFile(reg.stempel_path, 'stempel');

      const [existing] = await sequelize.query(
        `SELECT id, ttd_camat_path, stempel_path FROM kecamatan_bankeu_perubahan_config WHERE kecamatan_id = ? LIMIT 1`,
        { replacements: [kecamatanId] }
      );

      const ttdFinal = newTtd || existing[0]?.ttd_camat_path || null;
      const stempelFinal = newStempel || existing[0]?.stempel_path || null;
      const fields = [
        reg.nama_camat || 'Camat', reg.nip_camat || null, reg.jabatan_penandatangan || 'Camat',
        reg.alamat || null, reg.telepon || null, reg.email || null, reg.website || null, reg.kode_pos || null,
        ttdFinal, stempelFinal,
      ];

      if (existing.length) {
        await sequelize.query(
          `UPDATE kecamatan_bankeu_perubahan_config
           SET nama_camat = ?, nip_camat = ?, jabatan_penandatangan = ?, alamat = ?, telepon = ?,
               email = ?, website = ?, kode_pos = ?, ttd_camat_path = ?, stempel_path = ?, updated_at = NOW()
           WHERE kecamatan_id = ?`,
          { replacements: [...fields, kecamatanId] }
        );
      } else {
        await sequelize.query(
          `INSERT INTO kecamatan_bankeu_perubahan_config
             (kecamatan_id, nama_camat, nip_camat, jabatan_penandatangan, alamat, telepon, email, website, kode_pos, ttd_camat_path, stempel_path)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          { replacements: [kecamatanId, ...fields] }
        );
      }

      ActivityLogger.log({
        userId,
        userName: req.user.name || `User ${userId}`,
        userRole: req.user.role,
        bidangId: 3,
        module: MODULE_NAME,
        action: 'sync',
        entityType: 'bankeu_perubahan_config',
        entityId: parseInt(kecamatanId),
        description: `${req.user.name || 'User'} sinkron konfigurasi Bankeu Perubahan dari Bankeu reguler`,
        ipAddress: ActivityLogger.getIpFromRequest(req),
        userAgent: ActivityLogger.getUserAgentFromRequest(req),
      });

      res.json({ success: true, message: 'Konfigurasi berhasil disinkron dari Bankeu reguler' });
    } catch (error) {
      logger.error('[BankeuPerubahan Config] Error sync:', error);
      res.status(500).json({ success: false, message: 'Gagal sinkron konfigurasi', error: error.message });
    }
  }

  // === TIM VERIFIKASI ===

  /**
   * Get tim verifikasi
   * GET /api/kecamatan/bankeu-perubahan/tim-verifikasi/:kecamatanId
   */
  async getTimVerifikasi(req, res) {
    try {
      const { kecamatanId } = req.params;
      const userId = req.user.id;

      const [users] = await sequelize.query(`SELECT kecamatan_id FROM users WHERE id = ?`, { replacements: [userId] });
      if (Number(users[0]?.kecamatan_id) !== Number(kecamatanId)) {
        return res.status(403).json({ success: false, message: 'Akses ditolak' });
      }

      const [rows] = await sequelize.query(`
        SELECT * FROM tim_verifikasi_bankeu_perubahan
        WHERE kecamatan_id = ? AND is_active = TRUE
        ORDER BY created_at DESC
      `, { replacements: [kecamatanId] });

      res.json({ success: true, data: rows });
    } catch (error) {
      logger.error('[BankeuPerubahan Tim] Error get:', error);
      res.status(500).json({ success: false, message: 'Gagal mengambil tim verifikasi', error: error.message });
    }
  }

  /**
   * Add tim verifikasi
   * POST /api/kecamatan/bankeu-perubahan/tim-verifikasi/:kecamatanId
   */
  async addTimVerifikasi(req, res) {
    try {
      const { kecamatanId } = req.params;
      const userId = req.user.id;
      const { jabatan, jabatan_label, nama, nip, proposal_id } = req.body;

      const [users] = await sequelize.query(`SELECT kecamatan_id FROM users WHERE id = ?`, { replacements: [userId] });
      if (Number(users[0]?.kecamatan_id) !== Number(kecamatanId)) {
        return res.status(403).json({ success: false, message: 'Akses ditolak' });
      }

      if (!jabatan || !nama) {
        return res.status(400).json({ success: false, message: 'Jabatan dan nama wajib diisi' });
      }

      const [insertResult] = await sequelize.query(`
        INSERT INTO tim_verifikasi_bankeu_perubahan
          (kecamatan_id, proposal_id, jabatan, jabatan_label, nama, nip, is_active)
        VALUES (?, ?, ?, ?, ?, ?, TRUE)
      `, { replacements: [kecamatanId, proposal_id || null, jabatan, jabatan_label || null, nama, nip || null] });

      const insertId = insertResult?.insertId || insertResult;

      ActivityLogger.log({
        userId,
        userName: req.user.name || `User ${userId}`,
        userRole: req.user.role,
        bidangId: 3,
        module: MODULE_NAME,
        action: 'create',
        entityType: 'bankeu_perubahan_tim',
        entityId: insertId,
        entityName: nama,
        description: `${req.user.name || 'User'} menambah anggota tim verifikasi: ${nama} (${jabatan})`,
        ipAddress: ActivityLogger.getIpFromRequest(req),
        userAgent: ActivityLogger.getUserAgentFromRequest(req)
      });

      res.status(201).json({ success: true, message: 'Anggota tim ditambahkan', data: { id: insertId } });
    } catch (error) {
      logger.error('[BankeuPerubahan Tim] Error add:', error);
      res.status(500).json({ success: false, message: 'Gagal menambah anggota tim', error: error.message });
    }
  }

  /**
   * Remove tim verifikasi (soft delete via is_active=FALSE)
   * DELETE /api/kecamatan/bankeu-perubahan/tim-verifikasi/:id
   */
  async removeTimVerifikasi(req, res) {
    try {
      const { id } = req.params;
      const userId = req.user.id;

      const [users] = await sequelize.query(`SELECT kecamatan_id FROM users WHERE id = ?`, { replacements: [userId] });
      if (!users[0]?.kecamatan_id) return res.status(403).json({ success: false, message: 'Akses ditolak' });

      const [rows] = await sequelize.query(`
        SELECT kecamatan_id, nama FROM tim_verifikasi_bankeu_perubahan WHERE id = ?
      `, { replacements: [id] });

      if (!rows.length) return res.status(404).json({ success: false, message: 'Tim tidak ditemukan' });
      if (Number(rows[0].kecamatan_id) !== Number(users[0].kecamatan_id)) {
        return res.status(403).json({ success: false, message: 'Akses ditolak' });
      }

      await sequelize.query(`
        UPDATE tim_verifikasi_bankeu_perubahan SET is_active = FALSE, updated_at = NOW() WHERE id = ?
      `, { replacements: [id] });

      res.json({ success: true, message: 'Anggota tim dihapus' });
    } catch (error) {
      logger.error('[BankeuPerubahan Tim] Error remove:', error);
      res.status(500).json({ success: false, message: 'Gagal menghapus anggota tim', error: error.message });
    }
  }

  /**
   * Upload TTD anggota tim
   * POST /api/kecamatan/bankeu-perubahan/tim-verifikasi/:id/upload-signature
   */
  async uploadTimSignature(req, res) {
    try {
      const { id } = req.params;
      const userId = req.user.id;

      if (!req.file) return res.status(400).json({ success: false, message: 'File wajib diupload' });

      const [users] = await sequelize.query(`SELECT kecamatan_id FROM users WHERE id = ?`, { replacements: [userId] });
      if (!users[0]?.kecamatan_id) {
        cleanupFile(req);
        return res.status(403).json({ success: false, message: 'Akses ditolak' });
      }

      const [rows] = await sequelize.query(`
        SELECT kecamatan_id, ttd_path FROM tim_verifikasi_bankeu_perubahan WHERE id = ?
      `, { replacements: [id] });

      if (!rows.length) {
        cleanupFile(req);
        return res.status(404).json({ success: false, message: 'Tim tidak ditemukan' });
      }
      if (Number(rows[0].kecamatan_id) !== Number(users[0].kecamatan_id)) {
        cleanupFile(req);
        return res.status(403).json({ success: false, message: 'Akses ditolak' });
      }

      // Delete old file
      if (rows[0].ttd_path) {
        const oldPath = path.join(__dirname, '../../storage/uploads/signatures', rows[0].ttd_path);
        if (fs.existsSync(oldPath)) { try { fs.unlinkSync(oldPath); } catch (e) {} }
      }

      await sequelize.query(`
        UPDATE tim_verifikasi_bankeu_perubahan SET ttd_path = ?, updated_at = NOW() WHERE id = ?
      `, { replacements: [req.file.filename, id] });

      res.json({ success: true, message: 'TTD berhasil diupload', data: { ttd_path: req.file.filename } });
    } catch (error) {
      cleanupFile(req);
      logger.error('[BankeuPerubahan Tim] Error upload TTD:', error);
      res.status(500).json({ success: false, message: 'Gagal upload TTD', error: error.message });
    }
  }
}

module.exports = new BankeuPerubahanConfigController();
