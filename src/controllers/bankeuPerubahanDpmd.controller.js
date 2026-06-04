const sequelize = require('../config/database');
const logger = require('../utils/logger');
const ActivityLogger = require('../utils/activityLogger');
const { fetchVersions, fetchRevisions } = require('../utils/bankeuPerubahanRevisionService');

const MODULE_NAME = 'bankeu_perubahan';

class BankeuPerubahanDpmdController {
  /**
   * Get proposals perubahan untuk DPMD/SPKED
   * GET /api/dpmd/bankeu-perubahan/proposals?tahun=2026
   */
  async getProposals(req, res) {
    try {
      const { status, jenis_kegiatan, desa_id, kecamatan_id, tahun } = req.query;

      // Hanya tampilkan proposal yang sudah disubmit ke DPMD oleh kecamatan
      let whereClause = `WHERE bp.submitted_to_dpmd = TRUE
        AND bp.kecamatan_status = 'approved'`;
      const replacements = [];

      if (tahun) { whereClause += ' AND bp.tahun_anggaran = ?'; replacements.push(parseInt(tahun)); }
      if (status) { whereClause += ' AND bp.dpmd_status = ?'; replacements.push(status); }
      if (jenis_kegiatan) { whereClause += ' AND bp.jenis_kegiatan = ?'; replacements.push(jenis_kegiatan); }
      if (desa_id) { whereClause += ' AND bp.desa_id = ?'; replacements.push(desa_id); }
      if (kecamatan_id) { whereClause += ' AND d.kecamatan_id = ?'; replacements.push(kecamatan_id); }

      const [proposals] = await sequelize.query(`
        SELECT
          bp.id, bp.desa_id, bp.kecamatan_id, bp.tahun_anggaran,
          bp.jenis_kegiatan, bp.kegiatan_id, bp.kegiatan_nama,
          bp.nama_kegiatan_spesifik, bp.volume, bp.lokasi,
          bp.judul_proposal, bp.deskripsi, bp.file_proposal, bp.file_size,
          bp.anggaran_usulan,
          bp.status,
          bp.kecamatan_status, bp.kecamatan_catatan, bp.kecamatan_verified_at,
          bp.dpmd_status, bp.dpmd_catatan, bp.dpmd_verified_at,
          bp.submitted_to_kecamatan, bp.submitted_at,
          bp.submitted_to_dpmd, bp.submitted_to_dpmd_at,
          bp.surat_pengantar, bp.surat_permohonan,
          bp.berita_acara_path, bp.berita_acara_generated_at,
          bp.berita_acara_qr_code, bp.berita_acara_version,
          bp.surat_pengantar_kecamatan_path,
          bp.surat_pengantar_kecamatan_nomor,
          bp.surat_pengantar_kecamatan_generated_at,
          bp.quisioner_completed,
          bp.created_at, bp.updated_at,
          u_kec.name AS kecamatan_verified_by_name,
          u_dpmd.name AS dpmd_verified_by_name,
          d.nama AS desa_nama,
          d.kecamatan_id AS desa_kecamatan_id,
          k.nama AS kecamatan_nama
        FROM bankeu_perubahan_proposals bp
        INNER JOIN desas d ON bp.desa_id = d.id
        LEFT JOIN kecamatans k ON d.kecamatan_id = k.id
        LEFT JOIN users u_kec ON bp.kecamatan_verified_by = u_kec.id
        LEFT JOIN users u_dpmd ON bp.dpmd_verified_by = u_dpmd.id
        ${whereClause}
        ORDER BY bp.created_at DESC
      `, { replacements });

      for (const proposal of proposals) {
        const [kegiatan] = await sequelize.query(`
          SELECT bmk.id, bmk.kategori, bmk.nama_kegiatan, bmk.urutan
          FROM bankeu_perubahan_proposal_kegiatan bppk
          JOIN bankeu_perubahan_master_kegiatan bmk ON bppk.kegiatan_id = bmk.id
          WHERE bppk.proposal_id = ?
          ORDER BY bmk.urutan
        `, { replacements: [proposal.id] });
        proposal.kegiatan_list = kegiatan;
      }

      res.json({ success: true, data: proposals });
    } catch (error) {
      logger.error('[BankeuPerubahan DPMD] Error fetching proposals:', error);
      res.status(500).json({
        success: false,
        message: 'Gagal mengambil data proposal perubahan',
        error: error.message
      });
    }
  }

