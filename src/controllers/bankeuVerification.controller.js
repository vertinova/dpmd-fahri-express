const sequelize = require('../config/database');
const prisma = require('../config/prisma');
const logger = require('../utils/logger');
const ActivityLogger = require('../utils/activityLogger');
const path = require('path');
const fs = require('fs');
const PDFDocument = require('pdfkit');
const beritaAcaraService = require('../services/beritaAcaraService');
const sharp = require('sharp');

class BankeuVerificationController {
  /**
   * Get all proposals for kecamatan
   * GET /api/kecamatan/bankeu/proposals
   */
  async getProposalsByKecamatan(req, res) {
    try {
      const userId = req.user.id;
      const { status, jenis_kegiatan, desa_id, tahun } = req.query;

      // Get kecamatan_id from user
      const [users] = await sequelize.query(`
        SELECT kecamatan_id FROM users WHERE id = ?
      `, { replacements: [userId] });

      if (!users || users.length === 0 || !users[0].kecamatan_id) {
        return res.status(403).json({
          success: false,
          message: 'User tidak terkait dengan kecamatan'
        });
      }

      const kecamatanId = users[0].kecamatan_id;

      // Show ALL proposals from desa in this kecamatan
      // NEW FLOW 2026-02-02: Show proposals that have been submitted to Kecamatan
      // Filter: submitted_to_kecamatan = TRUE (approved by Dinas)
      let whereClause = `WHERE d.kecamatan_id = ? 
        AND d.status_pemerintahan = 'desa'
        AND bp.submitted_to_kecamatan = TRUE`;
      const replacements = [kecamatanId];

      // Filter by tahun_anggaran if provided
      if (tahun) {
        whereClause += ' AND bp.tahun_anggaran = ?';
        replacements.push(parseInt(tahun));
      }

      if (status) {
        whereClause += ' AND bp.status = ?';
        replacements.push(status);
      }

      if (jenis_kegiatan) {
        whereClause += ' AND bmk.jenis_kegiatan = ?';
        replacements.push(jenis_kegiatan);
      }

      if (desa_id) {
        whereClause += ' AND bp.desa_id = ?';
        replacements.push(desa_id);
      }

      const [proposals] = await sequelize.query(`
        SELECT 
          bp.id,
          bp.desa_id,
          bp.judul_proposal,
          bp.nama_kegiatan_spesifik,
          bp.volume,
          bp.lokasi,
          bp.deskripsi,
          bp.file_proposal,
          bp.file_size,
          bp.anggaran_usulan,
          bp.status,
          bp.dinas_status,
          bp.dinas_catatan,
          bp.dinas_verified_at,
          bp.dinas_reviewed_file,
          bp.dinas_reviewed_at,
          bp.kecamatan_status,
          bp.kecamatan_catatan,
          bp.submitted_to_kecamatan,
          bp.submitted_at,
          bp.submitted_to_dpmd,
          bp.submitted_to_dpmd_at,
          bp.dpmd_status,
          bp.dpmd_catatan,
          bp.catatan_verifikasi,
          bp.verified_at,
          bp.berita_acara_path,
          bp.berita_acara_generated_at,
          bp.surat_pengantar,
          bp.created_at,
          bp.updated_at,
          u_created.name as created_by_name,
          u_verified.name as verified_by_name,
          u_dinas.name as dinas_verifier_name,
          COALESCE(dv.nama, dc.nama_pic) as dinas_verifikator_nama,
          COALESCE(dv.nip, dc.nip_pic) as dinas_verifikator_nip,
          COALESCE(dv.jabatan, dc.jabatan_pic) as dinas_verifikator_jabatan,
          dv.pangkat_golongan as dinas_verifikator_pangkat,
          COALESCE(dv.ttd_path, dc.ttd_path) as dinas_verifikator_ttd,
          d.nama as desa_nama,
          d.kecamatan_id,
          k.nama as kecamatan_nama
        FROM bankeu_proposals bp
        INNER JOIN desas d ON bp.desa_id = d.id
        LEFT JOIN users u_created ON bp.created_by = u_created.id
        LEFT JOIN users u_verified ON bp.verified_by = u_verified.id
        LEFT JOIN users u_dinas ON bp.dinas_verified_by = u_dinas.id
        LEFT JOIN dinas_verifikator dv ON u_dinas.id = dv.user_id AND u_dinas.dinas_id = dv.dinas_id
        LEFT JOIN dinas_config dc ON u_dinas.dinas_id = dc.dinas_id
        LEFT JOIN kecamatans k ON d.kecamatan_id = k.id
        ${whereClause}
        ORDER BY bp.created_at DESC
      `, { replacements });

      // Fetch kegiatan_list for each proposal (many-to-many)
      for (const proposal of proposals) {
        const [kegiatan] = await sequelize.query(`
          SELECT bmk.id, bmk.jenis_kegiatan, bmk.nama_kegiatan, bmk.dinas_terkait
          FROM bankeu_proposal_kegiatan bpk
          JOIN bankeu_master_kegiatan bmk ON bpk.kegiatan_id = bmk.id
          WHERE bpk.proposal_id = ?
        `, { replacements: [proposal.id] });
        
        proposal.kegiatan_list = kegiatan;
      }

      res.json({
        success: true,
        data: proposals
      });
    } catch (error) {
      logger.error('Error fetching proposals:', error);
      res.status(500).json({
        success: false,
        message: 'Gagal mengambil data proposal',
        error: error.message
      });
    }
  }

  /**
   * Verify (approve/reject) proposal
   * PATCH /api/kecamatan/bankeu/proposals/:id/verify
   */
  async verifyProposal(req, res) {
    try {
      const { id } = req.params;
      const userId = req.user.id;
      const { action, catatan } = req.body; // action: 'approved', 'rejected', 'revision'

      logger.info(`🔍 KECAMATAN VERIFY - ID: ${id}, Action: ${action}, User: ${userId}`);

      // Validate action
      if (!['approved', 'rejected', 'revision'].includes(action)) {
        return res.status(400).json({
          success: false,
          message: 'Action tidak valid. Gunakan: approved, rejected, atau revision'
        });
      }

      // Get kecamatan_id from user
      const [users] = await sequelize.query(`
        SELECT kecamatan_id, name FROM users WHERE id = ?
      `, { replacements: [userId] });

      if (!users || users.length === 0 || !users[0].kecamatan_id) {
        return res.status(403).json({
          success: false,
          message: 'User tidak terkait dengan kecamatan'
        });
      }

      const kecamatanId = users[0].kecamatan_id;

      // Get proposal
      const [proposals] = await sequelize.query(`
        SELECT bp.*, d.nama as desa_nama, d.kecamatan_id, k.nama as kecamatan_nama
        FROM bankeu_proposals bp
        INNER JOIN desas d ON bp.desa_id = d.id
        INNER JOIN kecamatans k ON d.kecamatan_id = k.id
        WHERE bp.id = ? AND d.kecamatan_id = ?
      `, { replacements: [id, kecamatanId] });

      if (!proposals || proposals.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'Proposal tidak ditemukan atau tidak termasuk dalam kecamatan Anda'
        });
      }

