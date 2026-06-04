const prisma = require('../config/prisma');
const sequelize = require('../config/database');
const logger = require('../utils/logger');
const ActivityLogger = require('../utils/activityLogger');
const path = require('path');
const fs = require('fs');
const { fetchVersions, fetchRevisions } = require('../utils/bankeuPerubahanRevisionService');

// Batas maksimal anggaran per proposal (1.5 Miliar) - sama dengan bankeu existing
const MAX_ANGGARAN = 1_500_000_000;
const MODULE_NAME = 'bankeu_perubahan';

/**
 * Helper: Check if bankeu perubahan submission is open for desa
 * Mirror dari checkSubmissionOpen di bankeuProposal.controller.js
 * Key: bankeu_perubahan_submission_desa_${tahun} (fallback: bankeu_perubahan_submission_desa)
 */
async function checkSubmissionOpen(tahun) {
  try {
    const { evaluateBankeuSchedule } = require('./appSettings.controller');

    let setting = null;
    if (tahun) {
      setting = await prisma.app_settings.findUnique({
        where: { setting_key: `bankeu_perubahan_submission_desa_${tahun}` }
      });
    }
    if (!setting) {
      setting = await prisma.app_settings.findUnique({
        where: { setting_key: 'bankeu_perubahan_submission_desa' }
      });
    }

    if (!setting) {
      return { isOpen: true, setting: null };
    }

    const { isOpen } = evaluateBankeuSchedule(setting.setting_value);
    return { isOpen, setting };
  } catch (error) {
    logger.error('[BankeuPerubahan] Error checking submission setting:', error);
    return { isOpen: true, setting: null };
  }
}

/**
 * Helper: cleanup uploaded file on error
 */
function cleanupUploadedFile(req) {
  if (req.file && req.file.path) {
    try { fs.unlinkSync(req.file.path); } catch (e) { /* ignore */ }
  }
}

/**
 * Helper: catat versi dokumen proposal (NON-DESTRUKTIF).
 * Semua versi file disimpan — file lama tidak pernah dihapus, agar riwayat &
 * anotasi Kecamatan tetap dapat dilihat. Mengembalikan version_number baru.
 * Pakai Prisma client (sesuai standar baru fitur ini).
 */
async function recordProposalVersion({ proposalId, fileName, fileSize, source, userId }) {
  const pid = BigInt(proposalId);
  const last = await prisma.bankeu_perubahan_proposal_versions.findFirst({
    where: { proposal_id: pid },
    orderBy: { version_number: 'desc' },
    select: { version_number: true },
  });
  const nextVersion = (last?.version_number || 0) + 1;

  await prisma.bankeu_perubahan_proposal_versions.create({
    data: {
      proposal_id: pid,
      version_number: nextVersion,
      file_proposal: fileName,
      file_size: (fileSize === undefined || fileSize === null) ? null : Number(fileSize),
      source: source === 'initial' ? 'initial' : 'revision',
      uploaded_by: userId ? BigInt(userId) : null,
    },
  });

  await prisma.bankeu_perubahan_proposals.update({
    where: { id: pid },
    data: { current_version: nextVersion },
  });

  return nextVersion;
}

/**
 * Helper: pastikan proposal milik desa user. Return proposalId atau null
 * (sudah kirim response error). Fungsi modul — tanpa `this`.
 */
async function assertDesaProposal(req, res) {
  const userId = req.user.id;
  const { id } = req.params;
  const [users] = await sequelize.query(`SELECT desa_id FROM users WHERE id = ?`, { replacements: [userId] });
  if (!users[0]?.desa_id) {
    res.status(403).json({ success: false, message: 'User tidak terkait dengan desa' });
    return null;
  }
  const [proposals] = await sequelize.query(`
    SELECT id, desa_id FROM bankeu_perubahan_proposals WHERE id = ?
  `, { replacements: [id] });
  if (!proposals.length) {
    res.status(404).json({ success: false, message: 'Proposal tidak ditemukan' });
    return null;
  }
  if (Number(proposals[0].desa_id) !== Number(users[0].desa_id)) {
    res.status(403).json({ success: false, message: 'Akses ditolak' });
    return null;
  }
  return proposals[0].id;
}

class BankeuPerubahanProposalController {
  /**
   * Get master kegiatan list untuk Bankeu PERUBAHAN (independen dari bankeu normal)
   * GET /api/desa/bankeu-perubahan/master-kegiatan
   * Return: { wajib: [], pilihan_infrastruktur: [], pilihan_non_infrastruktur: [] }
   */
  async getMasterKegiatan(req, res) {
    try {
      const [kegiatan] = await sequelize.query(`
        SELECT id, kategori, urutan, nama_kegiatan, deskripsi, is_active
        FROM bankeu_perubahan_master_kegiatan
        WHERE is_active = TRUE
        ORDER BY kategori, urutan
      `);

      const grouped = {
        wajib: [],
        pilihan_infrastruktur: [],
        pilihan_non_infrastruktur: []
      };
      kegiatan.forEach(item => {
        if (grouped[item.kategori]) {
          grouped[item.kategori].push({
            id: item.id,
            kategori: item.kategori,
            urutan: item.urutan,
            nama_kegiatan: item.nama_kegiatan,
            deskripsi: item.deskripsi
          });
        }
      });

      res.json({ success: true, data: grouped });
    } catch (error) {
      logger.error('[BankeuPerubahan] Error fetching master kegiatan:', error);
      res.status(500).json({
        success: false,
        message: 'Gagal mengambil data master kegiatan',
        error: error.message
      });
    }
  }

