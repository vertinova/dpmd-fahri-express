const sequelize = require('../config/database');
const path = require('path');
const fs = require('fs');

/**
 * Controller for Kecamatan Bankeu Tim Configuration
 * Uses tim_verifikasi_kecamatan table
 * 
 * Struktur Tim Verifikasi:
 * - Ketua & Sekretaris: proposal_id = NULL (shared across all proposals in kecamatan)
 * - Anggota: proposal_id = specific proposal ID (different per proposal)
 * 
 * jabatan = posisi (ketua, sekretaris, anggota_1, etc)
 * jabatan_label = actual jabatan description
 */
class KecamatanBankeuTimConfigController {
  /**
   * Get all tim config for a kecamatan (shared members: ketua & sekretaris)
   * GET /api/kecamatan/:kecamatanId/bankeu/tim-config
   */
  async getAllTimConfig(req, res) {
    try {
      const { kecamatanId } = req.params;
      const { proposalId } = req.query;
      
      let query = `
        SELECT 
          t.id,
          t.kecamatan_id,
          t.proposal_id,
          t.jabatan as posisi,
          t.nama,
          t.nip,
          t.jabatan_label as jabatan,
          t.ttd_path,
          t.is_active,
          t.created_at,
          t.updated_at,
          CASE 
            WHEN q.id IS NOT NULL THEN 1
            ELSE 0
          END as has_questionnaire
        FROM tim_verifikasi_kecamatan t
        LEFT JOIN bankeu_verification_questionnaires q 
          ON q.tim_verifikasi_id = t.id 
          AND q.verifikasi_type = 'kecamatan_tim'
          ${proposalId ? 'AND q.proposal_id = :proposalId' : ''}
        WHERE t.kecamatan_id = :kecamatanId AND t.is_active = 1
      `;
      
      const replacements = { kecamatanId };

      if (proposalId) {
        // Get shared members (ketua, sekretaris) + proposal-specific members (anggota)
        query += ` AND (t.proposal_id IS NULL OR t.proposal_id = :proposalId)`;
        replacements.proposalId = proposalId;
      } else {
        // Only get shared members (ketua, sekretaris)
        query += ` AND t.proposal_id IS NULL`;
      }

      query += ` ORDER BY 
          FIELD(t.jabatan, 'ketua', 'sekretaris', 'anggota_1', 'anggota_2', 'anggota_3', 'anggota_4', 'anggota_5')`;

      const timConfig = await sequelize.query(query, {
        replacements,
        type: sequelize.QueryTypes.SELECT
      });

      // Convert has_questionnaire to boolean
      const result = timConfig.map(member => ({
        ...member,
        has_questionnaire: !!member.has_questionnaire
      }));

      res.json({
        success: true,
        data: result
      });
    } catch (error) {
      console.error('Error getting tim config:', error);
      res.status(500).json({
        success: false,
        message: 'Gagal mengambil konfigurasi tim',
        error: error.message
      });
    }
  }

  /**
   * Get specific tim member config
   * GET /api/kecamatan/:kecamatanId/bankeu/tim-config/:posisi
   */
  async getTimMemberConfig(req, res) {
    try {
      const { kecamatanId, posisi } = req.params;
      const { proposalId } = req.query;

      let whereClause = 'kecamatan_id = :kecamatanId AND jabatan = :posisi';
      const replacements = { kecamatanId, posisi };

      // For anggota, need proposal_id; for ketua/sekretaris, proposal_id is NULL
      if (posisi.startsWith('anggota_') && proposalId) {
        whereClause += ' AND proposal_id = :proposalId';
        replacements.proposalId = proposalId;
      } else if (!posisi.startsWith('anggota_')) {
        whereClause += ' AND proposal_id IS NULL';
      }
      
      const [config] = await sequelize.query(`
        SELECT 
          id,
          kecamatan_id,
          proposal_id,
          jabatan as posisi,
          nama,
          nip,
          jabatan_label as jabatan,
          ttd_path,
          is_active,
          created_at,
          updated_at
        FROM tim_verifikasi_kecamatan
        WHERE ${whereClause}
        LIMIT 1
      `, {
        replacements,
        type: sequelize.QueryTypes.SELECT
      });

      if (!config) {
        return res.json({
          success: true,
          data: null,
          message: 'Konfigurasi belum dibuat'
        });
      }

      res.json({
        success: true,
        data: config
      });
    } catch (error) {
      console.error('Error getting tim member config:', error);
      res.status(500).json({
        success: false,
        message: 'Gagal mengambil konfigurasi anggota tim',
        error: error.message
      });
    }
  }