  /**
   * Verifikasi DPMD (approve/reject/revision)
   * PATCH /api/dpmd/bankeu-perubahan/proposals/:id/verify
   */
  async verifyProposal(req, res) {
    try {
      const { id } = req.params;
      const userId = req.user.id;
      const { status, catatan } = req.body;

      if (!['approved', 'rejected', 'revision'].includes(status)) {
        return res.status(400).json({
          success: false,
          message: 'Status verifikasi tidak valid'
        });
      }

      const [users] = await sequelize.query(`SELECT name FROM users WHERE id = ?`, { replacements: [userId] });

      const [proposals] = await sequelize.query(`
        SELECT id, judul_proposal, dpmd_status, submitted_to_dpmd
        FROM bankeu_perubahan_proposals WHERE id = ?
      `, { replacements: [id] });

      if (!proposals.length) {
        return res.status(404).json({ success: false, message: 'Proposal tidak ditemukan' });
      }
      const proposal = proposals[0];
      if (!proposal.submitted_to_dpmd) {
        return res.status(400).json({
          success: false,
          message: 'Proposal belum disubmit ke DPMD'
        });
      }

      // Jika rejected/revision -> kembalikan ke kecamatan (submitted_to_dpmd = FALSE)
      const returnToKec = (status === 'rejected' || status === 'revision');

      await sequelize.query(`
        UPDATE bankeu_perubahan_proposals
        SET dpmd_status = ?,
            dpmd_catatan = ?,
            dpmd_verified_by = ?,
            dpmd_verified_at = NOW(),
            submitted_to_dpmd = ?,
            status = ?,
            updated_at = NOW()
        WHERE id = ?
      `, {
        replacements: [
          status, catatan || null, userId,
          returnToKec ? false : true,
          status === 'approved' ? 'verified' : (status === 'revision' ? 'revision' : 'rejected'),
          id
        ]
      });

      logger.info(`[BankeuPerubahan DPMD] Proposal #${id} ${status} by user ${userId}`);

      ActivityLogger.log({
        userId,
        userName: users[0]?.name || `User ${userId}`,
        userRole: req.user.role,
        bidangId: 3,
        module: MODULE_NAME,
        action: status === 'approved' ? 'approve' : 'reject',
        entityType: 'bankeu_perubahan_proposal',
        entityId: parseInt(id),
        entityName: proposal.judul_proposal,
        description: `${users[0]?.name || 'User'} ${status === 'approved' ? 'menyetujui' : (status === 'revision' ? 'meminta revisi' : 'menolak')} proposal perubahan #${id} di DPMD`,
        newValue: { dpmd_status: status, catatan: catatan || null },
        ipAddress: ActivityLogger.getIpFromRequest(req),
        userAgent: ActivityLogger.getUserAgentFromRequest(req)
      });

      res.json({
        success: true,
        message: `Proposal berhasil di-${status === 'approved' ? 'setujui' : (status === 'revision' ? 'minta revisi' : 'tolak')} oleh DPMD`
      });
    } catch (error) {
      logger.error('[BankeuPerubahan DPMD] Error verify:', error);
      res.status(500).json({ success: false, message: 'Gagal memverifikasi proposal', error: error.message });
    }
  }

  /**
   * Statistik proposal perubahan di DPMD
   * GET /api/dpmd/bankeu-perubahan/statistics
   */
  async getStatistics(req, res) {
    try {
      const { tahun } = req.query;

      let whereTahun = '';
      const replacements = [];
      if (tahun) { whereTahun = 'AND tahun_anggaran = ?'; replacements.push(parseInt(tahun)); }

      const [stats] = await sequelize.query(`
        SELECT
          COUNT(*) AS total,
          SUM(CASE WHEN dpmd_status = 'pending' THEN 1 ELSE 0 END) AS pending,
          SUM(CASE WHEN dpmd_status = 'approved' THEN 1 ELSE 0 END) AS approved,
          SUM(CASE WHEN dpmd_status = 'rejected' THEN 1 ELSE 0 END) AS rejected,
          SUM(CASE WHEN dpmd_status = 'revision' THEN 1 ELSE 0 END) AS revision,
          SUM(CASE WHEN anggaran_usulan IS NOT NULL THEN anggaran_usulan ELSE 0 END) AS total_anggaran
        FROM bankeu_perubahan_proposals
        WHERE submitted_to_dpmd = TRUE
          ${whereTahun}
      `, { replacements });

      res.json({ success: true, data: stats[0] || {} });
    } catch (error) {
      logger.error('[BankeuPerubahan DPMD] Error stats:', error);
      res.status(500).json({ success: false, message: 'Gagal mengambil statistik', error: error.message });
    }
  }

  /**
   * Activity history per proposal
   * GET /api/dpmd/bankeu-perubahan/proposals/:proposalId/history
   */
  async getProposalVerificationHistory(req, res) {
    try {
      const { proposalId } = req.params;

      const [logs] = await sequelize.query(`
        SELECT id, user_id, user_name, user_role, action, description,
               new_value, old_value, created_at
        FROM activity_logs
        WHERE module = ? AND entity_type = 'bankeu_perubahan_proposal' AND entity_id = ?
        ORDER BY created_at DESC
        LIMIT 100
      `, { replacements: [MODULE_NAME, proposalId] });

      res.json({ success: true, data: logs });
    } catch (error) {
      logger.error('[BankeuPerubahan DPMD] Error history:', error);
      res.status(500).json({ success: false, message: 'Gagal mengambil riwayat', error: error.message });
    }
  }

  /**
   * Riwayat versi dokumen (DPMD melihat seluruh versi).
   * GET /api/dpmd/bankeu-perubahan/proposals/:id/versions
   */
  async getProposalVersions(req, res) {
    try {
      const { id } = req.params;
      res.json({ success: true, data: await fetchVersions(id) });
    } catch (error) {
      logger.error('[BankeuPerubahan DPMD] Error getProposalVersions:', error);
      res.status(500).json({ success: false, message: 'Gagal mengambil versi dokumen', error: error.message });
    }
  }

  /**
   * Riwayat ronde revisi/anotasi (DPMD melihat seluruh ronde).
   * GET /api/dpmd/bankeu-perubahan/proposals/:id/revisions
   */
  async getProposalRevisions(req, res) {
    try {
      const { id } = req.params;
      res.json({ success: true, data: await fetchRevisions(id) });
    } catch (error) {
      logger.error('[BankeuPerubahan DPMD] Error getProposalRevisions:', error);
      res.status(500).json({ success: false, message: 'Gagal mengambil riwayat revisi', error: error.message });
    }
  }
}

module.exports = new BankeuPerubahanDpmdController();