  /**
   * Get all proposals for logged-in desa
   * GET /api/desa/bankeu-perubahan/proposals?tahun=2026
   */
  async getProposalsByDesa(req, res) {
    try {
      const userId = req.user.id;
      const { tahun } = req.query;

      const [users] = await sequelize.query(`
        SELECT u.desa_id, d.kecamatan_id
        FROM users u
        LEFT JOIN desas d ON u.desa_id = d.id
        WHERE u.id = ?
      `, { replacements: [userId] });

      if (!users || users.length === 0 || !users[0].desa_id) {
        return res.status(403).json({
          success: false,
          message: 'User tidak terkait dengan desa'
        });
      }

      const desaId = users[0].desa_id;

      let whereClause = 'WHERE bp.desa_id = ?';
      const replacements = [desaId];

      if (tahun) {
        whereClause += ' AND bp.tahun_anggaran = ?';
        replacements.push(parseInt(tahun));
      }

      const [proposals] = await sequelize.query(`
        SELECT
          bp.id, bp.desa_id, bp.kecamatan_id, bp.tahun_anggaran,
          bp.jenis_kegiatan, bp.kegiatan_id, bp.kegiatan_nama,
          bp.nama_kegiatan_spesifik, bp.volume, bp.lokasi,
          bp.judul_proposal, bp.deskripsi, bp.file_proposal, bp.file_size,
          bp.current_version,
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
          u_kec.name AS kecamatan_verified_by_name,
          u_dpmd.name AS dpmd_verified_by_name,
          u_ver.name AS verified_by_name,
          d.nama AS desa_nama,
          k.nama AS kecamatan_nama
        FROM bankeu_perubahan_proposals bp
        INNER JOIN desas d ON bp.desa_id = d.id
        LEFT JOIN kecamatans k ON bp.kecamatan_id = k.id
        LEFT JOIN users u_kec ON bp.kecamatan_verified_by = u_kec.id
        LEFT JOIN users u_dpmd ON bp.dpmd_verified_by = u_dpmd.id
        LEFT JOIN users u_ver ON bp.verified_by = u_ver.id
        ${whereClause}
        ORDER BY bp.created_at DESC
      `, { replacements });

      // Attach kegiatan_list per proposal (use bankeu_perubahan_master_kegiatan)
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
      logger.error('[BankeuPerubahan] Error fetching proposals:', error);
      res.status(500).json({
        success: false,
        message: 'Gagal mengambil data proposal perubahan',
        error: error.message
      });
    }
  }

