const sequelize = require('../config/database');
const prisma = require('../config/prisma');
const logger = require('../utils/logger');
const ActivityLogger = require('../utils/activityLogger');
const path = require('path');
const fs = require('fs');
const PDFDocument = require('pdfkit');
const { flattenAnnotations } = require('../utils/pdfAnnotation');
const { fetchVersions, fetchRevisions } = require('../utils/bankeuPerubahanRevisionService');

const MODULE_NAME = 'bankeu_perubahan';
const PERUBAHAN_DIR = path.join(__dirname, '../../storage/uploads/bankeu-perubahan');
const ANNOTATED_DIR = path.join(PERUBAHAN_DIR, 'annotated');

/**
 * Normalisasi annotation_data (boleh object atau string JSON).
 */
function parseAnnotation(raw) {
  if (!raw) return null;
  if (typeof raw === 'string') {
    try { return JSON.parse(raw); } catch (e) { return null; }
  }
  return raw;
}

function annotationHasContent(data) {
  if (!data || !Array.isArray(data.pages)) return false;
  return data.pages.some(p => (Array.isArray(p.items) && p.items.length > 0) || (p.note && String(p.note).trim()));
}

/**
 * Helper: pastikan proposal milik kecamatan user. Return proposal row atau null
 * (sudah mengirim response error bila tidak valid). Fungsi modul — tanpa `this`.
 */
async function assertKecamatanProposal(req, res) {
  const userId = req.user.id;
  const { id } = req.params;
  const [users] = await sequelize.query(`SELECT kecamatan_id FROM users WHERE id = ?`, { replacements: [userId] });
  if (!users[0]?.kecamatan_id) {
    res.status(403).json({ success: false, message: 'User tidak terkait dengan kecamatan' });
    return null;
  }
  const [proposals] = await sequelize.query(`
    SELECT bp.id, bp.file_proposal, bp.current_version, bp.kecamatan_annotation_draft,
           bp.kecamatan_status, d.kecamatan_id
    FROM bankeu_perubahan_proposals bp
    INNER JOIN desas d ON bp.desa_id = d.id
    WHERE bp.id = ?
  `, { replacements: [id] });
  if (!proposals.length) {
    res.status(404).json({ success: false, message: 'Proposal tidak ditemukan' });
    return null;
  }
  if (Number(proposals[0].kecamatan_id) !== Number(users[0].kecamatan_id)) {
    res.status(403).json({ success: false, message: 'Proposal ini bukan dari kecamatan Anda' });
    return null;
  }
  return proposals[0];
}

/**
 * Catat satu ronde revisi Kecamatan (Prisma). Bila ada anotasi, flatten ke PDF.
 * Mengembalikan { revisionId, annotatedPath } atau null jika gagal kritikal.
 */
async function recordRevisionRound({ proposalId, fileProposal, annotationData, catatan, decision, userId }) {
  const pid = BigInt(proposalId);

  // Versi dokumen yang sedang dianotasi = versi terbaru
  let latestVersion = await prisma.bankeu_perubahan_proposal_versions.findFirst({
    where: { proposal_id: pid },
    orderBy: { version_number: 'desc' },
    select: { id: true },
  });
  // Proposal lama belum punya riwayat versi (dibuat sebelum fitur versioning).
  // Buat versi awal dari file proposal saat ini agar ronde revisi & PDF
  // beranotasi tetap tercatat — jangan dilewati.
  if (!latestVersion) {
    if (!fileProposal) {
      logger.warn(`[BankeuPerubahan Kec] Proposal #${proposalId} tanpa versi & tanpa file; ronde revisi dilewati`);
      return null;
    }
    const seeded = await prisma.bankeu_perubahan_proposal_versions.create({
      data: {
        proposal_id: pid,
        version_number: 1,
        file_proposal: fileProposal,
        file_size: null,
        source: 'initial',
        uploaded_by: null,
      },
    });
    await prisma.bankeu_perubahan_proposals.update({
      where: { id: pid },
      data: { current_version: 1 },
    });
    latestVersion = { id: seeded.id };
    logger.info(`[BankeuPerubahan Kec] Proposal #${proposalId}: versi awal dibuat otomatis (backfill) sebelum ronde revisi`);
  }

  // Nomor ronde berikutnya
  const roundCount = await prisma.bankeu_perubahan_revisions.count({ where: { proposal_id: pid } });
  const roundNumber = roundCount + 1;

  // Flatten anotasi ke PDF (opsional — hanya bila ada konten & file asli ada)
  let annotatedPath = null;
  const data = parseAnnotation(annotationData);
  if (annotationHasContent(data) && fileProposal) {
    const originalPath = path.join(PERUBAHAN_DIR, fileProposal);
    if (fs.existsSync(originalPath)) {
      if (!fs.existsSync(ANNOTATED_DIR)) fs.mkdirSync(ANNOTATED_DIR, { recursive: true });
      const outName = `annotated_p${proposalId}_rev${roundNumber}_${Date.now()}.pdf`;
      const outPath = path.join(ANNOTATED_DIR, outName);
      try {
        await flattenAnnotations(originalPath, data, outPath);
        annotatedPath = `annotated/${outName}`;
      } catch (e) {
        logger.error('[BankeuPerubahan Kec] Gagal flatten anotasi PDF:', e);
      }
    } else {
      logger.warn(`[BankeuPerubahan Kec] File asli tidak ditemukan utk flatten: ${originalPath}`);
    }
  }

  const revision = await prisma.bankeu_perubahan_revisions.create({
    data: {
      proposal_id: pid,
      version_id: latestVersion.id,
      round_number: roundNumber,
      annotation_data: data || undefined,
      annotated_pdf_path: annotatedPath,
      catatan: catatan || null,
      decision: decision === 'rejected' ? 'rejected' : 'revision',
      annotated_by: userId ? BigInt(userId) : null,
    },
  });

  // Tandai revisi terbaru + bersihkan draft
  await prisma.bankeu_perubahan_proposals.update({
    where: { id: pid },
    data: { latest_revision_id: revision.id, kecamatan_annotation_draft: null },
  });

  return { revisionId: revision.id, annotatedPath, roundNumber };
}

