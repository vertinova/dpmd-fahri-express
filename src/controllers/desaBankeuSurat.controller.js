// Controller untuk Surat Pengantar dan Surat Permohonan (per Desa)
const prisma = require('../config/prisma');
const sequelize = require('../config/database');
const path = require('path');
const fs = require('fs');
const logger = require('../utils/logger');

exports.getDesaSurat = async (req, res) => {
  try {
    const desaId = req.user.desa_id;
    const tahun = req.query.tahun || new Date().getFullYear();

    logger.info(`📄 Fetch surat desa - Desa ID: ${desaId}, Tahun: ${tahun}`);

    const [surat] = await sequelize.query(`
      SELECT dbs.*, u.name AS reviewer_name
      FROM desa_bankeu_surat dbs
      LEFT JOIN users u ON dbs.kecamatan_reviewed_by = u.id
      WHERE dbs.desa_id = ? AND dbs.tahun = ?
      LIMIT 1
    `, {
      replacements: [desaId, tahun],
      type: sequelize.QueryTypes.SELECT
    });

    if (!surat) {
      return res.json({
        success: true,
        data: {
          id: null,
          desa_id: desaId,
          tahun: parseInt(tahun),
          surat_pengantar: null,
          surat_permohonan: null,
          submitted_to_kecamatan: false,
          submitted_at: null,
          kecamatan_status: 'pending',
          kecamatan_reviewed_by: null,
          kecamatan_reviewed_at: null,
          kecamatan_catatan: null,
          reviewer_name: null
        }
      });
    }

    res.json({
      success: true,
      data: surat
    });
  } catch (error) {
    logger.error('❌ Error get surat desa:', error);
    res.status(500).json({
      success: false,
      message: 'Gagal mengambil data surat',
      error: error.message
    });
  }
};

exports.uploadSuratDesa = async (req, res) => {
  try {
    const desaId = req.user.desa_id;
    const { jenis, tahun } = req.body;
    const currentYear = tahun || new Date().getFullYear();

    logger.info(`📤 Upload surat desa - Desa ID: ${desaId}, Jenis: ${jenis}, Tahun: ${currentYear}`);

    // Validasi jenis
    if (!['pengantar', 'permohonan'].includes(jenis)) {
      if (req.file) {
        fs.unlinkSync(req.file.path);
      }
      return res.status(400).json({
        success: false,
        message: 'Jenis surat harus "pengantar" atau "permohonan"'
      });
    }

    // Validasi file
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'File surat wajib diupload'
      });
    }

    const filePath = req.file.filename;
    const fieldName = jenis === 'pengantar' ? 'surat_pengantar' : 'surat_permohonan';

    // Check apakah sudah ada record
    const [existing] = await sequelize.query(`
      SELECT * FROM desa_bankeu_surat 
      WHERE desa_id = ? AND tahun = ?
      LIMIT 1
    `, {
      replacements: [desaId, currentYear],
      type: sequelize.QueryTypes.SELECT
    });

    let result;

    if (existing) {
      // Update existing record
      const oldFile = existing[fieldName];

      // Delete old file if exists
      if (oldFile) {
        const oldFilePath = path.join(__dirname, '../../storage/uploads/bankeu', oldFile);
        if (fs.existsSync(oldFilePath)) {
          fs.unlinkSync(oldFilePath);
          logger.info(`🗑️ Deleted old ${jenis}: ${oldFile}`);
        }
      }

      await sequelize.query(`
        UPDATE desa_bankeu_surat
        SET ${fieldName} = ?, updated_at = NOW()
        WHERE id = ?
      `, {
        replacements: [filePath, existing.id]
      });

      result = { id: existing.id, [fieldName]: filePath };
      logger.info(`✅ Updated surat ${jenis} for desa ${desaId}`);
    } else {
      // Insert new record
      const [insertResult] = await sequelize.query(`
        INSERT INTO desa_bankeu_surat (desa_id, tahun, ${fieldName}, created_at, updated_at)
        VALUES (?, ?, ?, NOW(), NOW())
      `, {
        replacements: [desaId, currentYear, filePath]
      });

      result = { id: insertResult, [fieldName]: filePath };
      logger.info(`✅ Created new surat ${jenis} for desa ${desaId}`);
    }

    res.json({
      success: true,
      message: `Surat ${jenis} berhasil diupload`,
      data: result
    });
  } catch (error) {
    logger.error('❌ Error upload surat desa:', error);

    // Delete uploaded file if error
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }

    res.status(500).json({
      success: false,
      message: 'Gagal mengupload surat',
      error: error.message
    });
  }
};

exports.submitSuratToKecamatan = async (req, res) => {
  try {
    const desaId = req.user.desa_id;
    const tahun = req.body.tahun || new Date().getFullYear();

    logger.info(`📨 Submit surat ke kecamatan - Desa ID: ${desaId}, Tahun: ${tahun}`);

    // Check if submission is open
    const submissionSetting = await prisma.app_settings.findUnique({
      where: { setting_key: 'bankeu_submission_desa' }
    });
    
    if (submissionSetting) {
      const { evaluateBankeuSchedule } = require('./appSettings.controller');
      const { isOpen } = evaluateBankeuSchedule(submissionSetting.setting_value);
      if (!isOpen) {
        logger.warn(`⛔ Surat submission blocked - submission is closed by DPMD`);
        return res.status(403).json({
          success: false,
          message: 'Pengajuan saat ini ditutup oleh DPMD. Silakan hubungi DPMD untuk informasi lebih lanjut.'
        });
      }
    }

    // Check surat exists and complete
    const [surat] = await sequelize.query(`
      SELECT * FROM desa_bankeu_surat 
      WHERE desa_id = ? AND tahun = ?
      LIMIT 1
    `, {
      replacements: [desaId, tahun],
      type: sequelize.QueryTypes.SELECT
    });

    if (!surat) {
      return res.status(400).json({
        success: false,
        message: 'Belum ada surat yang diupload'
      });
    }

    if (!surat.surat_pengantar || !surat.surat_permohonan) {
      return res.status(400).json({
        success: false,
        message: 'Surat Pengantar dan Surat Permohonan harus diupload terlebih dahulu'
      });
    }

    if (surat.submitted_to_kecamatan) {
      return res.status(400).json({
        success: false,
        message: 'Surat sudah dikirim ke Kecamatan'
      });
    }

    // Update status dan reset jika rejected sebelumnya
    await sequelize.query(`
      UPDATE desa_bankeu_surat
      SET submitted_to_kecamatan = TRUE, 
          submitted_at = NOW(),
          kecamatan_status = 'pending',
          kecamatan_reviewed_by = NULL,
          kecamatan_reviewed_at = NULL,
          kecamatan_catatan = NULL,
          updated_at = NOW()
      WHERE id = ?
    `, {
      replacements: [surat.id]
    });

    logger.info(`✅ Surat dikirim ke kecamatan - Desa ID: ${desaId}`);

    res.json({
      success: true,
      message: 'Surat berhasil dikirim ke Kecamatan',
      data: {
        id: surat.id,
        submitted_at: new Date()
      }
    });
  } catch (error) {
    logger.error('❌ Error submit surat:', error);
    res.status(500).json({
      success: false,
      message: 'Gagal mengirim surat',
      error: error.message
    });
  }
};