  /**
   * Upload new proposal perubahan
   * POST /api/desa/bankeu-perubahan/proposals
   */
  async uploadProposal(req, res) {
    try {
      const userId = req.user.id;
      const {
        kegiatan_ids,
        jenis_kegiatan,
        judul_proposal,
        nama_kegiatan_spesifik,
        volume,
        lokasi,
        deskripsi,
        anggaran_usulan,
        tahun_anggaran
      } = req.body;

      // Parse kegiatan_ids
      let kegiatanIdsArray = [];
      if (typeof kegiatan_ids === 'string') {
        try {
          kegiatanIdsArray = JSON.parse(kegiatan_ids);
        } catch (e) {
          cleanupUploadedFile(req);
          return res.status(400).json({
            success: false,
            message: 'Format kegiatan_ids tidak valid: ' + e.message
          });
        }
      } else if (Array.isArray(kegiatan_ids)) {
        kegiatanIdsArray = kegiatan_ids;
      }
      kegiatanIdsArray = kegiatanIdsArray.map(id => parseInt(id)).filter(n => !isNaN(n));

      // Validasi minimal
      if (!kegiatanIdsArray.length || !judul_proposal || !jenis_kegiatan) {
        cleanupUploadedFile(req);
        return res.status(400).json({
          success: false,
          message: 'Minimal 1 kegiatan, jenis kegiatan, dan judul proposal wajib diisi'
        });
      }

      if (!['wajib', 'pilihan_infrastruktur', 'pilihan_non_infrastruktur'].includes(jenis_kegiatan)) {
        cleanupUploadedFile(req);
        return res.status(400).json({
          success: false,
          message: 'Kategori kegiatan tidak valid (wajib / pilihan_infrastruktur / pilihan_non_infrastruktur)'
        });
      }

      // Validasi anggaran
      let anggaranNum = null;
      if (anggaran_usulan) {
        anggaranNum = parseInt(String(anggaran_usulan).replace(/\D/g, ''), 10);
        if (anggaranNum > MAX_ANGGARAN) {
          cleanupUploadedFile(req);
          return res.status(400).json({
            success: false,
            message: `Anggaran usulan tidak boleh lebih dari Rp 1.500.000.000 (1,5 Miliar). Nilai yang diinput: Rp ${anggaranNum.toLocaleString('id-ID')}`
          });
        }
      }

      if (!req.file) {
        return res.status(400).json({
          success: false,
          message: 'File proposal wajib diupload'
        });
      }

      // Get desa_id + kecamatan_id
      const [users] = await sequelize.query(`
        SELECT u.desa_id, d.kecamatan_id
        FROM users u
        JOIN desas d ON u.desa_id = d.id
        WHERE u.id = ?
      `, { replacements: [userId] });

      if (!users || users.length === 0 || !users[0].desa_id) {
        cleanupUploadedFile(req);
        return res.status(403).json({
          success: false,
          message: 'User tidak terkait dengan desa'
        });
      }

      const desaId = users[0].desa_id;
      const kecamatanId = users[0].kecamatan_id;
      const tahunAnggaranValue = tahun_anggaran ? parseInt(tahun_anggaran) : new Date().getFullYear();

      // Cek submission open
      const { isOpen } = await checkSubmissionOpen(tahunAnggaranValue);
      if (!isOpen) {
        cleanupUploadedFile(req);
        return res.status(403).json({
          success: false,
          message: 'Pengajuan Bankeu Perubahan saat ini ditutup oleh DPMD.'
        });
      }

      // Ambil nama kegiatan utama dari master kegiatan perubahan (display)
      const [kegiatanInfo] = await sequelize.query(`
        SELECT nama_kegiatan, kategori FROM bankeu_perubahan_master_kegiatan WHERE id = ?
      `, { replacements: [kegiatanIdsArray[0]] });
      if (!kegiatanInfo.length) {
        cleanupUploadedFile(req);
        return res.status(400).json({
          success: false,
          message: 'Kegiatan tidak ditemukan di master Bankeu Perubahan'
        });
      }
      const kegiatanNama = kegiatanInfo[0].nama_kegiatan;

      // Validasi: jenis_kegiatan (input form) HARUS sama dengan kategori kegiatan
      if (kegiatanInfo[0].kategori !== jenis_kegiatan) {
        cleanupUploadedFile(req);
        return res.status(400).json({
          success: false,
          message: `Kegiatan yang dipilih bukan kategori ${jenis_kegiatan}`
        });
      }

      const filePath = req.file.filename;
      const fileSize = req.file.size;

      // Insert proposal + pivot kegiatan dalam transaksi
      const transaction = await sequelize.transaction();
      try {
        const [insertResult] = await sequelize.query(`
          INSERT INTO bankeu_perubahan_proposals (
            desa_id, kecamatan_id, tahun_anggaran,
            jenis_kegiatan, kegiatan_id, kegiatan_nama,
            nama_kegiatan_spesifik, volume, lokasi,
            judul_proposal, deskripsi, file_proposal, file_size,
            anggaran_usulan, status, kecamatan_status, dpmd_status,
            created_by
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', 'pending', 'pending', ?)
        `, {
          replacements: [
            desaId, kecamatanId, tahunAnggaranValue,
            jenis_kegiatan, kegiatanIdsArray[0], kegiatanNama,
            nama_kegiatan_spesifik || null, volume || null, lokasi || null,
            judul_proposal, deskripsi || null, filePath, fileSize,
            anggaranNum, userId
          ],
          transaction
        });

        // Sequelize INSERT returns insertId as first element (number)
        // or as insertResult.insertId depending on driver - handle both
        const proposalId = typeof insertResult === 'number' ? insertResult : (insertResult?.insertId || insertResult);

        // Insert pivot kegiatan
        for (const kegId of kegiatanIdsArray) {
          await sequelize.query(`
            INSERT IGNORE INTO bankeu_perubahan_proposal_kegiatan (proposal_id, kegiatan_id)
            VALUES (?, ?)
          `, { replacements: [proposalId, kegId], transaction });
        }

        await transaction.commit();

        // Catat sebagai versi dokumen pertama (initial)
        try {
          await recordProposalVersion({ proposalId, fileName: filePath, fileSize, source: 'initial', userId });
        } catch (verErr) {
          logger.error('[BankeuPerubahan] Gagal mencatat versi awal proposal:', verErr);
        }

        logger.info(`[BankeuPerubahan] Proposal created: ${proposalId} by user ${userId} (desa ${desaId})`);

        // Activity Log
        ActivityLogger.log({
          userId,
          userName: req.user.name || `User ${userId}`,
          userRole: req.user.role,
          bidangId: 3,
          module: MODULE_NAME,
          action: 'create',
          entityType: 'bankeu_perubahan_proposal',
          entityId: proposalId,
          entityName: judul_proposal,
          description: `${req.user.name || 'User'} mengupload proposal Bankeu Perubahan: "${judul_proposal}" (Tahun: ${tahunAnggaranValue})`,
          newValue: { judul_proposal, anggaran_usulan: anggaranNum, tahun_anggaran: tahunAnggaranValue, kegiatan_ids: kegiatanIdsArray },
          ipAddress: ActivityLogger.getIpFromRequest(req),
          userAgent: ActivityLogger.getUserAgentFromRequest(req)
        });

        res.status(201).json({
          success: true,
          message: 'Proposal Bankeu Perubahan berhasil diupload',
          data: { id: proposalId }
        });
      } catch (txError) {
        await transaction.rollback();
        throw txError;
      }
    } catch (error) {
      cleanupUploadedFile(req);
      logger.error('[BankeuPerubahan] Error uploading proposal:', error);
      res.status(500).json({
        success: false,
        message: 'Gagal mengupload proposal perubahan',
        error: error.message
      });
    }
  }