class BankeuPerubahanVerificationController {
  /**
   * Get proposals perubahan untuk kecamatan
   * GET /api/kecamatan/bankeu-perubahan/proposals?tahun=2026
   */
  async getProposalsByKecamatan(req, res) {
    try {
      const userId = req.user.id;
      const { status, jenis_kegiatan, desa_id, tahun } = req.query;

      const [users] = await sequelize.query(`
        SELECT kecamatan_id FROM users WHERE id = ?
      `, { replacements: [userId] });

      if (!users[0]?.kecamatan_id) {
        return res.status(403).json({
          success: false,
          message: 'User tidak terkait dengan kecamatan'
        });
      }
      const kecamatanId = users[0].kecamatan_id;

      // Hanya tampilkan proposal yang sudah disubmit ke kecamatan
      let whereClause = `WHERE d.kecamatan_id = ?
        AND d.status_pemerintahan = 'desa'
        AND bp.submitted_to_kecamatan = TRUE`;
      const replacements = [kecamatanId];

      if (tahun) { whereClause += ' AND bp.tahun_anggaran = ?'; replacements.push(parseInt(tahun)); }
      if (status) { whereClause += ' AND bp.kecamatan_status = ?'; replacements.push(status); }
      if (jenis_kegiatan) { whereClause += ' AND bp.jenis_kegiatan = ?'; replacements.push(jenis_kegiatan); }
      if (desa_id) { whereClause += ' AND bp.desa_id = ?'; replacements.push(desa_id); }

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
          bp.catatan_verifikasi, bp.verified_at,
          bp.created_at, bp.updated_at,
          u_created.name AS created_by_name,
          u_kec.name AS kecamatan_verified_by_name,
          u_dpmd.name AS dpmd_verified_by_name,
          d.nama AS desa_nama,
          d.kecamatan_id AS desa_kecamatan_id,
          k.nama AS kecamatan_nama
        FROM bankeu_perubahan_proposals bp
        INNER JOIN desas d ON bp.desa_id = d.id
        LEFT JOIN users u_created ON bp.created_by = u_created.id
        LEFT JOIN users u_kec ON bp.kecamatan_verified_by = u_kec.id
        LEFT JOIN users u_dpmd ON bp.dpmd_verified_by = u_dpmd.id
        LEFT JOIN kecamatans k ON d.kecamatan_id = k.id
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
      logger.error('[BankeuPerubahan Kec] Error fetching proposals:', error);
      res.status(500).json({
        success: false,
        message: 'Gagal mengambil data proposal perubahan',
        error: error.message
      });
    }
  }

  /**
   * Tracking lintas-tahap untuk KECAMATAN: SEMUA proposal perubahan di wilayah
   * kecamatan user (apapun statusnya, termasuk yang masih draft/revisi di Desa &
   * yang sudah diteruskan ke DPMD) — dipakai tab "Tracking Status" kecamatan.
   * Berbeda dari getProposalsByKecamatan yang dibatasi submitted_to_kecamatan = TRUE.
   * GET /api/kecamatan/bankeu-perubahan/tracking?tahun=2026
   */
  async getTracking(req, res) {
    try {
      const userId = req.user.id;
      const { tahun } = req.query;

      const [users] = await sequelize.query(`
        SELECT kecamatan_id FROM users WHERE id = ?
      `, { replacements: [userId] });

      if (!users[0]?.kecamatan_id) {
        return res.status(403).json({
          success: false,
          message: 'User tidak terkait dengan kecamatan'
        });
      }
      const kecamatanId = users[0].kecamatan_id;

      let whereClause = `WHERE d.kecamatan_id = ? AND d.status_pemerintahan = 'desa'`;
      const replacements = [kecamatanId];
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
        ORDER BY d.nama ASC, bp.created_at DESC
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
      logger.error('[BankeuPerubahan Kec] Error fetching tracking:', error);
      res.status(500).json({
        success: false,
        message: 'Gagal mengambil data tracking perubahan',
        error: error.message
      });
    }
  }