  /**
   * Create or update tim member config
   * POST /api/kecamatan/:kecamatanId/bankeu/tim-config/:posisi
   * 
   * Body: { nama, nip, jabatan, proposalId? }
   * - proposalId required for anggota_*, optional/ignored for ketua/sekretaris
   */
  async upsertTimMemberConfig(req, res) {
    try {
      const { kecamatanId, posisi } = req.params;
      const { nama, nip, jabatan, proposalId, sourceTtdPath } = req.body;

      if (!nama || !jabatan) {
        return res.status(400).json({
          success: false,
          message: 'Nama dan Jabatan wajib diisi'
        });
      }

      // For anggota, proposalId is required
      const isAnggota = posisi.startsWith('anggota_');
      if (isAnggota && !proposalId) {
        return res.status(400).json({
          success: false,
          message: 'Proposal ID wajib untuk anggota tim'
        });
      }

      // For ketua/sekretaris, proposalId should be null
      const effectiveProposalId = isAnggota ? proposalId : null;

      // Check if exists
      let whereClause = 'kecamatan_id = :kecamatanId AND jabatan = :posisi';
      const replacements = { kecamatanId, posisi, nama, nip, jabatan };

      if (isAnggota) {
        whereClause += ' AND proposal_id = :proposalId';
        replacements.proposalId = proposalId;
      } else {
        whereClause += ' AND proposal_id IS NULL';
      }

      const [existing] = await sequelize.query(`
        SELECT id FROM tim_verifikasi_kecamatan 
        WHERE ${whereClause}
        LIMIT 1
      `, {
        replacements,
        type: sequelize.QueryTypes.SELECT
      });

      if (existing) {
        // Update
        await sequelize.query(`
          UPDATE tim_verifikasi_kecamatan 
          SET nama = :nama, nip = :nip, jabatan_label = :jabatan, updated_at = CURRENT_TIMESTAMP
          WHERE ${whereClause}
        `, {
          replacements
        });

        res.json({
          success: true,
          message: 'Konfigurasi anggota tim berhasil diperbarui',
          data: { id: existing.id, kecamatan_id: kecamatanId, proposal_id: effectiveProposalId, posisi, nama, nip, jabatan }
        });
      } else {
        // Insert
        const insertReplacements = { 
          kecamatanId, 
          posisi, 
          nama, 
          nip, 
          jabatan,
          proposalId: effectiveProposalId
        };

        // If sourceTtdPath provided, copy the TTD file for the new member
        let copiedTtdPath = null;
        if (sourceTtdPath) {
          try {
            const sourceFullPath = path.join(__dirname, '../../storage/uploads', sourceTtdPath);
            if (fs.existsSync(sourceFullPath)) {
              const uploadDir = path.join(__dirname, '../../storage/uploads/kecamatan_bankeu_ttd');
              if (!fs.existsSync(uploadDir)) {
                fs.mkdirSync(uploadDir, { recursive: true });
              }
              const fileSuffix = isAnggota && proposalId ? `${posisi}_p${proposalId}` : posisi;
              const ext = path.extname(sourceTtdPath);
              const newFileName = `kecamatan_${kecamatanId}_${fileSuffix}_${Date.now()}${ext}`;
              const destFullPath = path.join(uploadDir, newFileName);
              fs.copyFileSync(sourceFullPath, destFullPath);
              copiedTtdPath = `kecamatan_bankeu_ttd/${newFileName}`;
            }
          } catch (copyErr) {
            console.error('Error copying TTD file:', copyErr);
            // Non-fatal, continue without TTD
          }
        }

        insertReplacements.ttdPath = copiedTtdPath;

        const [result] = await sequelize.query(`
          INSERT INTO tim_verifikasi_kecamatan (kecamatan_id, proposal_id, jabatan, nama, nip, jabatan_label, ttd_path, is_active)
          VALUES (:kecamatanId, :proposalId, :posisi, :nama, :nip, :jabatan, :ttdPath, 1)
        `, {
          replacements: insertReplacements
        });

        res.status(201).json({
          success: true,
          message: 'Konfigurasi anggota tim berhasil dibuat',
          data: { id: result.insertId, kecamatan_id: kecamatanId, proposal_id: effectiveProposalId, posisi, nama, nip, jabatan, ttd_path: copiedTtdPath }
        });
      }
    } catch (error) {
      console.error('Error upserting tim member config:', error);
      res.status(500).json({
        success: false,
        message: 'Gagal menyimpan konfigurasi anggota tim',
        error: error.message
      });
    }
  }