  /**
   * Update proposal (revision - field-level edit)
   * PATCH /api/desa/bankeu-perubahan/proposals/:id
   */
  async updateProposal(req, res) {
    try {
      const { id } = req.params;
      const userId = req.user.id;
      const { anggaran_usulan, nama_kegiatan_spesifik, volume, lokasi, deskripsi } = req.body;

      const [users] = await sequelize.query(`
        SELECT desa_id FROM users WHERE id = ?
      `, { replacements: [userId] });

      if (!users || users.length === 0 || !users[0].desa_id) {
        cleanupUploadedFile(req);
        return res.status(403).json({ success: false, message: 'User tidak terkait dengan desa' });
      }

      const desaId = users[0].desa_id;

      const [proposals] = await sequelize.query(`
        SELECT id, file_proposal, status, desa_id, submitted_to_kecamatan,
               kecamatan_status, dpmd_status
        FROM bankeu_perubahan_proposals
        WHERE id = ?
      `, { replacements: [id] });

      if (!proposals || proposals.length === 0) {
        cleanupUploadedFile(req);
        return res.status(404).json({ success: false, message: 'Proposal tidak ditemukan' });
      }

      const proposal = proposals[0];
      if (Number(proposal.desa_id) !== Number(desaId)) {
        cleanupUploadedFile(req);
        return res.status(403).json({ success: false, message: 'Akses ditolak' });
      }

      // Boleh update bila:
      // - belum submit ke kecamatan, ATAU
      // - kecamatan_status = revision/rejected (dikembalikan), ATAU
      // - dpmd_status = revision/rejected (dikembalikan dari DPMD)
      const allowUpdate =
        !proposal.submitted_to_kecamatan ||
        ['revision', 'rejected'].includes(proposal.kecamatan_status) ||
        ['revision', 'rejected'].includes(proposal.dpmd_status);

      if (!allowUpdate) {
        cleanupUploadedFile(req);
        return res.status(400).json({
          success: false,
          message: 'Proposal tidak dapat diupdate pada status saat ini'
        });
      }

      // Parse anggaran
      let anggaranNum = null;
      if (anggaran_usulan !== undefined && anggaran_usulan !== null && anggaran_usulan !== '') {
        anggaranNum = parseInt(String(anggaran_usulan).replace(/\D/g, ''), 10);
        if (anggaranNum > MAX_ANGGARAN) {
          cleanupUploadedFile(req);
          return res.status(400).json({
            success: false,
            message: `Anggaran usulan tidak boleh lebih dari Rp 1.500.000.000`
          });
        }
      }

      // Optional: replace file (NON-DESTRUKTIF — file lama disimpan sebagai versi)
      let newFilePath = null;
      let newFileSize = null;
      if (req.file) {
        newFilePath = req.file.filename;
        newFileSize = req.file.size;
      }

      // Build update fields
      const fields = [];
      const replacements = [];
      if (anggaranNum !== null) { fields.push('anggaran_usulan = ?'); replacements.push(anggaranNum); }
      if (nama_kegiatan_spesifik !== undefined) { fields.push('nama_kegiatan_spesifik = ?'); replacements.push(nama_kegiatan_spesifik); }
      if (volume !== undefined) { fields.push('volume = ?'); replacements.push(volume); }
      if (lokasi !== undefined) { fields.push('lokasi = ?'); replacements.push(lokasi); }
      if (deskripsi !== undefined) { fields.push('deskripsi = ?'); replacements.push(deskripsi); }
      if (newFilePath) {
        fields.push('file_proposal = ?'); replacements.push(newFilePath);
        fields.push('file_size = ?'); replacements.push(newFileSize);
      }
      // Reset status untuk re-submission jika sebelumnya revision/rejected
      if (['revision', 'rejected'].includes(proposal.kecamatan_status)) {
        fields.push("kecamatan_status = 'pending'");
        fields.push("kecamatan_catatan = NULL");
      }
      if (['revision', 'rejected'].includes(proposal.dpmd_status)) {
        fields.push("dpmd_status = 'pending'");
        fields.push("dpmd_catatan = NULL");
      }

      if (fields.length === 0) {
        return res.status(400).json({ success: false, message: 'Tidak ada field yang diupdate' });
      }

      replacements.push(id);
      await sequelize.query(`
        UPDATE bankeu_perubahan_proposals
        SET ${fields.join(', ')}, updated_at = NOW()
        WHERE id = ?
      `, { replacements });

      // Jika file diganti, catat sebagai versi baru (revisi)
      if (newFilePath) {
        try {
          await recordProposalVersion({ proposalId: id, fileName: newFilePath, fileSize: newFileSize, source: 'revision', userId });
        } catch (verErr) {
          logger.error('[BankeuPerubahan] Gagal mencatat versi (updateProposal):', verErr);
        }
      }

      ActivityLogger.log({
        userId,
        userName: req.user.name || `User ${userId}`,
        userRole: req.user.role,
        bidangId: 3,
        module: MODULE_NAME,
        action: 'update',
        entityType: 'bankeu_perubahan_proposal',
        entityId: parseInt(id),
        description: `${req.user.name || 'User'} mengupdate proposal perubahan #${id}`,
        newValue: { anggaran_usulan: anggaranNum, nama_kegiatan_spesifik, volume, lokasi },
        ipAddress: ActivityLogger.getIpFromRequest(req),
        userAgent: ActivityLogger.getUserAgentFromRequest(req)
      });

      res.json({ success: true, message: 'Proposal berhasil diupdate' });
    } catch (error) {
      cleanupUploadedFile(req);
      logger.error('[BankeuPerubahan] Error updating proposal:', error);
      res.status(500).json({ success: false, message: 'Gagal update proposal', error: error.message });
    }
  }