  /**
   * Verify proposal (approve/reject/revision)
   * PATCH /api/kecamatan/bankeu-perubahan/proposals/:id/verify
   */
  async verifyProposal(req, res) {
    try {
      const { id } = req.params;
      const userId = req.user.id;
      const { status, catatan, annotation_data } = req.body;

      if (!['approved', 'rejected', 'revision'].includes(status)) {
        return res.status(400).json({
          success: false,
          message: 'Status verifikasi tidak valid (approved/rejected/revision)'
        });
      }

      // Check user kecamatan
      const [users] = await sequelize.query(`
        SELECT kecamatan_id, name FROM users WHERE id = ?
      `, { replacements: [userId] });

      if (!users[0]?.kecamatan_id) {
        return res.status(403).json({ success: false, message: 'User tidak terkait dengan kecamatan' });
      }

      const [proposals] = await sequelize.query(`
        SELECT bp.id, bp.judul_proposal, bp.kecamatan_status, bp.submitted_to_dpmd, bp.desa_id, d.kecamatan_id,
               bp.file_proposal, bp.current_version, bp.berita_acara_path, bp.surat_pengantar_kecamatan_path
        FROM bankeu_perubahan_proposals bp
        INNER JOIN desas d ON bp.desa_id = d.id
        WHERE bp.id = ?
      `, { replacements: [id] });

      if (!proposals.length) {
        return res.status(404).json({ success: false, message: 'Proposal tidak ditemukan' });
      }

      const proposal = proposals[0];
      if (Number(proposal.kecamatan_id) !== Number(users[0].kecamatan_id)) {
        return res.status(403).json({
          success: false,
          message: 'Proposal ini bukan dari kecamatan Anda'
        });
      }

      if (proposal.submitted_to_dpmd) {
        return res.status(400).json({
          success: false,
          message: 'Proposal sudah dikirim ke DPMD, tidak bisa diverifikasi ulang. Batalkan dulu pengiriman ke DPMD.'
        });
      }

      if (status === 'approved') {
        const missingDocs = [];
        if (!proposal.berita_acara_path) missingDocs.push('Berita Acara');
        if (!proposal.surat_pengantar_kecamatan_path) missingDocs.push('Surat Pengantar Kecamatan');

        if (missingDocs.length > 0) {
          return res.status(400).json({
            success: false,
            message: `Belum bisa menyetujui proposal. Generate ${missingDocs.join(' dan ')} terlebih dahulu.`,
            data: { missing_documents: missingDocs }
          });
        }
      }

      // Update verification
      // Jika status = rejected/revision, kembalikan ke desa: submitted_to_kecamatan = FALSE
      const submittedToKecValue = (status === 'rejected' || status === 'revision') ? false : true;
      const returnToDesa = (status === 'rejected' || status === 'revision');

      await sequelize.query(`
        UPDATE bankeu_perubahan_proposals
        SET kecamatan_status = ?,
            kecamatan_catatan = ?,
            kecamatan_verified_by = ?,
            kecamatan_verified_at = NOW(),
            verified_by = ?,
            verified_at = NOW(),
            catatan_verifikasi = ?,
            status = ?,
            submitted_to_kecamatan = ?,
            updated_at = NOW()
        WHERE id = ?
      `, {
        replacements: [
          status, catatan || null, userId,
          userId, catatan || null,
          // status legacy mapping
          status === 'approved' ? 'verified' : (status === 'revision' ? 'revision' : 'rejected'),
          submittedToKecValue,
          id
        ]
      });

      // Untuk revisi/penolakan: simpan ronde revisi + (opsional) PDF beranotasi
      let revisionResult = null;
      if (returnToDesa) {
        try {
          revisionResult = await recordRevisionRound({
            proposalId: id,
            fileProposal: proposal.file_proposal,
            annotationData: annotation_data,
            catatan,
            decision: status,
            userId,
          });
        } catch (revErr) {
          logger.error('[BankeuPerubahan Kec] Gagal menyimpan ronde revisi/anotasi:', revErr);
        }
      }

      logger.info(`[BankeuPerubahan Kec] Proposal #${id} ${status} by user ${userId}${returnToDesa ? ' (returned to desa)' : ''}`);

      ActivityLogger.log({
        userId,
        userName: users[0].name || `User ${userId}`,
        userRole: req.user.role,
        bidangId: 3,
        module: MODULE_NAME,
        action: status === 'approved' ? 'approve' : 'reject',
        entityType: 'bankeu_perubahan_proposal',
        entityId: parseInt(id),
        entityName: proposal.judul_proposal,
        description: `${users[0].name || 'User'} ${status === 'approved' ? 'menyetujui' : (status === 'revision' ? 'meminta revisi' : 'menolak')} proposal perubahan #${id} di kecamatan`,
        newValue: { kecamatan_status: status, catatan: catatan || null },
        ipAddress: ActivityLogger.getIpFromRequest(req),
        userAgent: ActivityLogger.getUserAgentFromRequest(req)
      });

      res.json({
        success: true,
        message: `Proposal berhasil di-${status === 'approved' ? 'setujui' : (status === 'revision' ? 'minta revisi' : 'tolak')}`,
        data: revisionResult ? {
          revision_id: Number(revisionResult.revisionId),
          round_number: revisionResult.roundNumber,
          annotated_pdf_path: revisionResult.annotatedPath
            ? `/storage/uploads/bankeu-perubahan/${revisionResult.annotatedPath}`
            : null,
        } : null,
      });
    } catch (error) {
      logger.error('[BankeuPerubahan Kec] Error verify:', error);
      res.status(500).json({ success: false, message: 'Gagal memverifikasi proposal', error: error.message });
    }
  }

