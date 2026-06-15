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

      // Tetap tampilkan proposal yang sudah pernah diterima DPMD lalu
      // dikembalikan ke kecamatan untuk revisi dokumen.
      let whereClause = `WHERE (
          bp.submitted_to_dpmd = TRUE
          OR bp.dpmd_status IN ('revision', 'rejected')
        )
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
          bp.troubleshoot_catatan, bp.troubleshoot_at,
          bp.created_at, bp.updated_at,
          u_kec.name AS kecamatan_verified_by_name,
          u_dpmd.name AS dpmd_verified_by_name,
          u_ts.name AS troubleshoot_by_name,
          d.nama AS desa_nama,
          d.kecamatan_id AS desa_kecamatan_id,
          k.nama AS kecamatan_nama
        FROM bankeu_perubahan_proposals bp
        INNER JOIN desas d ON bp.desa_id = d.id
        LEFT JOIN kecamatans k ON d.kecamatan_id = k.id
        LEFT JOIN users u_kec ON bp.kecamatan_verified_by = u_kec.id
        LEFT JOIN users u_dpmd ON bp.dpmd_verified_by = u_dpmd.id
        LEFT JOIN users u_ts ON bp.troubleshoot_by = u_ts.id
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
   * Tracking lintas-tahap untuk SPKED: SEMUA proposal perubahan (apapun statusnya,
   * termasuk yang masih di Desa/Kecamatan) — dipakai tab Tracking & Partisipasi Desa.
   * Berbeda dari getProposals yang sengaja dibatasi ke yang sudah sampai DPMD.
   * GET /api/dpmd/bankeu-perubahan/tracking?tahun=2026
   */
  async getTracking(req, res) {
    try {
      const { tahun } = req.query;
      let whereClause = 'WHERE 1=1';
      const replacements = [];
      if (tahun) { whereClause += ' AND bp.tahun_anggaran = ?'; replacements.push(parseInt(tahun)); }

      const [proposals] = await sequelize.query(`
        SELECT
          bp.id, bp.desa_id, bp.kecamatan_id, bp.tahun_anggaran,
          bp.jenis_kegiatan, bp.kegiatan_id, bp.kegiatan_nama, bp.nama_kegiatan_spesifik,
          bp.volume, bp.lokasi, bp.judul_proposal, bp.anggaran_usulan,
          bp.status,
          bp.kecamatan_status, bp.kecamatan_catatan, bp.kecamatan_verified_at,
          bp.dpmd_status, bp.dpmd_catatan, bp.dpmd_verified_at,
          bp.submitted_to_kecamatan, bp.submitted_at,
          bp.submitted_to_dpmd, bp.submitted_to_dpmd_at,
          bp.troubleshoot_catatan, bp.troubleshoot_at,
          bp.created_at, bp.updated_at,
          u_kec.name AS kecamatan_verified_by_name,
          u_dpmd.name AS dpmd_verified_by_name,
          u_ts.name AS troubleshoot_by_name,
          d.nama AS desa_nama,
          d.kecamatan_id AS desa_kecamatan_id,
          k.nama AS kecamatan_nama
        FROM bankeu_perubahan_proposals bp
        INNER JOIN desas d ON bp.desa_id = d.id
        LEFT JOIN kecamatans k ON d.kecamatan_id = k.id
        LEFT JOIN users u_kec ON bp.kecamatan_verified_by = u_kec.id
        LEFT JOIN users u_dpmd ON bp.dpmd_verified_by = u_dpmd.id
        LEFT JOIN users u_ts ON bp.troubleshoot_by = u_ts.id
        ${whereClause}
        ORDER BY k.nama ASC, d.nama ASC, bp.created_at DESC
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
      logger.error('[BankeuPerubahan DPMD] Error fetching tracking:', error);
      res.status(500).json({ success: false, message: 'Gagal mengambil data tracking perubahan', error: error.message });
    }
  }

  /**
   * Verifikasi DPMD atas DOKUMEN KECAMATAN (Surat Pengantar & Berita Acara).
   * DPMD TIDAK menilai isi proposal desa — hanya memverifikasi SP & BA dari kecamatan.
   * (Mengikuti flow Bankeu Reguler.)
   * - approved   : SP & BA disetujui (final) -> Disetujui DPMD.
   * - revision   : minta kecamatan revisi SP & BA -> dikembalikan ke kecamatan,
   *                path BA/SP dikosongkan agar kecamatan men-generate ulang.
   *                (kecamatan_status tetap 'approved', proposal desa tidak diubah)
   * PATCH /api/dpmd/bankeu-perubahan/proposals/:id/verify
   */
  async verifyProposal(req, res) {
    try {
      const { id } = req.params;
      const userId = req.user.id;
      const { status, catatan } = req.body;

      if (!['approved', 'revision'].includes(status)) {
        return res.status(400).json({
          success: false,
          message: 'Status verifikasi tidak valid. Gunakan: approved atau revision (revisi SP & BA kecamatan)'
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

      const isRevision = status === 'revision';
      if (isRevision && !catatan?.trim()) {
        return res.status(400).json({ success: false, message: 'Catatan revisi wajib diisi' });
      }

      // Revisi SP/BA: kembalikan ke kecamatan & kosongkan dokumen kecamatan agar regenerate.
      // kecamatan_status tetap 'approved' supaya kecamatan langsung bisa generate ulang & kirim.
      const clearDocsSql = isRevision ? `,
            berita_acara_path = NULL,
            berita_acara_generated_at = NULL,
            berita_acara_qr_code = NULL,
            surat_pengantar_kecamatan_path = NULL,
            surat_pengantar_kecamatan_nomor = NULL,
            surat_pengantar_kecamatan_generated_at = NULL` : '';

      await sequelize.query(`
        UPDATE bankeu_perubahan_proposals
        SET dpmd_status = ?,
            dpmd_catatan = ?,
            dpmd_verified_by = ?,
            dpmd_verified_at = NOW(),
            submitted_to_dpmd = ?,
            status = ?${clearDocsSql},
            updated_at = NOW()
        WHERE id = ?
      `, {
        replacements: [
          status, catatan || null, userId,
          isRevision ? false : true,
          isRevision ? 'verified' : 'verified', // tetap verified (kecamatan-approved); keputusan ada di dpmd_status
          id
        ]
      });

      logger.info(`[BankeuPerubahan DPMD] Proposal #${id} ${isRevision ? 'revisi SP/BA (kembali ke kecamatan)' : 'disetujui'} by user ${userId}`);

      ActivityLogger.log({
        userId,
        userName: users[0]?.name || `User ${userId}`,
        userRole: req.user.role,
        bidangId: 3,
        module: MODULE_NAME,
        action: isRevision ? 'revision' : 'approve',
        entityType: 'bankeu_perubahan_proposal',
        entityId: parseInt(id),
        entityName: proposal.judul_proposal,
        description: isRevision
          ? `${users[0]?.name || 'User'} meminta kecamatan merevisi Surat Pengantar & Berita Acara proposal perubahan #${id}`
          : `${users[0]?.name || 'User'} menyetujui Surat Pengantar & Berita Acara proposal perubahan #${id} di DPMD`,
        newValue: { dpmd_status: status, revision_type: isRevision ? 'dokumen_kecamatan' : undefined, catatan: catatan || null },
        ipAddress: ActivityLogger.getIpFromRequest(req),
        userAgent: ActivityLogger.getUserAgentFromRequest(req)
      });

      res.json({
        success: true,
        message: isRevision
          ? 'Proposal dikembalikan ke Kecamatan untuk revisi Surat Pengantar & Berita Acara'
          : 'Surat Pengantar & Berita Acara disetujui DPMD'
      });
    } catch (error) {
      logger.error('[BankeuPerubahan DPMD] Error verify:', error);
      res.status(500).json({ success: false, message: 'Gagal memverifikasi proposal', error: error.message });
    }
  }

  /**
   * Batalkan keputusan DPMD (mis. salah pencet approve) -> kembali ke "Menunggu DPMD".
   * Proposal tetap berada di DPMD (submitted_to_dpmd = TRUE), hanya keputusan DPMD yang direset.
   * PATCH /api/dpmd/bankeu-perubahan/proposals/:id/cancel-approval
   */
  async cancelApproval(req, res) {
    try {
      const { id } = req.params;
      const userId = req.user.id;

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
        return res.status(400).json({ success: false, message: 'Proposal belum berada di DPMD' });
      }
      if (proposal.dpmd_status !== 'approved') {
        return res.status(400).json({
          success: false,
          message: 'Hanya proposal yang sudah disetujui DPMD yang dapat dibatalkan'
        });
      }

      // Reset keputusan DPMD, kembalikan ke status menunggu (pending) di DPMD.
      // status legacy dikembalikan ke 'verified' (sudah diverifikasi kecamatan, menunggu DPMD).
      await sequelize.query(`
        UPDATE bankeu_perubahan_proposals
        SET dpmd_status = 'pending',
            dpmd_catatan = NULL,
            dpmd_verified_by = NULL,
            dpmd_verified_at = NULL,
            status = 'verified',
            updated_at = NOW()
        WHERE id = ?
      `, { replacements: [id] });

      logger.info(`[BankeuPerubahan DPMD] Proposal #${id} approval dibatalkan by user ${userId}`);

      ActivityLogger.log({
        userId,
        userName: users[0]?.name || `User ${userId}`,
        userRole: req.user.role,
        bidangId: 3,
        module: MODULE_NAME,
        action: 'update',
        entityType: 'bankeu_perubahan_proposal',
        entityId: parseInt(id),
        entityName: proposal.judul_proposal,
        description: `${users[0]?.name || 'User'} membatalkan persetujuan DPMD proposal perubahan #${id}`,
        ipAddress: ActivityLogger.getIpFromRequest(req),
        userAgent: ActivityLogger.getUserAgentFromRequest(req)
      });

      res.json({ success: true, message: 'Persetujuan DPMD berhasil dibatalkan' });
    } catch (error) {
      logger.error('[BankeuPerubahan DPMD] Error cancel approval:', error);
      res.status(500).json({ success: false, message: 'Gagal membatalkan persetujuan', error: error.message });
    }
  }

  /**
   * Troubleshoot Revisi (tool recovery DPMD/SPKED).
   * Paksa kembalikan proposal yang nyangkut / salah-ACC di tahap manapun (Desa/Kecamatan/DPMD)
   * KEMBALI KE DESA untuk direvisi: reset semua status verifikasi + BA/SP + quisioner.
   * Dokumen desa (file_proposal, surat_pengantar, surat_permohonan) tetap dipertahankan.
   * Mengikuti pola Bankeu Reguler (troubleshootRevision).
   * PATCH /api/dpmd/bankeu-perubahan/proposals/:id/troubleshoot-revision
   */
  async troubleshootRevision(req, res) {
    const transaction = await sequelize.transaction();
    try {
      const { id } = req.params;
      const { catatan } = req.body;
      const userId = req.user.id;
      const userRole = req.user.role;

      // Hanya pegawai SPKED yang boleh troubleshoot
      const allowedRoles = ['pegawai', 'kepala_bidang', 'ketua_tim', 'kepala_dinas', 'superadmin'];
      if (!allowedRoles.includes(userRole)) {
        await transaction.rollback();
        return res.status(403).json({ success: false, message: 'Hanya pegawai SPKED yang dapat melakukan troubleshoot revisi' });
      }
      if (!catatan || catatan.trim().length === 0) {
        await transaction.rollback();
        return res.status(400).json({ success: false, message: 'Catatan/alasan troubleshoot wajib diisi' });
      }

      const [proposals] = await sequelize.query(`
        SELECT bp.id, bp.judul_proposal, bp.status, bp.kecamatan_status, bp.dpmd_status,
               bp.submitted_to_kecamatan, bp.submitted_to_dpmd,
               d.nama AS desa_nama, k.nama AS kecamatan_nama
        FROM bankeu_perubahan_proposals bp
        INNER JOIN desas d ON bp.desa_id = d.id
        LEFT JOIN kecamatans k ON d.kecamatan_id = k.id
        WHERE bp.id = ?
      `, { replacements: [id], transaction });

      if (!proposals.length) {
        await transaction.rollback();
        return res.status(404).json({ success: false, message: 'Proposal tidak ditemukan' });
      }
      const proposal = proposals[0];

      // Tentukan tahap saat ini (untuk log & pesan)
      let currentStage = 'di_desa';
      if (proposal.submitted_to_dpmd) currentStage = 'di_dpmd';
      else if (proposal.kecamatan_status === 'approved') currentStage = 'di_kecamatan';
      else if (proposal.submitted_to_kecamatan) currentStage = 'di_kecamatan';

      const desaName = proposal.desa_nama || `Desa ID`;
      const stageLabel = currentStage === 'di_dpmd' ? 'DPMD' : currentStage === 'di_kecamatan' ? 'Kecamatan' : 'Desa';

      const tsCatatan = `[${req.user.name || `User ${userId}`} - ${String(userRole).toUpperCase()}] ${catatan.trim()}`;

      // Reset SEMUA status verifikasi -> kembali ke Desa (status revision).
      // Kosongkan BA/SP kecamatan & quisioner. Dokumen desa dipertahankan.
      await sequelize.query(`
        UPDATE bankeu_perubahan_proposals
        SET status = 'revision',
            kecamatan_status = 'pending',
            kecamatan_catatan = NULL,
            kecamatan_verified_by = NULL,
            kecamatan_verified_at = NULL,
            dpmd_status = 'pending',
            dpmd_catatan = NULL,
            dpmd_verified_by = NULL,
            dpmd_verified_at = NULL,
            submitted_to_kecamatan = FALSE,
            submitted_at = NULL,
            submitted_to_dpmd = FALSE,
            submitted_to_dpmd_at = NULL,
            berita_acara_path = NULL,
            berita_acara_generated_at = NULL,
            berita_acara_qr_code = NULL,
            surat_pengantar_kecamatan_path = NULL,
            surat_pengantar_kecamatan_nomor = NULL,
            surat_pengantar_kecamatan_generated_at = NULL,
            quisioner_completed = FALSE,
            verified_by = NULL,
            verified_at = NULL,
            catatan_verifikasi = NULL,
            troubleshoot_catatan = ?,
            troubleshoot_by = ?,
            troubleshoot_at = NOW(),
            updated_at = NOW()
        WHERE id = ?
      `, { replacements: [tsCatatan, userId, id], transaction });

      // Hapus quisioner terkait karena semua tahap di-reset
      await sequelize.query(
        `DELETE FROM bankeu_perubahan_questionnaires WHERE proposal_id = ?`,
        { replacements: [id], transaction }
      );

      await transaction.commit();

      logger.info(`[BankeuPerubahan DPMD] 🔧 TROUBLESHOOT proposal #${id} (${desaName}) dari tahap ${currentStage} oleh ${req.user.name} (${userRole})`);

      ActivityLogger.log({
        userId,
        userName: req.user.name || `User ${userId}`,
        userRole,
        bidangId: 3,
        module: MODULE_NAME,
        action: 'troubleshoot_revision',
        entityType: 'bankeu_perubahan_proposal',
        entityId: parseInt(id),
        entityName: proposal.judul_proposal,
        description: `[TROUBLESHOOT] ${req.user.name || 'User'} (${userRole}) memaksa revisi proposal perubahan #${id} (${desaName}, ${proposal.kecamatan_nama || ''}) dari tahap ${stageLabel}. Alasan: ${catatan.trim()}`,
        oldValue: { status: proposal.status, kecamatan_status: proposal.kecamatan_status, dpmd_status: proposal.dpmd_status, current_stage: currentStage },
        newValue: { status: 'revision', returned_to: 'desa', troubleshoot_reason: catatan.trim() },
        ipAddress: ActivityLogger.getIpFromRequest(req),
        userAgent: ActivityLogger.getUserAgentFromRequest(req)
      });

      res.json({
        success: true,
        message: `Proposal "${proposal.judul_proposal}" (${desaName}) berhasil dikembalikan ke Desa untuk direvisi dari tahap ${stageLabel}.`,
        data: { id: Number(id), desa_name: desaName, previous_stage: currentStage, returned_to: 'desa', status: 'revision' }
      });
    } catch (error) {
      try { await transaction.rollback(); } catch (e) {}
      logger.error('[BankeuPerubahan DPMD] Error troubleshoot revision:', error);
      res.status(500).json({ success: false, message: 'Gagal melakukan troubleshoot revisi', error: error.message });
    }
  }

  /**
   * Edit detail proposal oleh DPMD/SPKED.
   * PATCH /api/dpmd/bankeu-perubahan/proposals/:id/edit-detail
   */
  async editProposalDetail(req, res) {
    try {
      const { id } = req.params;
      const userId = req.user.id;
      const userRole = req.user.role;
      const { anggaran_usulan, volume, lokasi, nama_kegiatan_spesifik } = req.body;
      const allowedRoles = [
        'pegawai',
        'kepala_bidang',
        'ketua_tim',
        'kepala_dinas',
        'sarana_prasarana',
        'superadmin'
      ];

      if (!allowedRoles.includes(userRole)) {
        return res.status(403).json({
          success: false,
          message: 'Hanya pegawai SPKED yang dapat mengedit detail proposal'
        });
      }

      const [proposals] = await sequelize.query(`
        SELECT bp.id, bp.judul_proposal, bp.anggaran_usulan, bp.volume,
               bp.lokasi, bp.nama_kegiatan_spesifik, d.nama AS desa_nama
        FROM bankeu_perubahan_proposals bp
        INNER JOIN desas d ON bp.desa_id = d.id
        WHERE bp.id = ?
      `, { replacements: [id] });

      if (!proposals.length) {
        return res.status(404).json({ success: false, message: 'Proposal tidak ditemukan' });
      }

      const proposal = proposals[0];
      const fields = [];
      const replacements = [];
      const newValue = {};

      if (anggaran_usulan !== undefined && anggaran_usulan !== '') {
        const anggaranNum = Number(anggaran_usulan);
        if (!Number.isFinite(anggaranNum) || anggaranNum < 0) {
          return res.status(400).json({
            success: false,
            message: 'Anggaran harus berupa angka yang valid'
          });
        }
        if (anggaranNum > 1_500_000_000) {
          return res.status(400).json({
            success: false,
            message: 'Anggaran tidak boleh lebih dari Rp 1.500.000.000'
          });
        }
        fields.push('anggaran_usulan = ?');
        replacements.push(Math.round(anggaranNum));
        newValue.anggaran_usulan = Math.round(anggaranNum);
      }

      const textFields = { volume, lokasi, nama_kegiatan_spesifik };
      Object.entries(textFields).forEach(([field, value]) => {
        if (value === undefined) return;
        const normalizedValue = String(value).trim().substring(0, 255);
        fields.push(`${field} = ?`);
        replacements.push(normalizedValue);
        newValue[field] = normalizedValue;
      });

      if (!fields.length) {
        return res.status(400).json({ success: false, message: 'Tidak ada data yang diubah' });
      }

      replacements.push(id);
      await sequelize.query(`
        UPDATE bankeu_perubahan_proposals
        SET ${fields.join(', ')}, updated_at = NOW()
        WHERE id = ?
      `, { replacements });

      logger.info(`[BankeuPerubahan DPMD] Detail proposal #${id} diedit oleh user ${userId}`);

      ActivityLogger.log({
        userId,
        userName: req.user.name || `User ${userId}`,
        userRole,
        bidangId: 3,
        module: MODULE_NAME,
        action: 'update',
        entityType: 'bankeu_perubahan_proposal',
        entityId: parseInt(id),
        entityName: proposal.judul_proposal || `Proposal #${id}`,
        description: `DPMD/SPKED mengedit detail proposal perubahan #${id} (${proposal.desa_nama || 'Desa'})`,
        oldValue: {
          anggaran_usulan: proposal.anggaran_usulan,
          volume: proposal.volume,
          lokasi: proposal.lokasi,
          nama_kegiatan_spesifik: proposal.nama_kegiatan_spesifik
        },
        newValue,
        ipAddress: ActivityLogger.getIpFromRequest(req),
        userAgent: ActivityLogger.getUserAgentFromRequest(req)
      });

      res.json({
        success: true,
        message: 'Detail proposal berhasil diperbarui',
        data: { id: Number(id), ...newValue }
      });
    } catch (error) {
      logger.error('[BankeuPerubahan DPMD] Error edit detail:', error);
      res.status(500).json({
        success: false,
        message: 'Gagal mengedit detail proposal',
        error: error.message
      });
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
        WHERE (
            submitted_to_dpmd = TRUE
            OR submitted_to_dpmd_at IS NOT NULL
            OR dpmd_verified_at IS NOT NULL
          )
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
