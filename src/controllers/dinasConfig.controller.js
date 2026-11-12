const sequelize = require('../config/database');
const path = require('path');
const fs = require('fs');

/**
 * Controller for Dinas Configuration (TTD + PIC Info)
 */
class DinasConfigController {
  /**
   * Get dinas config by bidang_id
   * GET /api/dinas/:bidangId/config
   */
  async getConfig(req, res) {
    try {
      const { dinasId } = req.params;
      
      const [config] = await sequelize.query(`
        SELECT 
          dc.id,
          dc.dinas_id,
          dc.nama_pic,
          dc.nip_pic,
          dc.jabatan_pic,
          dc.ttd_path,
          dc.created_at,
          dc.updated_at
        FROM dinas_config dc
        WHERE dc.dinas_id = :dinasId
        LIMIT 1
      `, {
        replacements: { dinasId },
        type: sequelize.QueryTypes.SELECT
      });

      if (!config) {
        return res.json({
          success: true,
          data: null,
          message: 'Konfigurasi dinas belum dibuat'
        });
      }

      res.json({
        success: true,
        data: config
      });
    } catch (error) {
      console.error('Error getting dinas config:', error);
      res.status(500).json({
        success: false,
        message: 'Gagal mengambil konfigurasi dinas',
        error: error.message
      });
    }
  }

  /**
   * Create or update dinas config
   * POST /api/dinas/:bidangId/config
   */
  async upsertConfig(req, res) {
    try {
      const { dinasId } = req.params;
      const { nama_pic, nip_pic, jabatan_pic } = req.body;

      // Validate required fields
      if (!nama_pic || !jabatan_pic) {
        return res.status(400).json({
          success: false,
          message: 'Nama PIC dan Jabatan wajib diisi'
        });
      }

      // Check if config exists
      const [existing] = await sequelize.query(`
        SELECT id FROM dinas_config WHERE dinas_id = :dinasId LIMIT 1
      `, {
        replacements: { dinasId },
        type: sequelize.QueryTypes.SELECT
      });

      if (existing) {
        // Update existing config
        await sequelize.query(`
          UPDATE dinas_config 
          SET 
            nama_pic = :nama_pic,
            nip_pic = :nip_pic,
            jabatan_pic = :jabatan_pic,
            updated_at = CURRENT_TIMESTAMP
          WHERE dinas_id = :dinasId
        `, {
          replacements: { dinasId, nama_pic, nip_pic, jabatan_pic }
        });

        res.json({
          success: true,
          message: 'Konfigurasi dinas berhasil diperbarui',
          data: { ...existing, nama_pic, nip_pic, jabatan_pic }
        });
      } else {
        // Insert new config
        await sequelize.query(`
          INSERT INTO dinas_config (dinas_id, nama_pic, nip_pic, jabatan_pic)
          VALUES (:dinasId, :nama_pic, :nip_pic, :jabatan_pic)
        `, {
          replacements: { dinasId, nama_pic, nip_pic, jabatan_pic }
        });

        res.status(201).json({
          success: true,
          message: 'Konfigurasi dinas berhasil dibuat',
          data: { dinas_id: dinasId, nama_pic, nip_pic, jabatan_pic }
        });
      }
    } catch (error) {
      console.error('Error upserting dinas config:', error);
      res.status(500).json({
        success: false,
        message: 'Gagal menyimpan konfigurasi dinas',
        error: error.message
      });
    }
  }

  /**
   * Upload TTD (signature) file
   * POST /api/dinas/:bidangId/config/upload-ttd
   */
  async uploadTTD(req, res) {
    try {
      const { dinasId } = req.params;

      if (!req.file) {
        return res.status(400).json({
          success: false,
          message: 'File tanda tangan wajib diunggah'
        });
      }

      // Ensure config exists
      const [config] = await sequelize.query(`
        SELECT id, ttd_path FROM dinas_config WHERE dinas_id = :dinasId LIMIT 1
      `, {
        replacements: { dinasId },
        type: sequelize.QueryTypes.SELECT
      });

      if (!config) {
        return res.status(404).json({
          success: false,
          message: 'Konfigurasi dinas belum dibuat. Silakan isi data PIC terlebih dahulu.'
        });
      }

      // Delete old TTD file if exists
      if (config.ttd_path) {
        const oldFilePath = path.join(__dirname, '../../storage/uploads', config.ttd_path);
        if (fs.existsSync(oldFilePath)) {
          fs.unlinkSync(oldFilePath);
        }
      }

      // Save file path
      const fileName = `dinas_ttd_${dinasId}_${Date.now()}${path.extname(req.file.originalname)}`;
      const uploadDir = path.join(__dirname, '../../storage/uploads/dinas_ttd');
      
      if (!fs.existsSync(uploadDir)) {
        fs.mkdirSync(uploadDir, { recursive: true });
      }

      const filePath = path.join(uploadDir, fileName);
      fs.renameSync(req.file.path, filePath);

      const ttdPath = `dinas_ttd/${fileName}`;

      // Update config with new TTD path
      await sequelize.query(`
        UPDATE dinas_config 
        SET ttd_path = :ttdPath, updated_at = CURRENT_TIMESTAMP
        WHERE dinas_id = :dinasId
      `, {
        replacements: { dinasId, ttdPath }
      });

      res.json({
        success: true,
        message: 'Tanda tangan berhasil diunggah',
        data: { ttd_path: ttdPath }
      });
    } catch (error) {
      console.error('Error uploading TTD:', error);
      res.status(500).json({
        success: false,
        message: 'Gagal mengunggah tanda tangan',
        error: error.message
      });
    }
  }

  /**
   * Delete TTD file
   * DELETE /api/dinas/:bidangId/config/ttd
   */
  async deleteTTD(req, res) {
    try {
      const { dinasId } = req.params;

      const [config] = await sequelize.query(`
        SELECT ttd_path FROM dinas_config WHERE dinas_id = :dinasId LIMIT 1
      `, {
        replacements: { dinasId },
        type: sequelize.QueryTypes.SELECT
      });

      if (!config || !config.ttd_path) {
        return res.status(404).json({
          success: false,
          message: 'Tanda tangan tidak ditemukan'
        });
      }

      // Delete file
      const filePath = path.join(__dirname, '../../storage/uploads', config.ttd_path);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }

      // Update database
      await sequelize.query(`
        UPDATE dinas_config 
        SET ttd_path = NULL, updated_at = CURRENT_TIMESTAMP
        WHERE dinas_id = :dinasId
      `, {
        replacements: { dinasId }
      });

      res.json({
        success: true,
        message: 'Tanda tangan berhasil dihapus'
      });
    } catch (error) {
      console.error('Error deleting TTD:', error);
      res.status(500).json({
        success: false,
        message: 'Gagal menghapus tanda tangan',
        error: error.message
      });
    }
  }
}

// Export controller instance with bound methods
const controller = new DinasConfigController();

module.exports = {
  getConfig: controller.getConfig.bind(controller),
  upsertConfig: controller.upsertConfig.bind(controller),
  uploadTTD: controller.uploadTTD.bind(controller),
  deleteTTD: controller.deleteTTD.bind(controller)
};