  /**
   * Cancel approval - kembalikan ke pending sebelum submit ke DPMD
   * PATCH /api/kecamatan/bankeu-perubahan/proposals/:id/cancel-approval
   */
  async cancelApproval(req, res) {
    try {
      const { id } = req.params;
      const userId = req.user.id;

      const [users] = await sequelize.query(`SELECT kecamatan_id, name FROM users WHERE id = ?`, { replacements: [userId] });
      if (!users[0]?.kecamatan_id) {
        return res.status(403).json({ success: false, message: 'User tidak terkait dengan kecamatan' });
      }

      const [proposals] = await sequelize.query(`
        SELECT bp.id, bp.judul_proposal, bp.kecamatan_status, bp.submitted_to_dpmd, d.kecamatan_id
        FROM bankeu_perubahan_proposals bp
        INNER JOIN desas d ON bp.desa_id = d.id
        WHERE bp.id = ?
      `, { replacements: [id] });

      if (!proposals.length) {
        return res.status(404).json({ success: false, message: 'Proposal tidak ditemukan' });
      }
      const proposal = proposals[0];
      if (Number(proposal.kecamatan_id) !== Number(users[0].kecamatan_id)) {
        return res.status(403).json({ success: false, message: 'Akses ditolak' });
      }
      if (proposal.submitted_to_dpmd) {
        return res.status(400).json({
          success: false,
          message: 'Proposal sudah dikirim ke DPMD, tidak dapat dibatalkan'
        });
      }
      if (proposal.kecamatan_status !== 'approved') {
        return res.status(400).json({
          success: false,
          message: 'Hanya proposal yang sudah disetujui yang dapat dibatalkan'
        });
      }

      await sequelize.query(`
        UPDATE bankeu_perubahan_proposals
        SET kecamatan_status = 'pending',
            kecamatan_catatan = NULL,
            kecamatan_verified_by = NULL,
            kecamatan_verified_at = NULL,
            verified_by = NULL,
            verified_at = NULL,
            catatan_verifikasi = NULL,
            status = 'pending',
            updated_at = NOW()
        WHERE id = ?
      `, { replacements: [id] });

      ActivityLogger.log({
        userId,
        userName: users[0].name || `User ${userId}`,
        userRole: req.user.role,
        bidangId: 3,
        module: MODULE_NAME,
        action: 'update',
        entityType: 'bankeu_perubahan_proposal',
        entityId: parseInt(id),
        entityName: proposal.judul_proposal,
        description: `${users[0].name || 'User'} membatalkan persetujuan proposal perubahan #${id}`,
        ipAddress: ActivityLogger.getIpFromRequest(req),
        userAgent: ActivityLogger.getUserAgentFromRequest(req)
      });

      res.json({ success: true, message: 'Persetujuan berhasil dibatalkan' });
    } catch (error) {
      logger.error('[BankeuPerubahan Kec] Error cancel:', error);
      res.status(500).json({ success: false, message: 'Gagal membatalkan persetujuan', error: error.message });
    }
  }