  /**
   * Edit full proposal (sebelum submit ke kecamatan)
   * PUT /api/desa/bankeu-perubahan/proposals/:id/edit
   */
  async editProposal(req, res) {
    try {
      const { id } = req.params;
      const userId = req.user.id;
      const {
        kegiatan_ids, jenis_kegiatan, judul_proposal,
        nama_kegiatan_spesifik, volume, lokasi, deskripsi, anggaran_usulan
      } = req.body;

      const [users] = await sequelize.query(`SELECT desa_id FROM users WHERE id = ?`, { replacements: [userId] });
      if (!users[0]?.desa_id) {
        cleanupUploadedFile(req);
        return res.status(403).json({ success: false, message: 'User tidak terkait dengan desa' });
      }
      const desaId = users[0].desa_id;

      const [proposals] = await sequelize.query(`
        SELECT id, file_proposal, status, desa_id, submitted_to_kecamatan
        FROM bankeu_perubahan_proposals
        WHERE id = ?
      `, { replacements: [id] });

      if (!proposals.length) {
        cleanupUploadedFile(req);
        return res.status(404).json({ success: false, message: 'Proposal tidak ditemukan' });
      }

      const proposal = proposals[0];
      if (Number(proposal.desa_id) !== Number(desaId)) {
        cleanupUploadedFile(req);
        return res.status(403).json({ success: false, message: 'Akses ditolak' });
      }

      if (proposal.submitted_to_kecamatan) {
        cleanupUploadedFile(req);
        return res.status(400).json({
          success: false,
          message: 'Proposal sudah dikirim ke kecamatan, tidak dapat di-edit penuh'
        });
      }

      // Parse kegiatan_ids
      let kegiatanIdsArray = [];
      if (typeof kegiatan_ids === 'string') {
        try { kegiatanIdsArray = JSON.parse(kegiatan_ids); } catch (e) {
          cleanupUploadedFile(req);
          return res.status(400).json({ success: false, message: 'Format kegiatan_ids tidak valid' });
        }
      } else if (Array.isArray(kegiatan_ids)) {
        kegiatanIdsArray = kegiatan_ids;
      }
      kegiatanIdsArray = kegiatanIdsArray.map(n => parseInt(n)).filter(n => !isNaN(n));

      if (!kegiatanIdsArray.length || !judul_proposal || !jenis_kegiatan) {
        cleanupUploadedFile(req);
        return res.status(400).json({
          success: false,
          message: 'Kegiatan, jenis kegiatan, dan judul proposal wajib diisi'
        });
      }

      let anggaranNum = null;
      if (anggaran_usulan) {
        anggaranNum = parseInt(String(anggaran_usulan).replace(/\D/g, ''), 10);
        if (anggaranNum > MAX_ANGGARAN) {
          cleanupUploadedFile(req);
          return res.status(400).json({
            success: false,
            message: `Anggaran usulan tidak boleh lebih dari Rp 1.500.000.000`
          });
        }
      }

      // Optional new file (NON-DESTRUKTIF — file lama disimpan sebagai versi)
      let filePath = proposal.file_proposal;
      let fileSize = null;
      if (req.file) {
        filePath = req.file.filename;
        fileSize = req.file.size;
      }

      const [kegiatanInfo] = await sequelize.query(`
        SELECT nama_kegiatan, kategori FROM bankeu_perubahan_master_kegiatan WHERE id = ?
      `, { replacements: [kegiatanIdsArray[0]] });
      if (!kegiatanInfo.length) {
        cleanupUploadedFile(req);
        return res.status(400).json({ success: false, message: 'Kegiatan tidak ditemukan' });
      }
      const kegiatanNama = kegiatanInfo[0].nama_kegiatan;

      // Validasi kategori match
      if (kegiatanInfo[0].kategori !== jenis_kegiatan) {
        cleanupUploadedFile(req);
        return res.status(400).json({
          success: false,
          message: `Kegiatan yang dipilih bukan kategori ${jenis_kegiatan}`
        });
      }

      const transaction = await sequelize.transaction();
      try {
        const updateFields = [
          'jenis_kegiatan = ?', 'kegiatan_id = ?', 'kegiatan_nama = ?',
          'judul_proposal = ?', 'nama_kegiatan_spesifik = ?', 'volume = ?',
          'lokasi = ?', 'deskripsi = ?', 'anggaran_usulan = ?',
          'file_proposal = ?'
        ];
        const updateValues = [
          jenis_kegiatan, kegiatanIdsArray[0], kegiatanNama,
          judul_proposal, nama_kegiatan_spesifik || null, volume || null,
          lokasi || null, deskripsi || null, anggaranNum,
          filePath
        ];
        if (fileSize !== null) {
          updateFields.push('file_size = ?');
          updateValues.push(fileSize);
        }
        updateValues.push(id);

        await sequelize.query(`
          UPDATE bankeu_perubahan_proposals
          SET ${updateFields.join(', ')}, updated_at = NOW()
          WHERE id = ?
        `, { replacements: updateValues, transaction });

        // Reset pivot kegiatan
        await sequelize.query(`
          DELETE FROM bankeu_perubahan_proposal_kegiatan WHERE proposal_id = ?
        `, { replacements: [id], transaction });
        for (const kegId of kegiatanIdsArray) {
          await sequelize.query(`
            INSERT INTO bankeu_perubahan_proposal_kegiatan (proposal_id, kegiatan_id)
            VALUES (?, ?)
          `, { replacements: [id, kegId], transaction });
        }

        await transaction.commit();
      } catch (txError) {
        await transaction.rollback();
        throw txError;
      }

      // Jika file diganti saat edit penuh, catat versi baru
      if (req.file) {
        try {
          await recordProposalVersion({ proposalId: id, fileName: filePath, fileSize, source: 'revision', userId });
        } catch (verErr) {
          logger.error('[BankeuPerubahan] Gagal mencatat versi (editProposal):', verErr);
        }
      }

      ActivityLogger.log({
        userId,
        userName: req.user.name || `User ${userId}`,
        userRole: req.user.role,
        bidangId: 3,
        module: MODULE_NAME,
        action: 'update',
        entityType: 'bankeu_perubahan_proposal',
        entityId: parseInt(id),
        entityName: judul_proposal,
        description: `${req.user.name || 'User'} mengedit penuh proposal perubahan #${id}`,
        ipAddress: ActivityLogger.getIpFromRequest(req),
        userAgent: ActivityLogger.getUserAgentFromRequest(req)
      });

      res.json({ success: true, message: 'Proposal berhasil diedit' });
    } catch (error) {
      cleanupUploadedFile(req);
      logger.error('[BankeuPerubahan] Error editing proposal:', error);
      res.status(500).json({ success: false, message: 'Gagal mengedit proposal', error: error.message });
    }
  }