      const proposal = proposals[0];

      // NEW FLOW 2026-01-30: Desa → Dinas → Kecamatan → DPMD
      // Reject Kecamatan → RETURN to DESA (Desa upload ulang → Kecamatan langsung)
      // Reset submitted flags dan keep status untuk tracking
      // IMPORTANT: JANGAN null submitted_to_dinas_at agar proposal tetap terlihat
      // di halaman Dinas Terkait / Verifikator Dinas untuk tracking progress
      if (action === 'rejected' || action === 'revision') {
        logger.info(`⬅️ Kecamatan returning proposal ${id} to DESA`);
        
        await sequelize.query(`
          UPDATE bankeu_proposals
          SET 
            kecamatan_status = ?,
            kecamatan_catatan = ?,
            kecamatan_verified_by = ?,
            kecamatan_verified_at = NOW(),
            submitted_to_kecamatan = FALSE,
            status = ?
          WHERE id = ?
        `, {
          replacements: [action, catatan || null, userId, action, id]
        });

        logger.info(`✅ Proposal ${id} dikembalikan ke Desa dengan status ${action}`);

        // Activity Log - deduplicate: update existing same-action log instead of creating new
        const kecLogAction = action === 'rejected' ? 'reject' : 'revision';
        try {
          const existingLog = await prisma.activity_logs.findFirst({
            where: {
              entity_type: 'bankeu_proposal',
              entity_id: BigInt(parseInt(id)),
              module: 'bankeu',
              action: kecLogAction,
              user_id: userId
            },
            orderBy: { created_at: 'desc' }
          });

          const kecLogDesc = `Kecamatan ${proposal.kecamatan_nama} (${users[0].name || 'User'}) ${action === 'rejected' ? 'menolak' : 'meminta revisi'} proposal #${id} dari Desa ${proposal.desa_nama}`;
          const kecNewValue = { kecamatan_status: action, catatan: catatan || null, file_proposal: proposal.file_proposal || null };

          // Only dedup if proposal status hasn't been reset (desa hasn't resubmitted)
          // If kecamatan_status is still 'rejected'/'revision', dinas is re-editing catatan
          // If it's 'pending'/'approved', desa already resubmitted → new cycle
          const shouldDedup = existingLog && (proposal.kecamatan_status === 'rejected' || proposal.kecamatan_status === 'revision');

          if (shouldDedup) {
            await prisma.activity_logs.update({
              where: { id: existingLog.id },
              data: {
                description: kecLogDesc,
                old_value: JSON.stringify({ status: proposal.status, kecamatan_status: proposal.kecamatan_status }),
                new_value: JSON.stringify(kecNewValue),
                ip_address: ActivityLogger.getIpFromRequest(req),
                user_agent: ActivityLogger.getUserAgentFromRequest(req),
                created_at: new Date()
              }
            });
            console.log(`[ActivityLog] Updated existing log #${existingLog.id} for kecamatan proposal #${id}`);
          } else {
            ActivityLogger.log({
              userId: userId,
              userName: users[0].name || `User ${userId}`,
              userRole: req.user.role,
              bidangId: 3,
              module: 'bankeu',
              action: kecLogAction,
              entityType: 'bankeu_proposal',
              entityId: parseInt(id),
              entityName: proposal.judul_proposal || `Proposal #${id}`,
              description: kecLogDesc,
              oldValue: { status: proposal.status, kecamatan_status: proposal.kecamatan_status },
              newValue: kecNewValue,
              ipAddress: ActivityLogger.getIpFromRequest(req),
              userAgent: ActivityLogger.getUserAgentFromRequest(req)
            });
          }
        } catch (logError) {
          console.error('[ActivityLog] Error handling dedup log:', logError);
        }

        return res.json({
          success: true,
          message: `Proposal dikembalikan ke Desa untuk ${action === 'rejected' ? 'diperbaiki' : 'direvisi'}`,
          data: {
            id,
            kecamatan_status: action,
            returned_to: 'desa'
          }
        });
      }

      // NEW FLOW: If approved → Set status approved (JANGAN auto-submit ke DPMD)
      // User harus klik tombol "Kirim DPMD" secara manual untuk batch submit
      await sequelize.query(`
        UPDATE bankeu_proposals
        SET 
          kecamatan_status = 'approved',
          kecamatan_catatan = ?,
          kecamatan_verified_by = ?,
          kecamatan_verified_at = NOW(),
          status = 'pending'
        WHERE id = ?
      `, {
        replacements: [catatan || null, userId, id]
      });

      logger.info(`✅ Kecamatan approved proposal ${id} - Siap dikirim ke DPMD`);

      // Activity Log
      ActivityLogger.log({
        userId: userId,
        userName: users[0].name || `User ${userId}`,
        userRole: req.user.role,
        bidangId: 3,
        module: 'bankeu',
        action: 'approve',
        entityType: 'bankeu_proposal',
        entityId: parseInt(id),
        entityName: proposal.judul_proposal || `Proposal #${id}`,
        description: `Kecamatan ${proposal.kecamatan_nama} (${users[0].name || 'User'}) menyetujui proposal #${id} dari Desa ${proposal.desa_nama}`,
        newValue: { kecamatan_status: 'approved', catatan: catatan || null, file_proposal: proposal.file_proposal || null },
        ipAddress: ActivityLogger.getIpFromRequest(req),
        userAgent: ActivityLogger.getUserAgentFromRequest(req)
      });