  /**
   * Submit semua proposal approved dari satu desa ke DPMD
   * POST /api/kecamatan/bankeu-perubahan/desa/:desaId/submit-to-dpmd
   */
  async submitToDpmd(req, res) {
    const transaction = await sequelize.transaction();
    try {
      const { desaId } = req.params;
      const { tahun } = req.body;
      const userId = req.user.id;

      const [users] = await sequelize.query(`SELECT kecamatan_id, name FROM users WHERE id = ?`, { replacements: [userId] });
      if (!users[0]?.kecamatan_id) {
        await transaction.rollback();
        return res.status(403).json({ success: false, message: 'User tidak terkait dengan kecamatan' });
      }
      const kecamatanId = users[0].kecamatan_id;

      // Validasi desa
      const [desa] = await sequelize.query(`SELECT id, kecamatan_id, nama FROM desas WHERE id = ?`, { replacements: [desaId] });
      if (!desa.length || Number(desa[0].kecamatan_id) !== Number(kecamatanId)) {
        await transaction.rollback();
        return res.status(403).json({
          success: false,
          message: 'Desa bukan dari kecamatan Anda'
        });
      }

      const filters = [
        'desa_id = ?',
        "kecamatan_status = 'approved'",
        'submitted_to_dpmd = FALSE'
      ];
      const replacements = [desaId];
      if (tahun) { filters.push('tahun_anggaran = ?'); replacements.push(parseInt(tahun)); }

      const [cntRows] = await sequelize.query(`
        SELECT COUNT(*) AS total FROM bankeu_perubahan_proposals
        WHERE ${filters.join(' AND ')}
      `, { replacements });
      const count = Number(cntRows[0].total);

      if (count < 1) {
        await transaction.rollback();
        return res.status(400).json({
          success: false,
          message: 'Tidak ada proposal yang siap dikirim ke DPMD'
        });
      }

      // Prerequisite: setiap proposal approved harus punya Quisioner + BA + Surat Pengantar
      const [missingDocs] = await sequelize.query(`
        SELECT id, judul_proposal,
               (quisioner_completed IS NULL OR quisioner_completed = FALSE) AS missing_quisioner,
               (berita_acara_path IS NULL OR berita_acara_path = '') AS missing_ba,
               (surat_pengantar_kecamatan_path IS NULL OR surat_pengantar_kecamatan_path = '') AS missing_sp
        FROM bankeu_perubahan_proposals
        WHERE ${filters.join(' AND ')}
          AND (
            quisioner_completed IS NULL OR quisioner_completed = FALSE OR
            berita_acara_path IS NULL OR berita_acara_path = '' OR
            surat_pengantar_kecamatan_path IS NULL OR surat_pengantar_kecamatan_path = ''
          )
      `, { replacements });

      if (missingDocs.length > 0) {
        await transaction.rollback();
        return res.status(400).json({
          success: false,
          message: 'Dokumen Kecamatan belum lengkap. Setiap proposal wajib memiliki Quisioner, Berita Acara, dan Surat Pengantar sebelum dikirim ke DPMD.',
          data: {
            incomplete_proposals: missingDocs.map(p => ({
              id: p.id,
              judul: p.judul_proposal,
              missing: [
                p.missing_quisioner ? 'Quisioner' : null,
                p.missing_ba ? 'Berita Acara' : null,
                p.missing_sp ? 'Surat Pengantar' : null,
              ].filter(Boolean),
            })),
          },
        });
      }

      await sequelize.query(`
        UPDATE bankeu_perubahan_proposals
        SET submitted_to_dpmd = TRUE,
            submitted_to_dpmd_at = NOW(),
            dpmd_status = 'pending',
            updated_at = NOW()
        WHERE ${filters.join(' AND ')}
      `, { replacements, transaction });

      await transaction.commit();

      ActivityLogger.log({
        userId,
        userName: users[0].name || `User ${userId}`,
        userRole: req.user.role,
        bidangId: 3,
        module: MODULE_NAME,
        action: 'submit',
        entityType: 'bankeu_perubahan_proposal',
        entityName: `${count} proposal desa ${desaId}`,
        description: `${users[0].name || 'User'} mengirim ${count} proposal perubahan ke DPMD (Desa: ${desa[0].nama}, Tahun: ${tahun || 'ALL'})`,
        newValue: { count, desa_id: desaId, tahun: tahun || 'ALL', destination: 'dpmd' },
        ipAddress: ActivityLogger.getIpFromRequest(req),
        userAgent: ActivityLogger.getUserAgentFromRequest(req)
      });

      res.json({
        success: true,
        message: `${count} proposal perubahan dari desa ${desa[0].nama} berhasil dikirim ke DPMD`
      });
    } catch (error) {
      try { await transaction.rollback(); } catch (e) {}
      logger.error('[BankeuPerubahan Kec] Error submit to dpmd:', error);
      res.status(500).json({ success: false, message: 'Gagal mengirim ke DPMD', error: error.message });
    }
  }