  /**
   * Replace file proposal
   * PATCH /api/desa/bankeu-perubahan/proposals/:id/replace-file
   */
  async replaceFile(req, res) {
    try {
      const { id } = req.params;
      const userId = req.user.id;

      if (!req.file) {
        return res.status(400).json({ success: false, message: 'File wajib diupload' });
      }

      const [users] = await sequelize.query(`SELECT desa_id FROM users WHERE id = ?`, { replacements: [userId] });
      if (!users[0]?.desa_id) {
        cleanupUploadedFile(req);
        return res.status(403).json({ success: false, message: 'User tidak terkait dengan desa' });
      }

      const [proposals] = await sequelize.query(`
        SELECT id, file_proposal, desa_id, submitted_to_kecamatan, kecamatan_status, dpmd_status
        FROM bankeu_perubahan_proposals WHERE id = ?
      `, { replacements: [id] });

      if (!proposals.length) {
        cleanupUploadedFile(req);
        return res.status(404).json({ success: false, message: 'Proposal tidak ditemukan' });
      }

      const proposal = proposals[0];
      if (Number(proposal.desa_id) !== Number(users[0].desa_id)) {
        cleanupUploadedFile(req);
        return res.status(403).json({ success: false, message: 'Akses ditolak' });
      }

      // Allow replace if not yet submitted OR returned to desa
      const allowReplace =
        !proposal.submitted_to_kecamatan ||
        ['revision', 'rejected'].includes(proposal.kecamatan_status) ||
        ['revision', 'rejected'].includes(proposal.dpmd_status);

      if (!allowReplace) {
        cleanupUploadedFile(req);
        return res.status(400).json({
          success: false,
          message: 'File tidak dapat diganti pada status saat ini'
        });
      }

      // NON-DESTRUKTIF: file lama TIDAK dihapus, disimpan sebagai versi sebelumnya

      await sequelize.query(`
        UPDATE bankeu_perubahan_proposals
        SET file_proposal = ?, file_size = ?, updated_at = NOW()
        WHERE id = ?
      `, { replacements: [req.file.filename, req.file.size, id] });

      // Catat file baru sebagai versi (revisi)
      try {
        await recordProposalVersion({ proposalId: id, fileName: req.file.filename, fileSize: req.file.size, source: 'revision', userId });
      } catch (verErr) {
        logger.error('[BankeuPerubahan] Gagal mencatat versi (replaceFile):', verErr);
      }

      ActivityLogger.log({
        userId,
        userName: req.user.name || `User ${userId}`,
        userRole: req.user.role,
        bidangId: 3,
        module: MODULE_NAME,
        action: 'upload',
        entityType: 'bankeu_perubahan_proposal',
        entityId: parseInt(id),
        description: `${req.user.name || 'User'} mengganti file proposal perubahan #${id}`,
        ipAddress: ActivityLogger.getIpFromRequest(req),
        userAgent: ActivityLogger.getUserAgentFromRequest(req)
      });

      res.json({ success: true, message: 'File berhasil diganti', data: { file_proposal: req.file.filename } });
    } catch (error) {
      cleanupUploadedFile(req);
      logger.error('[BankeuPerubahan] Error replacing file:', error);
      res.status(500).json({ success: false, message: 'Gagal mengganti file', error: error.message });
    }
  }