  /**
   * Upload TTD for tim member
   * POST /api/kecamatan/:kecamatanId/bankeu/tim-config/:posisi/upload-ttd
   */
  async uploadTTD(req, res) {
    try {
      const { kecamatanId, posisi } = req.params;
      const { proposalId } = req.body;

      if (!req.file) {
        return res.status(400).json({
          success: false,
          message: 'File tanda tangan wajib diunggah'
        });
      }

      const isAnggota = posisi.startsWith('anggota_');
      
      // Build where clause
      let whereClause = 'kecamatan_id = :kecamatanId AND jabatan = :posisi';
      const replacements = { kecamatanId, posisi };

      if (isAnggota && proposalId) {
        whereClause += ' AND proposal_id = :proposalId';
        replacements.proposalId = proposalId;
      } else if (!isAnggota) {
        whereClause += ' AND proposal_id IS NULL';
      }

      // Ensure config exists
      const [config] = await sequelize.query(`
        SELECT id, ttd_path FROM tim_verifikasi_kecamatan
        WHERE ${whereClause}
        LIMIT 1
      `, {
        replacements,
        type: sequelize.QueryTypes.SELECT
      });

      if (!config) {
        return res.status(404).json({
          success: false,
          message: 'Konfigurasi belum dibuat. Silakan isi data anggota tim terlebih dahulu.'
        });
      }

      // Delete old TTD if exists
      if (config.ttd_path) {
        const oldFilePath = path.join(__dirname, '../../storage/uploads', config.ttd_path);
        if (fs.existsSync(oldFilePath)) {
          fs.unlinkSync(oldFilePath);
        }
      }

      // Save file
      const fileSuffix = isAnggota && proposalId ? `${posisi}_p${proposalId}` : posisi;
      const fileName = `kecamatan_${kecamatanId}_${fileSuffix}_${Date.now()}${path.extname(req.file.originalname)}`;
      const uploadDir = path.join(__dirname, '../../storage/uploads/kecamatan_bankeu_ttd');
      
      if (!fs.existsSync(uploadDir)) {
        fs.mkdirSync(uploadDir, { recursive: true });
      }

      const filePath = path.join(uploadDir, fileName);
      fs.renameSync(req.file.path, filePath);

      const ttdPath = `kecamatan_bankeu_ttd/${fileName}`;

      // Update config
      await sequelize.query(`
        UPDATE tim_verifikasi_kecamatan 
        SET ttd_path = :ttdPath, updated_at = CURRENT_TIMESTAMP
        WHERE ${whereClause}
      `, {
        replacements: { ...replacements, ttdPath }
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
   * Delete TTD for tim member
   * DELETE /api/kecamatan/:kecamatanId/bankeu/tim-config/:posisi/ttd
   */
  async deleteTTD(req, res) {
    try {
      const { kecamatanId, posisi } = req.params;
      const { proposalId } = req.query;

      const isAnggota = posisi.startsWith('anggota_');
      
      let whereClause = 'kecamatan_id = :kecamatanId AND jabatan = :posisi';
      const replacements = { kecamatanId, posisi };

      if (isAnggota && proposalId) {
        whereClause += ' AND proposal_id = :proposalId';
        replacements.proposalId = proposalId;
      } else if (!isAnggota) {
        whereClause += ' AND proposal_id IS NULL';
      }

      const [config] = await sequelize.query(`
        SELECT id, ttd_path FROM tim_verifikasi_kecamatan
        WHERE ${whereClause}
        LIMIT 1
      `, {
        replacements,
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

      // Update config
      await sequelize.query(`
        UPDATE tim_verifikasi_kecamatan 
        SET ttd_path = NULL, updated_at = CURRENT_TIMESTAMP
        WHERE ${whereClause}
      `, {
        replacements
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

  /**
   * Delete anggota tim (for proposal-specific members only)
   * DELETE /api/kecamatan/:kecamatanId/bankeu/tim-config/:posisi
   */
  async deleteAnggota(req, res) {
    try {
      const { kecamatanId, posisi } = req.params;
      const { proposalId } = req.query;

      // Only allow deleting anggota (not ketua/sekretaris)
      if (!posisi.startsWith('anggota_')) {
        return res.status(400).json({
          success: false,
          message: 'Hanya anggota yang dapat dihapus. Ketua dan Sekretaris tidak dapat dihapus.'
        });
      }

      // Try to find anggota - first with proposal_id, then with NULL proposal_id
      let config;
      
      if (proposalId) {
        // First try to find with specific proposal_id
        [config] = await sequelize.query(`
          SELECT id, ttd_path FROM tim_verifikasi_kecamatan
          WHERE kecamatan_id = :kecamatanId AND jabatan = :posisi AND proposal_id = :proposalId
          LIMIT 1
        `, {
          replacements: { kecamatanId, posisi, proposalId },
          type: sequelize.QueryTypes.SELECT
        });
      }
      
      // If not found with proposal_id, try with NULL (legacy data)
      if (!config) {
        [config] = await sequelize.query(`
          SELECT id, ttd_path FROM tim_verifikasi_kecamatan
          WHERE kecamatan_id = :kecamatanId AND jabatan = :posisi AND proposal_id IS NULL
          LIMIT 1
        `, {
          replacements: { kecamatanId, posisi },
          type: sequelize.QueryTypes.SELECT
        });
      }

      if (!config) {
        return res.status(404).json({
          success: false,
          message: 'Anggota tidak ditemukan'
        });
      }

      // Delete TTD file if exists
      if (config.ttd_path) {
        const filePath = path.join(__dirname, '../../storage/uploads', config.ttd_path);
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
        }
      }

      // Delete record by ID (more precise)
      await sequelize.query(`
        DELETE FROM tim_verifikasi_kecamatan
        WHERE id = :id
      `, {
        replacements: { id: config.id }
      });

      res.json({
        success: true,
        message: 'Anggota tim berhasil dihapus'
      });
    } catch (error) {
      console.error('Error deleting anggota:', error);
      res.status(500).json({
        success: false,
        message: 'Gagal menghapus anggota tim',
        error: error.message
      });
    }
  }

  /**
   * Get distinct anggota yang pernah ditambahkan di kecamatan ini
   * GET /api/kecamatan/:kecamatanId/bankeu/tim-config/anggota-list
   * Returns unique (nama, nip, jabatan_label) combinations
   */
  async getAnggotaList(req, res) {
    try {
      const { kecamatanId } = req.params;

      const query = `
        SELECT t.nama, t.nip, t.jabatan_label as jabatan, t.ttd_path
        FROM tim_verifikasi_kecamatan t
        WHERE t.kecamatan_id = :kecamatanId
          AND t.jabatan LIKE 'anggota_%'
          AND t.is_active = 1
          AND t.nama IS NOT NULL
          AND t.nama != ''
        ORDER BY t.ttd_path DESC, t.nama ASC
      `;

      const results = await sequelize.query(query, {
        replacements: { kecamatanId },
        type: sequelize.QueryTypes.SELECT
      });

      // Deduplicate by nama (case-insensitive), prefer one with ttd_path
      const seen = new Set();
      const unique = results.filter(r => {
        const key = r.nama.toLowerCase().trim();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });

      res.json({
        success: true,
        data: unique
      });
    } catch (error) {
      console.error('Error getting anggota list:', error);
      res.status(500).json({
        success: false,
        message: 'Gagal mengambil daftar anggota',
        error: error.message
      });
    }
  }
}

module.exports = new KecamatanBankeuTimConfigController();