  /**
   * Statistik proposal perubahan di kecamatan
   * GET /api/kecamatan/bankeu-perubahan/statistics
   */
  async getStatistics(req, res) {
    try {
      const userId = req.user.id;
      const { tahun } = req.query;

      const [users] = await sequelize.query(`SELECT kecamatan_id FROM users WHERE id = ?`, { replacements: [userId] });
      if (!users[0]?.kecamatan_id) {
        return res.status(403).json({ success: false, message: 'User tidak terkait dengan kecamatan' });
      }
      const kecamatanId = users[0].kecamatan_id;

      let whereTahun = '';
      const replacements = [kecamatanId];
      if (tahun) { whereTahun = 'AND bp.tahun_anggaran = ?'; replacements.push(parseInt(tahun)); }

      const [stats] = await sequelize.query(`
        SELECT
          COUNT(*) AS total,
          SUM(CASE WHEN bp.kecamatan_status = 'pending' THEN 1 ELSE 0 END) AS pending,
          SUM(CASE WHEN bp.kecamatan_status = 'approved' THEN 1 ELSE 0 END) AS approved,
          SUM(CASE WHEN bp.kecamatan_status = 'rejected' THEN 1 ELSE 0 END) AS rejected,
          SUM(CASE WHEN bp.kecamatan_status = 'revision' THEN 1 ELSE 0 END) AS revision,
          SUM(CASE WHEN bp.submitted_to_dpmd = TRUE THEN 1 ELSE 0 END) AS submitted_to_dpmd,
          SUM(CASE WHEN bp.dpmd_status = 'approved' THEN 1 ELSE 0 END) AS dpmd_approved,
          SUM(CASE WHEN bp.anggaran_usulan IS NOT NULL THEN bp.anggaran_usulan ELSE 0 END) AS total_anggaran
        FROM bankeu_perubahan_proposals bp
        INNER JOIN desas d ON bp.desa_id = d.id
        WHERE d.kecamatan_id = ?
          AND bp.submitted_to_kecamatan = TRUE
          ${whereTahun}
      `, { replacements });

      res.json({ success: true, data: stats[0] || {} });
    } catch (error) {
      logger.error('[BankeuPerubahan Kec] Error stats:', error);
      res.status(500).json({ success: false, message: 'Gagal mengambil statistik', error: error.message });
    }
  }