  /**
   * Submit semua proposal ke Kecamatan (3-level flow: Desa -> Kecamatan -> DPMD)
   * POST /api/desa/bankeu-perubahan/submit-to-kecamatan
   */
  async submitToKecamatan(req, res) {
    const transaction = await sequelize.transaction();
    try {
      const userId = req.user.id;
      const { tahun, proposal_ids } = req.body;

      logger.info(`[BankeuPerubahan] SUBMIT TO KECAMATAN - User: ${userId}, Tahun: ${tahun || 'ALL'}`);

      const { isOpen } = await checkSubmissionOpen(tahun);
      if (!isOpen) {
        await transaction.rollback();
        return res.status(403).json({
          success: false,
          message: 'Pengajuan Bankeu Perubahan saat ini ditutup oleh DPMD.'
        });
      }

      const [users] = await sequelize.query(`SELECT desa_id FROM users WHERE id = ?`, { replacements: [userId] });
      if (!users[0]?.desa_id) {
        await transaction.rollback();
        return res.status(403).json({ success: false, message: 'User tidak terkait dengan desa' });
      }
      const desaId = users[0].desa_id;

      // Filter
      const filters = ['desa_id = ?', 'submitted_to_kecamatan = FALSE'];
      const replacements = [desaId];
      if (tahun) { filters.push('tahun_anggaran = ?'); replacements.push(parseInt(tahun)); }
      if (Array.isArray(proposal_ids) && proposal_ids.length) {
        filters.push(`id IN (${proposal_ids.map(() => '?').join(',')})`);
        replacements.push(...proposal_ids.map(id => parseInt(id)));
      }

      // Count first
      const [cntRows] = await sequelize.query(`
        SELECT COUNT(*) AS total FROM bankeu_perubahan_proposals
        WHERE ${filters.join(' AND ')}
      `, { replacements });
      const count = Number(cntRows[0].total);

      if (count < 1) {
        await transaction.rollback();
        return res.status(400).json({
          success: false,
          message: 'Tidak ada proposal perubahan yang perlu dikirim ke kecamatan'
        });
      }

      // Update
      await sequelize.query(`
        UPDATE bankeu_perubahan_proposals
        SET submitted_to_kecamatan = TRUE,
            submitted_at = NOW(),
            kecamatan_status = 'pending',
            status = 'pending'
        WHERE ${filters.join(' AND ')}
      `, { replacements, transaction });

      await transaction.commit();

      logger.info(`[BankeuPerubahan] ${count} proposal dari desa ${desaId} submitted to KECAMATAN`);

      ActivityLogger.log({
        userId,
        userName: req.user.name || `User ${userId}`,
        userRole: req.user.role,
        bidangId: 3,
        module: MODULE_NAME,
        action: 'submit',
        entityType: 'bankeu_perubahan_proposal',
        entityName: `${count} proposal desa ${desaId}`,
        description: `${req.user.name || 'User'} mengirim ${count} proposal perubahan ke Kecamatan (Tahun: ${tahun || 'ALL'})`,
        newValue: { count, desa_id: desaId, tahun: tahun || 'ALL', destination: 'kecamatan' },
        ipAddress: ActivityLogger.getIpFromRequest(req),
        userAgent: ActivityLogger.getUserAgentFromRequest(req)
      });

      res.json({
        success: true,
        message: `${count} proposal perubahan berhasil dikirim ke Kecamatan`
      });
    } catch (error) {
      try { await transaction.rollback(); } catch (e) {}
      logger.error('[BankeuPerubahan] Error submit to kecamatan:', error);
      res.status(500).json({
        success: false,
        message: 'Gagal mengirim proposal ke kecamatan',
        error: error.message
      });
    }
  }

  /**
   * Resubmit setelah revision dari Kecamatan/DPMD
   * POST /api/desa/bankeu-perubahan/resubmit
   */
  async resubmitProposal(req, res) {
    const transaction = await sequelize.transaction();
    try {
      const userId = req.user.id;
      const { tahun, proposal_ids } = req.body;

      const [users] = await sequelize.query(`SELECT desa_id FROM users WHERE id = ?`, { replacements: [userId] });
      if (!users[0]?.desa_id) {
        await transaction.rollback();
        return res.status(403).json({ success: false, message: 'User tidak terkait dengan desa' });
      }
      const desaId = users[0].desa_id;

      // Eligible: kecamatan_status revision/rejected OR dpmd_status revision/rejected
      const filters = [
        'desa_id = ?',
        '(kecamatan_status IN ("revision","rejected") OR dpmd_status IN ("revision","rejected"))'
      ];
      const replacements = [desaId];
      if (tahun) { filters.push('tahun_anggaran = ?'); replacements.push(parseInt(tahun)); }
      if (Array.isArray(proposal_ids) && proposal_ids.length) {
        filters.push(`id IN (${proposal_ids.map(() => '?').join(',')})`);
        replacements.push(...proposal_ids.map(id => parseInt(id)));
      }

      const [cntRows] = await sequelize.query(`
        SELECT COUNT(*) AS total FROM bankeu_perubahan_proposals
        WHERE ${filters.join(' AND ')}
      `, { replacements });
      const count = Number(cntRows[0].total);

      if (count < 1) {
        await transaction.rollback();
        return res.status(400).json({
          success: false,
          message: 'Tidak ada proposal revisi yang dapat dikirim ulang'
        });
      }

      // Reset status & re-submit ke kecamatan (skip dinas - flow perubahan)
      await sequelize.query(`
        UPDATE bankeu_perubahan_proposals
        SET kecamatan_status = 'pending',
            dpmd_status = 'pending',
            kecamatan_catatan = NULL,
            dpmd_catatan = NULL,
            submitted_to_kecamatan = TRUE,
            submitted_at = NOW(),
            submitted_to_dpmd = FALSE,
            submitted_to_dpmd_at = NULL,
            status = 'pending'
        WHERE ${filters.join(' AND ')}
      `, { replacements, transaction });

      await transaction.commit();

      ActivityLogger.log({
        userId,
        userName: req.user.name || `User ${userId}`,
        userRole: req.user.role,
        bidangId: 3,
        module: MODULE_NAME,
        action: 'submit',
        entityType: 'bankeu_perubahan_proposal',
        entityName: `${count} proposal desa ${desaId}`,
        description: `${req.user.name || 'User'} mengirim ulang ${count} proposal perubahan setelah revisi`,
        newValue: { count, desa_id: desaId, tahun: tahun || 'ALL' },
        ipAddress: ActivityLogger.getIpFromRequest(req),
        userAgent: ActivityLogger.getUserAgentFromRequest(req)
      });

      res.json({
        success: true,
        message: `${count} proposal perubahan berhasil dikirim ulang ke Kecamatan`
      });
    } catch (error) {
      try { await transaction.rollback(); } catch (e) {}
      logger.error('[BankeuPerubahan] Error resubmit:', error);
      res.status(500).json({ success: false, message: 'Gagal mengirim ulang proposal', error: error.message });
    }
  }