      res.json({
        success: true,
        message: `Proposal disetujui. Gunakan tombol "Kirim DPMD" untuk mengirim ke DPMD.`,
        data: {
          id,
          kecamatan_status: 'approved',
          submitted_to_dpmd: false
        }
      });
    } catch (error) {
      logger.error('Error verifying proposal:', error);
      res.status(500).json({
        success: false,
        message: 'Gagal memverifikasi proposal',
        error: error.message
      });
    }
  }

  /**
   * Cancel approval - Batalkan persetujuan proposal yang BELUM dikirim ke DPMD
   * PATCH /api/kecamatan/bankeu/proposals/:id/cancel-approval
   * Kondisi: kecamatan_status = 'approved' AND submitted_to_dpmd = FALSE
   */
  async cancelApproval(req, res) {
    try {
      const { id } = req.params;
      const userId = req.user.id;
      const { catatan } = req.body;

      logger.info(`🔄 KECAMATAN CANCEL APPROVAL - ID: ${id}, User: ${userId}`);

      // Get kecamatan_id from user
      const [users] = await sequelize.query(`
        SELECT kecamatan_id, name FROM users WHERE id = ?
      `, { replacements: [userId] });

      if (!users || users.length === 0 || !users[0].kecamatan_id) {
        return res.status(403).json({
          success: false,
          message: 'User tidak terkait dengan kecamatan'
        });
      }

      const kecamatanId = users[0].kecamatan_id;

      // Get proposal
      const [proposals] = await sequelize.query(`
        SELECT bp.*, d.nama as desa_nama, d.kecamatan_id, k.nama as kecamatan_nama
        FROM bankeu_proposals bp
        INNER JOIN desas d ON bp.desa_id = d.id
        INNER JOIN kecamatans k ON d.kecamatan_id = k.id
        WHERE bp.id = ? AND d.kecamatan_id = ?
      `, { replacements: [id, kecamatanId] });

      if (!proposals || proposals.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'Proposal tidak ditemukan atau tidak termasuk dalam kecamatan Anda'
        });
      }

      const proposal = proposals[0];

      // Validasi: Hanya bisa batalkan jika sudah approved TAPI belum dikirim ke DPMD
      if (proposal.kecamatan_status !== 'approved') {
        return res.status(400).json({
          success: false,
          message: 'Hanya proposal yang sudah disetujui yang dapat dibatalkan'
        });
      }

      if (proposal.submitted_to_dpmd) {
        return res.status(400).json({
          success: false,
          message: 'Proposal sudah dikirim ke DPMD dan tidak dapat dibatalkan'
        });
      }

      // Reset kecamatan_status ke pending sehingga bisa di-review ulang
      await sequelize.query(`
        UPDATE bankeu_proposals
        SET 
          kecamatan_status = 'pending',
          kecamatan_catatan = ?,
          kecamatan_verified_by = NULL,
          kecamatan_verified_at = NULL,
          berita_acara_path = NULL,
          berita_acara_generated_at = NULL,
          surat_pengantar = NULL
        WHERE id = ?
      `, {
        replacements: [catatan || 'Persetujuan dibatalkan oleh Kecamatan', id]
      });

      logger.info(`✅ Proposal ${id} persetujuan dibatalkan - kembali ke status pending`);

      // Activity Log
      ActivityLogger.log({
        userId: userId,
        userName: users[0].name || `User ${userId}`,
        userRole: req.user.role,
        bidangId: 3,
        module: 'bankeu',
        action: 'cancel_approval',
        entityType: 'bankeu_proposal',
        entityId: parseInt(id),
        entityName: proposal.judul_proposal || `Proposal #${id}`,
        description: `Kecamatan ${proposal.kecamatan_nama} (${users[0].name || 'User'}) membatalkan persetujuan proposal #${id} dari Desa ${proposal.desa_nama}`,
        oldValue: { kecamatan_status: 'approved' },
        newValue: { kecamatan_status: 'pending', catatan: catatan || null },
        ipAddress: ActivityLogger.getIpFromRequest(req),
        userAgent: ActivityLogger.getUserAgentFromRequest(req)
      });

      res.json({
        success: true,
        message: 'Persetujuan proposal berhasil dibatalkan. Anda dapat melakukan verifikasi ulang.',
        data: {
          id,
          kecamatan_status: 'pending'
        }
      });
    } catch (error) {
      logger.error('Error canceling approval:', error);
      res.status(500).json({
        success: false,
        message: 'Gagal membatalkan persetujuan proposal',
        error: error.message
      });
    }
  }

  /**
   * Generate Berita Acara PDF
   */
  static async generateBeritaAcara(proposal, verifierName, userId) {
    try {
      const fileName = `BA_${proposal.desa_nama.replace(/\s/g, '_')}_${Date.now()}.pdf`;
      const filePath = path.join(__dirname, '../../storage/uploads/bankeu/berita_acara', fileName);
      
      // Ensure directory exists
      const dirPath = path.dirname(filePath);
      if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
      }

      const doc = new PDFDocument({ size: 'A4', margin: 50 });
      const writeStream = fs.createWriteStream(filePath);

      doc.pipe(writeStream);

      // Header
      doc.fontSize(16)
         .font('Helvetica-Bold')
         .text('BERITA ACARA VERIFIKASI', { align: 'center' })
         .moveDown();

      doc.fontSize(14)
         .text('PROPOSAL BANTUAN KEUANGAN DESA', { align: 'center' })
         .moveDown(2);

      // Content
      doc.fontSize(11)
         .font('Helvetica');

      const currentDate = new Date().toLocaleDateString('id-ID', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      });

      doc.text(`Pada hari ini, ${currentDate}, telah dilakukan verifikasi terhadap proposal Bantuan Keuangan dengan rincian sebagai berikut:`)
         .moveDown();

      // Proposal Details
      doc.font('Helvetica-Bold').text('I. DATA PROPOSAL', { underline: true }).moveDown(0.5);
      doc.font('Helvetica');

      const details = [
        ['Nama Desa', proposal.desa_nama],
        ['Kecamatan', proposal.kecamatan_nama],
        ['Jenis Kegiatan', proposal.jenis_kegiatan === 'infrastruktur' ? 'Infrastruktur' : 'Non-Infrastruktur'],
        ['Nama Kegiatan', proposal.kegiatan_nama],
        ['Judul Proposal', proposal.judul_proposal],
      ];

      if (proposal.anggaran_usulan) {
        details.push(['Anggaran Usulan', `Rp ${Number(proposal.anggaran_usulan).toLocaleString('id-ID')}`]);
      }

      details.forEach(([label, value]) => {
        doc.text(`${label.padEnd(25, ' ')}: ${value}`);
      });

      doc.moveDown(2);

      // Verification Result
      doc.font('Helvetica-Bold').text('II. HASIL VERIFIKASI', { underline: true }).moveDown(0.5);
      doc.font('Helvetica');
      doc.text(`Status: DISETUJUI`).moveDown(0.5);
      
      if (proposal.catatan_verifikasi) {
        doc.text(`Catatan: ${proposal.catatan_verifikasi}`).moveDown();
      }

      doc.moveDown(2);

      // Signature
      doc.text('Demikian Berita Acara ini dibuat untuk dapat dipergunakan sebagaimana mestinya.')
         .moveDown(2);

      const signatureY = doc.y;
      
      doc.text('Mengetahui,', 50, signatureY);
      doc.text('Yang Memverifikasi,', 350, signatureY);

      doc.moveDown(4);

      doc.text('(                                        )', 50, doc.y);
      doc.text(`( ${verifierName} )`, 350, doc.y - doc.currentLineHeight());

      doc.end();

      // Wait for file to be written
      await new Promise((resolve, reject) => {
        writeStream.on('finish', resolve);
        writeStream.on('error', reject);
      });

      logger.info(`✅ Berita Acara generated: ${fileName}`);

      return `bankeu/berita_acara/${fileName}`;
    } catch (error) {
      logger.error('Error generating berita acara:', error);
      throw error;
    }
  }

  /**
   * Get statistics for kecamatan
   * GET /api/kecamatan/bankeu/statistics
   */
  async getStatistics(req, res) {
    try {
      const userId = req.user.id;
      const { tahun } = req.query;
      const tahunFilter = tahun ? parseInt(tahun) : null;

      const [users] = await sequelize.query(`
        SELECT kecamatan_id FROM users WHERE id = ?
      `, { replacements: [userId] });

      if (!users || users.length === 0 || !users[0].kecamatan_id) {
        return res.status(403).json({
          success: false,
          message: 'User tidak terkait dengan kecamatan'
        });
      }

      const kecamatanId = users[0].kecamatan_id;

      // FIXED: Statistics harus filter submitted_to_kecamatan = TRUE agar sinkron dengan proposals list
      const [stats] = await sequelize.query(`
        SELECT 
          COUNT(*) as total_proposals,
          SUM(CASE WHEN bp.kecamatan_status IS NULL OR bp.kecamatan_status = 'pending' THEN 1 ELSE 0 END) as pending,
          SUM(CASE WHEN bp.kecamatan_status = 'approved' THEN 1 ELSE 0 END) as verified,
          SUM(CASE WHEN bp.kecamatan_status = 'rejected' THEN 1 ELSE 0 END) as rejected,
          SUM(CASE WHEN bp.kecamatan_status = 'revision' THEN 1 ELSE 0 END) as revision,
          SUM(CASE WHEN bmk.jenis_kegiatan = 'infrastruktur' THEN 1 ELSE 0 END) as infrastruktur,
          SUM(CASE WHEN bmk.jenis_kegiatan = 'non_infrastruktur' THEN 1 ELSE 0 END) as non_infrastruktur
        FROM bankeu_proposals bp
        INNER JOIN desas d ON bp.desa_id = d.id
        INNER JOIN bankeu_master_kegiatan bmk ON bp.kegiatan_id = bmk.id
        WHERE d.kecamatan_id = ?
        AND d.status_pemerintahan = 'desa'
        AND bp.submitted_to_kecamatan = TRUE
        ${tahunFilter ? 'AND bp.tahun_anggaran = ?' : ''}
      `, { replacements: tahunFilter ? [kecamatanId, tahunFilter] : [kecamatanId] });

      res.json({
        success: true,
        data: stats[0]
      });
    } catch (error) {
      logger.error('Error fetching statistics:', error);
      res.status(500).json({
        success: false,
        message: 'Gagal mengambil statistik',
        error: error.message
      });
    }
  }

  /**
   * Generate Berita Acara per Desa
   * POST /api/kecamatan/bankeu/desa/:desaId/berita-acara
   */
  async generateBeritaAcaraDesa(req, res) {
    try {
      const { desaId } = req.params;
      const { kegiatanId, proposalId, optionalItems, tanggal } = req.body; // proposalId untuk tim verifikasi per proposal, optionalItems untuk infra opsional
      const userId = req.user.id;

      // Get user info
      const [users] = await sequelize.query(`
        SELECT kecamatan_id, name FROM users WHERE id = ?
      `, { replacements: [userId] });

      if (!users || users.length === 0 || !users[0].kecamatan_id) {
        return res.status(403).json({
          success: false,
          message: 'User tidak terkait dengan kecamatan'
        });
      }

      const kecamatanId = users[0].kecamatan_id;

      // Verify desa belongs to kecamatan
      const [desas] = await sequelize.query(`
        SELECT d.nama
        FROM desas d
        WHERE d.id = ? AND d.kecamatan_id = ?
      `, { replacements: [desaId, kecamatanId] });

      if (!desas || desas.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'Desa tidak ditemukan atau bukan wewenang kecamatan Anda'
        });
      }

      // Get checklist data from questionnaires
      let checklistData = null;
      if (proposalId) {
        // Get aggregated checklist for this proposal
        const BeritaAcaraHelper = require('../services/beritaAcaraHelper');
        checklistData = await BeritaAcaraHelper.getAggregatedChecklistData(proposalId, kecamatanId);
      }

      // Use service to generate berita acara
      const filePath = await beritaAcaraService.generateBeritaAcaraVerifikasi({
        desaId: parseInt(desaId),
        kecamatanId,
        kegiatanId: kegiatanId ? parseInt(kegiatanId) : null,
        proposalId: proposalId ? parseInt(proposalId) : null,
        checklistData,
        optionalItems: optionalItems || null,
        tanggal: tanggal || null
      });

      // Update proposals with berita acara path
      if (proposalId) {
        // Update specific proposal
        await sequelize.query(`
          UPDATE bankeu_proposals
          SET 
            berita_acara_path = ?,
            berita_acara_generated_at = NOW()
          WHERE id = ?
        `, { replacements: [filePath, proposalId] });
      } else if (kegiatanId) {
        // Update only specific kegiatan
        await sequelize.query(`
          UPDATE bankeu_proposals
          SET 
            berita_acara_path = ?,
            berita_acara_generated_at = NOW()
          WHERE desa_id = ? AND kegiatan_id = ?
        `, { replacements: [filePath, desaId, kegiatanId] });
      } else {
        // Update all proposals for desa
        await sequelize.query(`
          UPDATE bankeu_proposals
          SET 
            berita_acara_path = ?,
            berita_acara_generated_at = NOW()
          WHERE desa_id = ?
        `, { replacements: [filePath, desaId] });
      }

      logger.info(`✅ Berita Acara generated for desa ${desaId}${proposalId ? ` proposal ${proposalId}` : kegiatanId ? ` kegiatan ${kegiatanId}` : ''}: ${filePath}`);

      res.json({
        success: true,
        message: 'Berita Acara berhasil dibuat',
        data: {
          file_path: filePath,
          desa_nama: desas[0].nama,
          download_url: filePath
        }
      });
    } catch (error) {
      logger.error('Error generating berita acara:', error);
      res.status(500).json({
        success: false,
        message: 'Gagal membuat Berita Acara',
        error: error.message
      });
    }
  }

  /**
   * Submit review results (send to DPMD or return to Desa)
   * POST /api/kecamatan/bankeu/desa/:desaId/submit-review
   */
  async submitReview(req, res) {
    try {
      const { desaId } = req.params;
      const { action, tahun } = req.body; // 'submit' or 'return', tahun = tahun_anggaran
      const userId = req.user.id;
      const tahunAnggaran = parseInt(tahun) || new Date().getFullYear();

      logger.info(`🚀 SUBMIT REVIEW REQUEST - Desa: ${desaId}, Action: ${action}, Tahun: ${tahunAnggaran}, User: ${userId}`);

      if (!['submit', 'return'].includes(action)) {
        return res.status(400).json({
          success: false,
          message: 'Action tidak valid. Gunakan: submit atau return'
        });
      }

      // Get user info
      const [users] = await sequelize.query(`
        SELECT kecamatan_id FROM users WHERE id = ?
      `, { replacements: [userId] });

      if (!users || users.length === 0 || !users[0].kecamatan_id) {
        return res.status(403).json({
          success: false,
          message: 'User tidak terkait dengan kecamatan'
        });
      }

      const kecamatanId = users[0].kecamatan_id;

      // Verify desa belongs to this kecamatan
      const [desas] = await sequelize.query(`
        SELECT * FROM desas WHERE id = ? AND kecamatan_id = ?
      `, { replacements: [desaId, kecamatanId] });

      if (!desas || desas.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'Desa tidak ditemukan'
        });
      }

      // Check if all proposals have been reviewed (no pending kecamatan_status)
      const [pendingCount] = await sequelize.query(`
        SELECT COUNT(*) as total
        FROM bankeu_proposals bp
        INNER JOIN desas d ON bp.desa_id = d.id
        WHERE bp.desa_id = ? AND d.kecamatan_id = ? 
          AND bp.tahun_anggaran = ?
          AND bp.submitted_to_kecamatan = TRUE
          AND (bp.kecamatan_status = 'pending' OR bp.kecamatan_status IS NULL)
      `, { replacements: [desaId, kecamatanId, tahunAnggaran] });

      if (pendingCount[0].total > 0) {
        return res.status(400).json({
          success: false,
          message: `Masih ada ${pendingCount[0].total} proposal yang belum direview. Review semua proposal terlebih dahulu.`
        });
      }

      // Check if there are any proposals submitted to kecamatan
      const [totalCount] = await sequelize.query(`
        SELECT COUNT(*) as total
        FROM bankeu_proposals bp
        INNER JOIN desas d ON bp.desa_id = d.id
        WHERE bp.desa_id = ? AND d.kecamatan_id = ? AND bp.tahun_anggaran = ? AND bp.submitted_to_kecamatan = TRUE
      `, { replacements: [desaId, kecamatanId, tahunAnggaran] });

      if (totalCount[0].total === 0) {
        return res.status(400).json({
          success: false,
          message: 'Tidak ada proposal dari desa ini'
        });
      }

      // For submit to DPMD: Check berita acara and surat pengantar
      if (action === 'submit') {
        // Check if kecamatan submission is open
        const submissionSetting = await prisma.app_settings.findUnique({
          where: { setting_key: 'bankeu_submission_kecamatan' }
        });
        
        if (submissionSetting) {
          const { evaluateBankeuSchedule } = require('./appSettings.controller');
          const { isOpen } = evaluateBankeuSchedule(submissionSetting.setting_value);
          if (!isOpen) {
            logger.warn(`⛔ Kecamatan submit to DPMD blocked - submission is closed by DPMD`);
            return res.status(403).json({
              success: false,
              message: 'Pengiriman ke DPMD saat ini ditutup. Silakan hubungi DPMD untuk informasi lebih lanjut.'
            });
          }
        }

        // Check if all APPROVED proposals have berita acara
        // Hanya cek proposal yang approved karena hanya mereka yang akan dikirim ke DPMD
        const [missingBeritaAcara] = await sequelize.query(`
          SELECT COUNT(*) as total
          FROM bankeu_proposals bp
          INNER JOIN desas d ON bp.desa_id = d.id
          WHERE bp.desa_id = ? AND d.kecamatan_id = ? 
            AND bp.tahun_anggaran = ?
            AND bp.submitted_to_kecamatan = TRUE
            AND bp.kecamatan_status = 'approved'
            AND (bp.berita_acara_path IS NULL OR bp.berita_acara_path = '')
        `, { replacements: [desaId, kecamatanId, tahunAnggaran] });

        if (missingBeritaAcara[0].total > 0) {
          return res.status(400).json({
            success: false,
            message: `Masih ada ${missingBeritaAcara[0].total} proposal yang belum memiliki Berita Acara. Generate Berita Acara terlebih dahulu sebelum mengirim ke DPMD.`
          });
        }

        // Check if all APPROVED proposals have surat pengantar kecamatan
        // Hanya cek proposal yang approved karena hanya mereka yang akan dikirim ke DPMD
        const [missingSuratPengantar] = await sequelize.query(`
          SELECT COUNT(*) as total
          FROM bankeu_proposals bp
          INNER JOIN desas d ON bp.desa_id = d.id
          WHERE bp.desa_id = ? AND d.kecamatan_id = ? 
            AND bp.tahun_anggaran = ?
            AND bp.submitted_to_kecamatan = TRUE
            AND bp.kecamatan_status = 'approved'
            AND (bp.surat_pengantar IS NULL OR bp.surat_pengantar = '')
        `, { replacements: [desaId, kecamatanId, tahunAnggaran] });

        if (missingSuratPengantar[0].total > 0) {
          return res.status(400).json({
            success: false,
            message: `Masih ada ${missingSuratPengantar[0].total} proposal yang belum memiliki Surat Pengantar. Generate Surat Pengantar terlebih dahulu sebelum mengirim ke DPMD.`
          });
        }
        
        // Check surat pengantar dari desa
        const [suratDesa] = await sequelize.query(`
          SELECT surat_pengantar, surat_permohonan
          FROM desa_bankeu_surat
          WHERE desa_id = ? AND tahun = ?
        `, { replacements: [desaId, tahunAnggaran] });

        if (!suratDesa || suratDesa.length === 0 || !suratDesa[0].surat_pengantar) {
          return res.status(400).json({
            success: false,
            message: `Desa belum mengunggah Surat Pengantar Desa. Hubungi desa untuk mengunggah Surat Pengantar terlebih dahulu sebelum mengirim ke DPMD.`
          });
        }

        if (!suratDesa[0].surat_permohonan) {
          return res.status(400).json({
            success: false,
            message: `Desa belum mengunggah Surat Permohonan Desa. Hubungi desa untuk mengunggah Surat Permohonan terlebih dahulu sebelum mengirim ke DPMD.`
          });
        }
      }

      // Update submitted_to_kecamatan based on action
      if (action === 'return') {
        // Kembalikan ke desa: set submitted_to_kecamatan = FALSE
        // Ini memungkinkan desa untuk upload ulang dan submit lagi
        await sequelize.query(`
          UPDATE bankeu_proposals bp
          INNER JOIN desas d ON bp.desa_id = d.id
          SET bp.submitted_to_kecamatan = FALSE, bp.submitted_at = NULL
          WHERE bp.desa_id = ? AND d.kecamatan_id = ? AND bp.tahun_anggaran = ?
        `, { replacements: [desaId, kecamatanId, tahunAnggaran] });
        
        logger.info(`🔙 ${totalCount[0].total} proposals returned to desa ${desaId} by user ${userId}`);

        // Activity Log
        ActivityLogger.log({
          userId: userId,
          userName: req.user.name || `User ${userId}`,
          userRole: req.user.role,
          bidangId: 3,
          module: 'bankeu',
          action: 'return',
          entityType: 'bankeu_proposal',
          entityName: `${totalCount[0].total} proposal desa ${desaId}`,
          description: `Kecamatan (${req.user.name || 'User'}) mengembalikan ${totalCount[0].total} proposal ke Desa ID: ${desaId}`,
          newValue: { count: totalCount[0].total, desa_id: desaId, action: 'return' },
          ipAddress: ActivityLogger.getIpFromRequest(req),
          userAgent: ActivityLogger.getUserAgentFromRequest(req)
        });
      } else {
        // Kirim ke DPMD: set submitted_to_dpmd = TRUE dan dpmd_status = pending
        await sequelize.query(`
          UPDATE bankeu_proposals bp
          INNER JOIN desas d ON bp.desa_id = d.id
          SET 
            bp.submitted_to_dpmd = TRUE, 
            bp.submitted_to_dpmd_at = NOW(),
            bp.dpmd_status = 'pending'
          WHERE bp.desa_id = ? AND d.kecamatan_id = ? AND bp.tahun_anggaran = ? AND bp.kecamatan_status = 'approved'
        `, { replacements: [desaId, kecamatanId, tahunAnggaran] });
        
        logger.info(`✅ ${totalCount[0].total} proposals submitted to DPMD from desa ${desaId} by user ${userId}`);

        // Activity Log
        ActivityLogger.log({
          userId: userId,
          userName: req.user.name || `User ${userId}`,
          userRole: req.user.role,
          bidangId: 3,
          module: 'bankeu',
          action: 'submit',
          entityType: 'bankeu_proposal',
          entityName: `${totalCount[0].total} proposal desa ${desaId}`,
          description: `Kecamatan (${req.user.name || 'User'}) mengirim ${totalCount[0].total} proposal ke DPMD dari Desa ID: ${desaId}`,
          newValue: { count: totalCount[0].total, desa_id: desaId, destination: 'dpmd' },
          ipAddress: ActivityLogger.getIpFromRequest(req),
          userAgent: ActivityLogger.getUserAgentFromRequest(req)
        });
      }

      res.json({
        success: true,
        message: `Review berhasil ${action === 'submit' ? 'dikirim ke DPMD' : 'dikembalikan ke desa'}`,
        data: {
          action,
          desa_id: desaId
        }
      });
    } catch (error) {
      logger.error('Error submitting review:', error);
      res.status(500).json({
        success: false,
        message: 'Gagal mengirim hasil review',
        error: error.message
      });
    }
  }

  /**
   * Get kecamatan configuration
   * GET /api/kecamatan/bankeu/config/:kecamatanId
   */
  async getConfig(req, res) {
    try {
      const { kecamatanId } = req.params;
      const userId = req.user.id;

      // Verify user is from this kecamatan
      const [users] = await sequelize.query(`
        SELECT kecamatan_id FROM users WHERE id = ?
      `, { replacements: [userId] });

      if (!users || users.length === 0 || users[0].kecamatan_id != kecamatanId) {
        return res.status(403).json({
          success: false,
          message: 'Anda tidak memiliki akses ke kecamatan ini'
        });
      }

      const [config] = await sequelize.query(`
        SELECT * FROM kecamatan_bankeu_config
        WHERE kecamatan_id = ?
      `, { replacements: [kecamatanId] });

      // Return empty object if config doesn't exist yet (allow new configs to be created)
      const configData = config.length > 0 ? config[0] : {
        kecamatan_id: kecamatanId,
        nama_camat: '',
        nip_camat: '',
        alamat: '',
        logo_path: null,
        ttd_camat_path: null
      };

      res.json({
        success: true,
        data: configData
      });
    } catch (error) {
      logger.error('Error getting config:', error);
      res.status(500).json({
        success: false,
        message: 'Gagal mengambil konfigurasi',
        error: error.message
      });
    }
  }

  /**
   * Save kecamatan configuration
   * POST /api/kecamatan/bankeu/config/:kecamatanId
   */
  async saveConfig(req, res) {
    try {
      const { kecamatanId } = req.params;
      const { nama_camat, nip_camat, jabatan_penandatangan, alamat, telepon, email, website, kode_pos } = req.body;
      const userId = req.user.id;

      // Verify user is from this kecamatan
      const [users] = await sequelize.query(`
        SELECT kecamatan_id FROM users WHERE id = ?
      `, { replacements: [userId] });

      if (!users || users.length === 0 || users[0].kecamatan_id != kecamatanId) {
        return res.status(403).json({
          success: false,
          message: 'Anda tidak memiliki akses ke kecamatan ini'
        });
      }

      // Check if config exists
      const [existing] = await sequelize.query(`
        SELECT id FROM kecamatan_bankeu_config
        WHERE kecamatan_id = ?
      `, { replacements: [kecamatanId] });

      if (existing.length > 0) {
        // Update
        await sequelize.query(`
          UPDATE kecamatan_bankeu_config
          SET nama_camat = ?, nip_camat = ?, jabatan_penandatangan = ?, alamat = ?, telepon = ?, email = ?, website = ?, kode_pos = ?, updated_at = NOW()
          WHERE kecamatan_id = ?
        `, { replacements: [nama_camat, nip_camat, jabatan_penandatangan || 'Camat', alamat, telepon, email, website, kode_pos, kecamatanId] });
      } else {
        // Insert
        await sequelize.query(`
          INSERT INTO kecamatan_bankeu_config (kecamatan_id, nama_camat, nip_camat, jabatan_penandatangan, alamat, telepon, email, website, kode_pos, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())
        `, { replacements: [kecamatanId, nama_camat, nip_camat, jabatan_penandatangan || 'Camat', alamat, telepon, email, website, kode_pos] });
      }

      const [updated] = await sequelize.query(`
        SELECT * FROM kecamatan_bankeu_config
        WHERE kecamatan_id = ?
      `, { replacements: [kecamatanId] });

      res.json({
        success: true,
        message: 'Konfigurasi berhasil disimpan',
        data: updated[0]
      });
    } catch (error) {
      logger.error('Error saving config:', error);
      res.status(500).json({
        success: false,
        message: 'Gagal menyimpan konfigurasi',
        error: error.message
      });
    }
  }

  /**
   * Get tim verifikasi for kecamatan
   * GET /api/kecamatan/bankeu/tim-verifikasi/:kecamatanId
   */
  async getTimVerifikasi(req, res) {
    try {
      const { kecamatanId } = req.params;
      const userId = req.user.id;

      // Verify user is from this kecamatan
      const [users] = await sequelize.query(`
        SELECT kecamatan_id FROM users WHERE id = ?
      `, { replacements: [userId] });

      if (!users || users.length === 0 || users[0].kecamatan_id != kecamatanId) {
        return res.status(403).json({
          success: false,
          message: 'Anda tidak memiliki akses ke kecamatan ini'
        });
      }

      const [timVerifikasi] = await sequelize.query(`
        SELECT * FROM tim_verifikasi_kecamatan
        WHERE kecamatan_id = ? AND is_active = TRUE
        ORDER BY FIELD(jabatan, 'ketua', 'sekretaris', 'anggota'), nama ASC
      `, { replacements: [kecamatanId] });

      res.json({
        success: true,
        data: timVerifikasi
      });
    } catch (error) {
      logger.error('Error getting tim verifikasi:', error);
      res.status(500).json({
        success: false,
        message: 'Gagal mengambil data tim verifikasi',
        error: error.message
      });
    }
  }

  /**
   * Add anggota tim verifikasi
   * POST /api/kecamatan/bankeu/tim-verifikasi/:kecamatanId
   */
  async addTimVerifikasi(req, res) {
    try {
      const { kecamatanId } = req.params;
      const { jabatan, nama, nip, jabatan_label } = req.body;
      const userId = req.user.id;

      // Verify user is from this kecamatan
      const [users] = await sequelize.query(`
        SELECT kecamatan_id FROM users WHERE id = ?
      `, { replacements: [userId] });

      if (!users || users.length === 0 || users[0].kecamatan_id != kecamatanId) {
        return res.status(403).json({
          success: false,
          message: 'Anda tidak memiliki akses ke kecamatan ini'
        });
      }

      // Validate required fields (NIP optional - some members don't have NIP)
      if (!jabatan || !nama) {
        return res.status(400).json({
          success: false,
          message: 'Jabatan dan nama wajib diisi'
        });
      }

      // Check if ketua already exists (optional validation)
      if (jabatan.toLowerCase() === 'ketua') {
        const [existing] = await sequelize.query(`
          SELECT id FROM tim_verifikasi_kecamatan
          WHERE kecamatan_id = ? AND LOWER(jabatan) = 'ketua' AND is_active = TRUE
        `, { replacements: [kecamatanId] });

        if (existing.length > 0) {
          return res.status(400).json({
            success: false,
            message: 'Ketua tim verifikasi sudah ada'
          });
        }
      }

      const [result] = await sequelize.query(`
        INSERT INTO tim_verifikasi_kecamatan (kecamatan_id, jabatan, nama, nip, jabatan_label, is_active, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, TRUE, NOW(), NOW())
      `, { replacements: [kecamatanId, jabatan, nama, nip, jabatan_label || null] });

      res.status(201).json({
        success: true,
        message: 'Anggota tim verifikasi berhasil ditambahkan',
        data: {
          id: result.insertId,
          kecamatan_id: kecamatanId,
          jabatan,
          nama,
          nip,
          jabatan_label,
          is_active: true
        }
      });
    } catch (error) {
      logger.error('Error adding tim verifikasi:', error);
      res.status(500).json({
        success: false,
        message: 'Gagal menambahkan anggota tim verifikasi',
        error: error.message
      });
    }
  }

  /**
   * Remove anggota tim verifikasi
   * DELETE /api/kecamatan/bankeu/tim-verifikasi/:id
   */
  async removeTimVerifikasi(req, res) {
    try {
      const { id } = req.params;
      const userId = req.user.id;

      // Get tim data to verify access
      const [timData] = await sequelize.query(`
        SELECT kecamatan_id FROM tim_verifikasi_kecamatan
        WHERE id = ?
      `, { replacements: [id] });

      if (timData.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'Data anggota tim tidak ditemukan'
        });
      }

      const kecamatanId = timData[0].kecamatan_id;

      // Verify user is from this kecamatan
      const [users] = await sequelize.query(`
        SELECT kecamatan_id FROM users WHERE id = ?
      `, { replacements: [userId] });

      if (!users || users.length === 0 || users[0].kecamatan_id != kecamatanId) {
        return res.status(403).json({
          success: false,
          message: 'Anda tidak memiliki akses'
        });
      }

      await sequelize.query(`
        UPDATE tim_verifikasi_kecamatan
        SET is_active = FALSE, updated_at = NOW()
        WHERE id = ?
      `, { replacements: [id] });

      res.json({
        success: true,
        message: 'Anggota tim verifikasi berhasil dihapus'
      });
    } catch (error) {
      logger.error('Error removing tim verifikasi:', error);
      res.status(500).json({
        success: false,
        message: 'Gagal menghapus anggota tim verifikasi',
        error: error.message
      });
    }
  }

  /**
   * Upload signature for tim member
   * POST /api/kecamatan/bankeu/tim-verifikasi/:id/upload-signature
   */
  async uploadTimSignature(req, res) {
    try {
      const { id } = req.params;
      const userId = req.user.id;

      if (!req.file) {
        return res.status(400).json({
          success: false,
          message: 'File wajib diupload'
        });
      }

      // Get tim data to verify access
      const [timData] = await sequelize.query(`
        SELECT kecamatan_id FROM tim_verifikasi_kecamatan
        WHERE id = ?
      `, { replacements: [id] });

      if (timData.length === 0) {
        fs.unlinkSync(req.file.path);
        return res.status(404).json({
          success: false,
          message: 'Data anggota tim tidak ditemukan'
        });
      }

      const kecamatanId = timData[0].kecamatan_id;

      // Verify user is from this kecamatan
      const [users] = await sequelize.query(`
        SELECT kecamatan_id FROM users WHERE id = ?
      `, { replacements: [userId] });

      if (!users || users.length === 0 || users[0].kecamatan_id != kecamatanId) {
        fs.unlinkSync(req.file.path);
        return res.status(403).json({
          success: false,
          message: 'Anda tidak memiliki akses'
        });
      }

      const filePath = `signatures/${req.file.filename}`;

      await sequelize.query(`
        UPDATE tim_verifikasi_kecamatan
        SET ttd_path = ?, updated_at = NOW()
        WHERE id = ?
      `, { replacements: [filePath, id] });

      res.json({
        success: true,
        message: 'Tanda tangan berhasil diupload',
        data: { ttd_path: filePath }
      });
    } catch (error) {
      if (req.file && req.file.path) {
        fs.unlinkSync(req.file.path);
      }
      logger.error('Error uploading signature:', error);
      res.status(500).json({
        success: false,
        message: 'Gagal mengupload tanda tangan',
        error: error.message
      });
    }
  }

  /**
   * Upload logo for kecamatan
   * POST /api/kecamatan/bankeu/config/:kecamatanId/upload-logo
   */
  async uploadLogo(req, res) {
    try {
      const { kecamatanId } = req.params;
      const userId = req.user.id;

      if (!req.file) {
        return res.status(400).json({
          success: false,
          message: 'File wajib diupload'
        });
      }

      // Verify user is from this kecamatan
      const [users] = await sequelize.query(`
        SELECT kecamatan_id FROM users WHERE id = ?
      `, { replacements: [userId] });

      if (!users || users.length === 0 || users[0].kecamatan_id != kecamatanId) {
        fs.unlinkSync(req.file.path);
        return res.status(403).json({
          success: false,
          message: 'Anda tidak memiliki akses'
        });
      }

      const filePath = `signatures/${req.file.filename}`;

      await sequelize.query(`
        UPDATE kecamatan_bankeu_config
        SET logo_path = ?, updated_at = NOW()
        WHERE kecamatan_id = ?
      `, { replacements: [filePath, kecamatanId] });

      const [updated] = await sequelize.query(`
        SELECT * FROM kecamatan_bankeu_config
        WHERE kecamatan_id = ?
      `, { replacements: [kecamatanId] });

      res.json({
        success: true,
        message: 'Logo berhasil diupload',
        data: updated[0]
      });
    } catch (error) {
      if (req.file && req.file.path) {
        fs.unlinkSync(req.file.path);
      }
      logger.error('Error uploading logo:', error);
      res.status(500).json({
        success: false,
        message: 'Gagal mengupload logo',
        error: error.message
      });
    }
  }

  /**
   * Upload camat signature
   * POST /api/kecamatan/bankeu/config/:kecamatanId/upload-camat-signature
   */
  async uploadCamatSignature(req, res) {
    try {
      const { kecamatanId } = req.params;
      const userId = req.user.id;

      if (!req.file) {
        return res.status(400).json({
          success: false,
          message: 'File wajib diupload'
        });
      }

      // Verify user is from this kecamatan
      const [users] = await sequelize.query(`
        SELECT kecamatan_id FROM users WHERE id = ?
      `, { replacements: [userId] });

      if (!users || users.length === 0 || users[0].kecamatan_id != kecamatanId) {
        fs.unlinkSync(req.file.path);
        return res.status(403).json({
          success: false,
          message: 'Anda tidak memiliki akses'
        });
      }

      const filePath = `signatures/${req.file.filename}`;

      await sequelize.query(`
        UPDATE kecamatan_bankeu_config
        SET ttd_camat_path = ?, updated_at = NOW()
        WHERE kecamatan_id = ?
      `, { replacements: [filePath, kecamatanId] });

      const [updated] = await sequelize.query(`
        SELECT * FROM kecamatan_bankeu_config
        WHERE kecamatan_id = ?
      `, { replacements: [kecamatanId] });

      res.json({
        success: true,
        message: 'Tanda tangan camat berhasil diupload',
        data: updated[0]
      });
    } catch (error) {
      if (req.file && req.file.path) {
        fs.unlinkSync(req.file.path);
      }
      logger.error('Error uploading camat signature:', error);
      res.status(500).json({
        success: false,
        message: 'Gagal mengupload tanda tangan camat',
        error: error.message
      });
    }
  }

  /**
   * Delete camat signature
   * DELETE /api/kecamatan/bankeu/config/:kecamatanId/delete-camat-signature
   */
  async deleteCamatSignature(req, res) {
    try {
      const { kecamatanId } = req.params;
      const userId = req.user.id;

      // Verify user is from this kecamatan
      const [users] = await sequelize.query(`
        SELECT kecamatan_id FROM users WHERE id = ?
      `, { replacements: [userId] });

      if (!users || users.length === 0 || users[0].kecamatan_id != kecamatanId) {
        return res.status(403).json({
          success: false,
          message: 'Anda tidak memiliki akses'
        });
      }

      // Get current signature path
      const [config] = await sequelize.query(`
        SELECT ttd_camat_path FROM kecamatan_bankeu_config
        WHERE kecamatan_id = ?
      `, { replacements: [kecamatanId] });

      // Delete file if exists
      if (config && config[0] && config[0].ttd_camat_path) {
        const filePath = path.join(__dirname, '../../storage/uploads', config[0].ttd_camat_path);
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
        }
      }

      // Update database
      await sequelize.query(`
        UPDATE kecamatan_bankeu_config
        SET ttd_camat_path = NULL, updated_at = NOW()
        WHERE kecamatan_id = ?
      `, { replacements: [kecamatanId] });

      res.json({
        success: true,
        message: 'Tanda tangan camat berhasil dihapus'
      });
    } catch (error) {
      logger.error('Error deleting camat signature:', error);
      res.status(500).json({
        success: false,
        message: 'Gagal menghapus tanda tangan',
        error: error.message
      });
    }
  }

  /**
   * Upload stempel (must be PNG transparent)
   * POST /api/kecamatan/bankeu/config/:kecamatanId/upload-stempel
   */
  async uploadStempel(req, res) {
    try {
      const { kecamatanId } = req.params;
      const userId = req.user.id;

      if (!req.file) {
        return res.status(400).json({
          success: false,
          message: 'File wajib diupload'
        });
      }

      // Verify file is PNG
      const ext = path.extname(req.file.originalname).toLowerCase();
      if (ext !== '.png') {
        fs.unlinkSync(req.file.path);
        return res.status(400).json({
          success: false,
          message: 'Stempel harus berformat PNG transparan'
        });
      }

      // Verify user is from this kecamatan
      const [users] = await sequelize.query(`
        SELECT kecamatan_id FROM users WHERE id = ?
      `, { replacements: [userId] });

      if (!users || users.length === 0 || users[0].kecamatan_id != kecamatanId) {
        fs.unlinkSync(req.file.path);
        return res.status(403).json({
          success: false,
          message: 'Anda tidak memiliki akses'
        });
      }

      const filePath = `signatures/${req.file.filename}`;

      await sequelize.query(`
        UPDATE kecamatan_bankeu_config
        SET stempel_path = ?, updated_at = NOW()
        WHERE kecamatan_id = ?
      `, { replacements: [filePath, kecamatanId] });

      const [updated] = await sequelize.query(`
        SELECT * FROM kecamatan_bankeu_config
        WHERE kecamatan_id = ?
      `, { replacements: [kecamatanId] });

      res.json({
        success: true,
        message: 'Stempel berhasil diupload',
        data: updated[0]
      });
    } catch (error) {
      if (req.file && req.file.path) {
        fs.unlinkSync(req.file.path);
      }
      logger.error('Error uploading stempel:', error);
      res.status(500).json({
        success: false,
        message: 'Gagal mengupload stempel',
        error: error.message
      });
    }
  }

  /**
   * Delete stempel
   * DELETE /api/kecamatan/bankeu/config/:kecamatanId/delete-stempel
   */
  async deleteStempel(req, res) {
    try {
      const { kecamatanId } = req.params;
      const userId = req.user.id;

      // Verify user is from this kecamatan
      const [users] = await sequelize.query(`
        SELECT kecamatan_id FROM users WHERE id = ?
      `, { replacements: [userId] });

      if (!users || users.length === 0 || users[0].kecamatan_id != kecamatanId) {
        return res.status(403).json({
          success: false,
          message: 'Anda tidak memiliki akses'
        });
      }

      // Get current stempel path
      const [config] = await sequelize.query(`
        SELECT stempel_path FROM kecamatan_bankeu_config
        WHERE kecamatan_id = ?
      `, { replacements: [kecamatanId] });

      // Delete file if exists
      if (config && config[0] && config[0].stempel_path) {
        const filePath = path.join(__dirname, '../../storage/uploads', config[0].stempel_path);
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
        }
      }

      // Update database
      await sequelize.query(`
        UPDATE kecamatan_bankeu_config
        SET stempel_path = NULL, updated_at = NOW()
        WHERE kecamatan_id = ?
      `, { replacements: [kecamatanId] });

      res.json({
        success: true,
        message: 'Stempel berhasil dihapus'
      });
    } catch (error) {
      logger.error('Error deleting stempel:', error);
      res.status(500).json({
        success: false,
        message: 'Gagal menghapus stempel',
        error: error.message
      });
    }
  }
}

module.exports = new BankeuVerificationController();