  /**
   * Generate Berita Acara per Desa
   * POST /api/kecamatan/bankeu-perubahan/desa/:desaId/berita-acara
   * Body: tahun
   */
  async generateBeritaAcaraDesa(req, res) {
    try {
      const { desaId } = req.params;
      const { tahun } = req.body;
      const userId = req.user.id;

      const [users] = await sequelize.query(`SELECT kecamatan_id, name FROM users WHERE id = ?`, { replacements: [userId] });
      if (!users[0]?.kecamatan_id) {
        return res.status(403).json({ success: false, message: 'User tidak terkait dengan kecamatan' });
      }
      const kecamatanId = users[0].kecamatan_id;

      // Validasi desa
      const [desaRows] = await sequelize.query(`
        SELECT id, kecamatan_id, nama FROM desas WHERE id = ?
      `, { replacements: [desaId] });
      if (!desaRows.length || Number(desaRows[0].kecamatan_id) !== Number(kecamatanId)) {
        return res.status(403).json({ success: false, message: 'Desa tidak terkait dengan kecamatan Anda' });
      }

      const tahunValue = tahun ? parseInt(tahun) : new Date().getFullYear();

      // Get proposals (approved)
      const [proposals] = await sequelize.query(`
        SELECT id, judul_proposal, jenis_kegiatan, anggaran_usulan, nama_kegiatan_spesifik, volume, lokasi
        FROM bankeu_perubahan_proposals
        WHERE desa_id = ? AND tahun_anggaran = ? AND kecamatan_status = 'approved'
      `, { replacements: [desaId, tahunValue] });

      if (!proposals.length) {
        return res.status(400).json({
          success: false,
          message: 'Tidak ada proposal yang disetujui untuk desa ini'
        });
      }

      // Get kecamatan config & kecamatan info
      const [configRows] = await sequelize.query(`
        SELECT * FROM kecamatan_bankeu_perubahan_config WHERE kecamatan_id = ?
      `, { replacements: [kecamatanId] });
      const [kecRows] = await sequelize.query(`
        SELECT nama FROM kecamatans WHERE id = ?
      `, { replacements: [kecamatanId] });

      const config = configRows[0] || { nama_camat: 'Camat', jabatan_penandatangan: 'Camat' };
      const kecamatanNama = kecRows[0]?.nama || '-';

      // Get tim verifikasi
      const [tim] = await sequelize.query(`
        SELECT jabatan, jabatan_label, nama, nip, ttd_path
        FROM tim_verifikasi_bankeu_perubahan
        WHERE kecamatan_id = ? AND is_active = TRUE
        ORDER BY created_at ASC
      `, { replacements: [kecamatanId] });

      // Generate PDF
      const outDir = path.join(__dirname, '../../storage/uploads/bankeu-perubahan/berita-acara');
      if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
      const fileName = `BA_perubahan_desa${desaId}_ta${tahunValue}_${Date.now()}.pdf`;
      const filePath = path.join(outDir, fileName);

      const doc = new PDFDocument({ size: 'A4', margin: 50 });
      doc.pipe(fs.createWriteStream(filePath));

      doc.fontSize(14).font('Helvetica-Bold').text('BERITA ACARA VERIFIKASI', { align: 'center' });
      doc.fontSize(12).text('PROPOSAL BANTUAN KEUANGAN PERUBAHAN', { align: 'center' });
      doc.text(`TAHUN ANGGARAN ${tahunValue}`, { align: 'center' });
      doc.moveDown();

      doc.fontSize(11).font('Helvetica').text(
        `Pada hari ini, ${new Date().toLocaleDateString('id-ID', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}, ` +
        `bertempat di Kantor Kecamatan ${kecamatanNama}, telah dilaksanakan verifikasi proposal Bantuan Keuangan Perubahan ` +
        `untuk Desa ${desaRows[0].nama} dengan hasil sebagai berikut:`,
        { align: 'justify' }
      );
      doc.moveDown();

      doc.font('Helvetica-Bold').text('Daftar Proposal yang Disetujui:');
      doc.moveDown(0.5);
      let totalAnggaran = 0;
      proposals.forEach((p, idx) => {
        doc.font('Helvetica').text(`${idx + 1}. ${p.judul_proposal}`);
        if (p.nama_kegiatan_spesifik) doc.text(`   - Kegiatan: ${p.nama_kegiatan_spesifik}`);
        if (p.volume) doc.text(`   - Volume: ${p.volume}`);
        if (p.lokasi) doc.text(`   - Lokasi: ${p.lokasi}`);
        if (p.anggaran_usulan) {
          doc.text(`   - Anggaran: Rp ${Number(p.anggaran_usulan).toLocaleString('id-ID')}`);
          totalAnggaran += Number(p.anggaran_usulan);
        }
        doc.moveDown(0.3);
      });

      doc.moveDown();
      doc.font('Helvetica-Bold').text(`Total Anggaran: Rp ${totalAnggaran.toLocaleString('id-ID')}`);
      doc.moveDown();

      doc.font('Helvetica').text(
        'Demikian berita acara ini dibuat dengan sebenarnya untuk dipergunakan sebagaimana mestinya.',
        { align: 'justify' }
      );
      doc.moveDown(2);

      // TTD section
      const ttdY = doc.y;
      doc.text('Tim Verifikasi Kecamatan', 50, ttdY);
      doc.text(`${config.jabatan_penandatangan || 'Camat'} ${kecamatanNama}`, 350, ttdY);
      doc.moveDown(4);

      // Camat signature
      const camatY = doc.y;
      doc.font('Helvetica-Bold').text(config.nama_camat || 'Camat', 350, camatY);
      if (config.nip_camat) {
        doc.font('Helvetica').fontSize(10).text(`NIP. ${config.nip_camat}`, 350, doc.y);
      }
      doc.fontSize(11);

      // Tim verifikasi names
      if (tim.length > 0) {
        let timY = camatY;
        tim.slice(0, 5).forEach((t, idx) => {
          doc.font('Helvetica-Bold').text(`${idx + 1}. ${t.nama}`, 50, timY);
          if (t.nip) doc.font('Helvetica').fontSize(9).text(`   NIP. ${t.nip}`, 50, doc.y);
          if (t.jabatan_label) doc.fontSize(9).text(`   (${t.jabatan_label})`, 50, doc.y);
          doc.fontSize(11);
          timY = doc.y + 5;
        });
      }

      doc.end();

      // Wait for write to finish
      await new Promise((resolve) => setTimeout(resolve, 500));

      // Save BA path to all approved proposals
      await sequelize.query(`
        UPDATE bankeu_perubahan_proposals
        SET berita_acara_path = ?, berita_acara_generated_at = NOW(), updated_at = NOW()
        WHERE desa_id = ? AND tahun_anggaran = ? AND kecamatan_status = 'approved'
      `, { replacements: [fileName, desaId, tahunValue] });

      ActivityLogger.log({
        userId,
        userName: users[0].name || `User ${userId}`,
        userRole: req.user.role,
        bidangId: 3,
        module: MODULE_NAME,
        action: 'create',
        entityType: 'bankeu_perubahan_berita_acara',
        entityName: `BA Desa ${desaRows[0].nama}`,
        description: `${users[0].name || 'User'} generate Berita Acara untuk Desa ${desaRows[0].nama} (TA ${tahunValue})`,
        newValue: { file: fileName, total_proposals: proposals.length, total_anggaran: totalAnggaran },
        ipAddress: ActivityLogger.getIpFromRequest(req),
        userAgent: ActivityLogger.getUserAgentFromRequest(req)
      });

      res.json({
        success: true,
        message: `Berita Acara berhasil dibuat untuk ${proposals.length} proposal`,
        data: { file: fileName, path: `/storage/uploads/bankeu-perubahan/berita-acara/${fileName}` }
      });
    } catch (error) {
      logger.error('[BankeuPerubahan Kec] Error generate BA:', error);
      res.status(500).json({ success: false, message: 'Gagal generate Berita Acara', error: error.message });
    }
  }