  /**
   * Delete proposal (hanya jika belum disubmit)
   * DELETE /api/desa/bankeu-perubahan/proposals/:id
   */
  async deleteProposal(req, res) {
    try {
      const { id } = req.params;
      const userId = req.user.id;

      const [users] = await sequelize.query(`SELECT desa_id FROM users WHERE id = ?`, { replacements: [userId] });
      if (!users[0]?.desa_id) {
        return res.status(403).json({ success: false, message: 'User tidak terkait dengan desa' });
      }

      const [proposals] = await sequelize.query(`
        SELECT id, file_proposal, desa_id, submitted_to_kecamatan
        FROM bankeu_perubahan_proposals WHERE id = ?
      `, { replacements: [id] });

      if (!proposals.length) {
        return res.status(404).json({ success: false, message: 'Proposal tidak ditemukan' });
      }

      const proposal = proposals[0];
      if (Number(proposal.desa_id) !== Number(users[0].desa_id)) {
        return res.status(403).json({ success: false, message: 'Akses ditolak' });
      }
      if (proposal.submitted_to_kecamatan) {
        return res.status(400).json({
          success: false,
          message: 'Proposal sudah dikirim, tidak dapat dihapus'
        });
      }

      // Delete file
      if (proposal.file_proposal) {
        const filePath = path.join(__dirname, '../../storage/uploads/bankeu-perubahan', proposal.file_proposal);
        if (fs.existsSync(filePath)) {
          try { fs.unlinkSync(filePath); } catch (e) {}
        }
      }

      await sequelize.query(`DELETE FROM bankeu_perubahan_proposals WHERE id = ?`, { replacements: [id] });

      ActivityLogger.log({
        userId,
        userName: req.user.name || `User ${userId}`,
        userRole: req.user.role,
        bidangId: 3,
        module: MODULE_NAME,
        action: 'delete',
        entityType: 'bankeu_perubahan_proposal',
        entityId: parseInt(id),
        description: `${req.user.name || 'User'} menghapus proposal perubahan #${id}`,
        ipAddress: ActivityLogger.getIpFromRequest(req),
        userAgent: ActivityLogger.getUserAgentFromRequest(req)
      });

      res.json({ success: true, message: 'Proposal berhasil dihapus' });
    } catch (error) {
      logger.error('[BankeuPerubahan] Error delete:', error);
      res.status(500).json({ success: false, message: 'Gagal menghapus proposal', error: error.message });
    }
  }

  /**
   * Riwayat versi dokumen (Desa).
   * GET /api/desa/bankeu-perubahan/proposals/:id/versions
   */
  async getProposalVersions(req, res) {
    try {
      const proposalId = await assertDesaProposal(req, res);
      if (!proposalId) return;
      res.json({ success: true, data: await fetchVersions(proposalId) });
    } catch (error) {
      logger.error('[BankeuPerubahan] Error getProposalVersions:', error);
      res.status(500).json({ success: false, message: 'Gagal mengambil versi dokumen', error: error.message });
    }
  }

  /**
   * Riwayat ronde revisi/anotasi (Desa) — untuk melihat coretan Kecamatan.
   * GET /api/desa/bankeu-perubahan/proposals/:id/revisions
   */
  async getProposalRevisions(req, res) {
    try {
      const proposalId = await assertDesaProposal(req, res);
      if (!proposalId) return;
      res.json({ success: true, data: await fetchRevisions(proposalId) });
    } catch (error) {
      logger.error('[BankeuPerubahan] Error getProposalRevisions:', error);
      res.status(500).json({ success: false, message: 'Gagal mengambil riwayat revisi', error: error.message });
    }
  }
}

module.exports = new BankeuPerubahanProposalController();