  /**
   * Submit Review per desa (alias submitToDpmd dengan validasi BA)
   * POST /api/kecamatan/bankeu-perubahan/desa/:desaId/submit-review
   */
  async submitReview(req, res) {
    // Reuse submitToDpmd
    return this.submitToDpmd(req, res);
  }

  /**
   * Activity history per proposal
   * GET /api/kecamatan/bankeu-perubahan/proposals/:proposalId/history
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
      logger.error('[BankeuPerubahan Kec] Error history:', error);
      res.status(500).json({ success: false, message: 'Gagal mengambil riwayat', error: error.message });
    }
  }

  /**
   * Muat anotasi untuk editor (draft jika ada, jika tidak ambil ronde terakhir).
   * GET /api/kecamatan/bankeu-perubahan/proposals/:id/annotation
   */
  async getAnnotation(req, res) {
    try {
      const proposal = await assertKecamatanProposal(req, res);
      if (!proposal) return;

      let annotation = proposal.kecamatan_annotation_draft || null;
      if (typeof annotation === 'string') {
        try { annotation = JSON.parse(annotation); } catch (e) { annotation = null; }
      }
      let isDraft = !!annotation;

      // Bila tidak ada draft, ambil anotasi dari ronde revisi terakhir (untuk dilanjutkan)
      if (!annotation) {
        const lastRev = await prisma.bankeu_perubahan_revisions.findFirst({
          where: { proposal_id: BigInt(proposal.id) },
          orderBy: { round_number: 'desc' },
          select: { annotation_data: true },
        });
        annotation = lastRev?.annotation_data || null;
      }

      res.json({
        success: true,
        data: {
          annotation,
          is_draft: isDraft,
          file_proposal: proposal.file_proposal,
          file_url: `/storage/uploads/bankeu-perubahan/${proposal.file_proposal}`,
          current_version: proposal.current_version,
        },
      });
    } catch (error) {
      logger.error('[BankeuPerubahan Kec] Error getAnnotation:', error);
      res.status(500).json({ success: false, message: 'Gagal memuat anotasi', error: error.message });
    }
  }

  /**
   * Simpan draft anotasi (belum mengubah status proposal).
   * PUT /api/kecamatan/bankeu-perubahan/proposals/:id/annotation
   * Body: { annotation_data }
   */
  async saveAnnotationDraft(req, res) {
    try {
      const proposal = await assertKecamatanProposal(req, res);
      if (!proposal) return;

      let data = req.body?.annotation_data ?? null;
      if (typeof data === 'string') {
        try { data = JSON.parse(data); } catch (e) {
          return res.status(400).json({ success: false, message: 'annotation_data tidak valid (JSON)' });
        }
      }

      await prisma.bankeu_perubahan_proposals.update({
        where: { id: BigInt(proposal.id) },
        data: { kecamatan_annotation_draft: data || undefined },
      });

      res.json({ success: true, message: 'Draft anotasi tersimpan' });
    } catch (error) {
      logger.error('[BankeuPerubahan Kec] Error saveAnnotationDraft:', error);
      res.status(500).json({ success: false, message: 'Gagal menyimpan draft anotasi', error: error.message });
    }
  }

  /**
   * Riwayat versi dokumen.
   * GET /api/kecamatan/bankeu-perubahan/proposals/:id/versions
   */
  async getVersions(req, res) {
    try {
      const proposal = await assertKecamatanProposal(req, res);
      if (!proposal) return;
      const versions = await fetchVersions(proposal.id);
      res.json({ success: true, data: versions });
    } catch (error) {
      logger.error('[BankeuPerubahan Kec] Error getVersions:', error);
      res.status(500).json({ success: false, message: 'Gagal mengambil versi dokumen', error: error.message });
    }
  }

  /**
   * Riwayat ronde revisi/anotasi.
   * GET /api/kecamatan/bankeu-perubahan/proposals/:id/revisions
   */
  async getRevisions(req, res) {
    try {
      const proposal = await assertKecamatanProposal(req, res);
      if (!proposal) return;
      const revisions = await fetchRevisions(proposal.id);
      res.json({ success: true, data: revisions });
    } catch (error) {
      logger.error('[BankeuPerubahan Kec] Error getRevisions:', error);
      res.status(500).json({ success: false, message: 'Gagal mengambil riwayat revisi', error: error.message });
    }
  }
}

module.exports = new BankeuPerubahanVerificationController();
