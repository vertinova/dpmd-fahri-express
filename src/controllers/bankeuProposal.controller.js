const prisma = require('../config/prisma');
const sequelize = require('../config/database');
const logger = require('../utils/logger');
const ActivityLogger = require('../utils/activityLogger');
const { copyFileToReference } = require('../utils/fileHelper');
const path = require('path');
const fs = require('fs'); 

// Batas maksimal anggaran per proposal (1.5 Miliar)
const MAX_ANGGARAN = 1_500_000_000;

/**
 * Helper: Check if bankeu submission is open for desa
 * @returns {Promise<{isOpen: boolean, setting: object|null}>}
 */
async function checkSubmissionOpen() {
  try {
    const setting = await prisma.app_settings.findUnique({
      where: { setting_key: 'bankeu_submission_desa' }
    });
    
    if (!setting) {
      // Default: open
      return { isOpen: true, setting: null };
    }
    
    const isOpen = setting.setting_value === 'true';
    return { isOpen, setting };
  } catch (error) {
    logger.error('Error checking submission setting:', error);
    // Default: open on error
    return { isOpen: true, setting: null };
  }
}

class BankeuProposalController {
  /**
   * Get master kegiatan list
   * GET /api/desa/bankeu/master-kegiatan
   */
  async getMasterKegiatan(req, res) {
    try {
      const [kegiatan] = await sequelize.query(`
        SELECT 
          id,
          jenis_kegiatan,
          urutan,
          nama_kegiatan,
          is_active
        FROM bankeu_master_kegiatan
        WHERE is_active = TRUE
        ORDER BY jenis_kegiatan, urutan
      `);

      // Group by jenis_kegiatan
      const grouped = {
        infrastruktur: [],
        non_infrastruktur: []
      };

      kegiatan.forEach(item => {
        grouped[item.jenis_kegiatan].push({
          id: item.id,
          jenis_kegiatan: item.jenis_kegiatan,
          urutan: item.urutan,
          nama_kegiatan: item.nama_kegiatan
        });
      });

      res.json({
        success: true,
        data: grouped
      });
    } catch (error) {
      logger.error('Error fetching master kegiatan:', error);
      res.status(500).json({
        success: false,
        message: 'Gagal mengambil data master kegiatan',
        error: error.message
      });
    }
  }

  /**
   * Get all proposals for logged-in desa
   * GET /api/desa/bankeu/proposals
   */
  async getProposalsByDesa(req, res) {
    try {
      const userId = req.user.id;
      const { tahun } = req.query;

      // Get desa_id from user
      const user = await prisma.users.findUnique({
        where: { id: BigInt(userId) },
        select: { desa_id: true }
      });

      if (!user || !user.desa_id) {
        return res.status(403).json({
          success: false,
          message: 'User tidak terkait dengan desa'
        });
      }

      const desaId = user.desa_id;

      // Build where clause
      const where = { desa_id: desaId };
      if (tahun) {
        where.tahun_anggaran = parseInt(tahun);
      }

      const proposals = await prisma.bankeu_proposals.findMany({
        where,
        include: {
          users_bankeu_proposals_verified_byTousers: {
            select: { id: true, name: true }
          },
          users_bankeu_proposals_dpmd_verified_byTousers: {
            select: { id: true, name: true }
          },
          users_bankeu_proposals_kecamatan_verified_byTousers: {
            select: { id: true, name: true }
          },
          users_bankeu_proposals_troubleshoot_byTousers: {
            select: { id: true, name: true }
          },
          desas: {
            select: {
              nama: true,
              kecamatan_id: true,
              kecamatans: {
                select: { nama: true }
              }
            }
          },
          bankeu_proposal_kegiatan: {
            include: {
              bankeu_master_kegiatan: {
                select: {
                  id: true,
                  jenis_kegiatan: true,
                  nama_kegiatan: true,
                  urutan: true
                }
              }
            }
          }
        },
        orderBy: { created_at: 'desc' }
      });

      // Also get dinas_verified_by name (separate query since it's an Int FK, not BigInt relation)
      const dinasVerifierIds = [...new Set(proposals.map(p => p.dinas_verified_by).filter(Boolean))];
      const dinasVerifiers = dinasVerifierIds.length > 0 
        ? await prisma.users.findMany({
            where: { id: { in: dinasVerifierIds.map(id => BigInt(id)) } },
            select: { id: true, name: true }
          })
        : [];
      const dinasVerifierMap = Object.fromEntries(dinasVerifiers.map(u => [Number(u.id), u.name]));

      // Transform to flat format matching frontend expectations
      const data = proposals.map(p => ({
        id: Number(p.id),
        kegiatan_id: p.kegiatan_id ? Number(p.kegiatan_id) : null,
        tahun_anggaran: p.tahun_anggaran,
        judul_proposal: p.judul_proposal,
        nama_kegiatan_spesifik: p.nama_kegiatan_spesifik,
        volume: p.volume,
        lokasi: p.lokasi,
        deskripsi: p.deskripsi,
        file_proposal: p.file_proposal,
        surat_pengantar: p.surat_pengantar,
        surat_permohonan: p.surat_permohonan,
        file_size: p.file_size,
        anggaran_usulan: p.anggaran_usulan ? Number(p.anggaran_usulan) : null,
        status: p.status,
        submitted_to_kecamatan: p.submitted_to_kecamatan,
        submitted_at: p.submitted_at,
        submitted_to_dinas_at: p.submitted_to_dinas_at,
        submitted_to_dpmd: p.submitted_to_dpmd,
        submitted_to_dpmd_at: p.submitted_to_dpmd_at,
        dinas_status: p.dinas_status,
        dinas_catatan: p.dinas_catatan,
        dinas_verified_at: p.dinas_verified_at,
        kecamatan_status: p.kecamatan_status,
        kecamatan_catatan: p.kecamatan_catatan,
        kecamatan_verified_at: p.kecamatan_verified_at,
        dpmd_status: p.dpmd_status,
        dpmd_catatan: p.dpmd_catatan,
        dpmd_verified_at: p.dpmd_verified_at,
        catatan_verifikasi: p.catatan_verifikasi,
        verified_at: p.verified_at,
        berita_acara_path: p.berita_acara_path,
        berita_acara_generated_at: p.berita_acara_generated_at,
        troubleshoot_catatan: p.troubleshoot_catatan,
        troubleshoot_by: p.troubleshoot_by ? Number(p.troubleshoot_by) : null,
        troubleshoot_at: p.troubleshoot_at,
        created_at: p.created_at,
        updated_at: p.updated_at,
        // Flattened relation names
        verified_by_name: p.users_bankeu_proposals_verified_byTousers?.name || null,
        dinas_verified_by_name: dinasVerifierMap[p.dinas_verified_by] || null,
        kecamatan_verified_by_name: p.users_bankeu_proposals_kecamatan_verified_byTousers?.name || null,
        dpmd_verified_by_name: p.users_bankeu_proposals_dpmd_verified_byTousers?.name || null,
        troubleshoot_by_name: p.users_bankeu_proposals_troubleshoot_byTousers?.name || null,
        desa_nama: p.desas?.nama || null,
        kecamatan_id: p.desas?.kecamatan_id ? Number(p.desas.kecamatan_id) : null,
        kecamatan_nama: p.desas?.kecamatans?.nama || null,
        // Flatten kegiatan list
        kegiatan_list: p.bankeu_proposal_kegiatan
          .sort((a, b) => (a.bankeu_master_kegiatan?.urutan || 0) - (b.bankeu_master_kegiatan?.urutan || 0))
          .map(bpk => ({
          id: bpk.bankeu_master_kegiatan ? Number(bpk.bankeu_master_kegiatan.id) : null,
          jenis_kegiatan: bpk.bankeu_master_kegiatan?.jenis_kegiatan || null,
          nama_kegiatan: bpk.bankeu_master_kegiatan?.nama_kegiatan || null
        }))
      }));

      res.json({
        success: true,
        data
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
   * Upload new proposal
   * POST /api/desa/bankeu/proposals
   */
  async uploadProposal(req, res) {
    try {
      const userId = req.user.id;
      const {
        kegiatan_ids, // Changed to array of kegiatan IDs
        judul_proposal,
        nama_kegiatan_spesifik,
        volume,
        lokasi,
        deskripsi,
        anggaran_usulan,
        tahun_anggaran // Tahun anggaran untuk proposal
      } = req.body;

      console.log('=== DEBUG UPLOAD PROPOSAL ===');
      console.log('req.body:', req.body);
      console.log('kegiatan_ids type:', typeof kegiatan_ids);
      console.log('kegiatan_ids value:', kegiatan_ids);

      // Parse kegiatan_ids if it's a string
      let kegiatanIdsArray = [];
      if (typeof kegiatan_ids === 'string') {
        try {
          kegiatanIdsArray = JSON.parse(kegiatan_ids);
          console.log('Parsed kegiatan_ids:', kegiatanIdsArray);
        } catch (e) {
          console.error('Error parsing kegiatan_ids:', e);
          return res.status(400).json({
            success: false,
            message: 'Format kegiatan_ids tidak valid: ' + e.message
          });
        }
      } else if (Array.isArray(kegiatan_ids)) {
        kegiatanIdsArray = kegiatan_ids;
      }

      // Convert all IDs to integers
      kegiatanIdsArray = kegiatanIdsArray.map(id => parseInt(id));
      console.log('Converted kegiatan_ids to integers:', kegiatanIdsArray);

      // Validate required fields
      if (!kegiatanIdsArray || kegiatanIdsArray.length === 0 || !judul_proposal) {
        return res.status(400).json({
          success: false,
          message: 'Minimal 1 kegiatan dan judul proposal wajib diisi'
        });
      }

      // Validate anggaran limit
      if (anggaran_usulan) {
        const anggaranNum = parseInt(String(anggaran_usulan).replace(/\D/g, ''), 10);
        if (anggaranNum > MAX_ANGGARAN) {
          if (req.file && req.file.path) fs.unlinkSync(req.file.path);
          return res.status(400).json({
            success: false,
            message: `Anggaran usulan tidak boleh lebih dari Rp 1.500.000.000 (1,5 Miliar). Nilai yang diinput: Rp ${anggaranNum.toLocaleString('id-ID')}`
          });
        }
      }

      // Validate file upload
      if (!req.file) {
        return res.status(400).json({
          success: false,
          message: 'File proposal wajib diupload'
        });
      }

      // Get desa_id and kecamatan_id from user
      const [users] = await sequelize.query(`
        SELECT u.desa_id, d.kecamatan_id 
        FROM users u
        JOIN desas d ON u.desa_id = d.id
        WHERE u.id = ?
      `, { replacements: [userId] });

      if (!users || users.length === 0 || !users[0].desa_id) {
        // Delete uploaded file
        if (req.file && req.file.path) {
          fs.unlinkSync(req.file.path);
        }
        return res.status(403).json({
          success: false,
          message: 'User tidak terkait dengan desa'
        });
      }

      const desaId = users[0].desa_id;
      const kecamatanId = users[0].kecamatan_id;

      const filePath = req.file.filename; // Hanya filename tanpa folder prefix
      const fileSize = req.file.size;
      
      // Parse tahun_anggaran, default to current year
      const tahunAnggaranValue = tahun_anggaran ? parseInt(tahun_anggaran) : new Date().getFullYear();

      // Use Prisma transaction to insert proposal and kegiatan relationships
      const proposal = await prisma.bankeu_proposals.create({
        data: {
          desa_id: desaId,
          tahun_anggaran: tahunAnggaranValue,
          kegiatan_id: kegiatanIdsArray[0], // Primary kegiatan reference
          judul_proposal: judul_proposal,
          nama_kegiatan_spesifik: nama_kegiatan_spesifik || null,
          volume: volume || null,
          lokasi: lokasi || null,
          deskripsi: deskripsi || null,
          file_proposal: filePath,
          file_size: fileSize,
          anggaran_usulan: anggaran_usulan ? parseInt(anggaran_usulan.replace(/\D/g, '')) : null,
          created_by: userId,
          status: 'pending',
          bankeu_proposal_kegiatan: {
            create: kegiatanIdsArray.map(kegiatanId => ({
              kegiatan_id: kegiatanId
            }))
          }
        }
      });

      const proposalId = Number(proposal.id);
      
      console.log('✅ Proposal created:', proposalId);
      console.log('✅ Kegiatan relationships created:', kegiatanIdsArray.length);

      logger.info(`✅ Bankeu proposal uploaded: ${proposalId} with ${kegiatanIdsArray.length} kegiatan by user ${userId}`);

      // Activity Log
      ActivityLogger.log({
        userId: userId,
        userName: req.user.name || `User ${userId}`,
        userRole: req.user.role,
        bidangId: 3,
        module: 'bankeu',
        action: 'create',
        entityType: 'bankeu_proposal',
        entityId: proposalId,
        entityName: judul_proposal,
        description: `${req.user.name || 'User'} mengupload proposal baru: "${judul_proposal}" (ID: ${proposalId}, Tahun: ${tahunAnggaranValue})`,
        newValue: { judul_proposal, anggaran_usulan, volume, lokasi, tahun_anggaran: tahunAnggaranValue, kegiatan_ids: kegiatanIdsArray },
        ipAddress: ActivityLogger.getIpFromRequest(req),
        userAgent: ActivityLogger.getUserAgentFromRequest(req)
      });

      res.status(201).json({
        success: true,
        message: 'Proposal berhasil diupload',
        data: {
          id: proposalId
        }
      });
    } catch (error) {
      // Delete uploaded file on error
      if (req.file && req.file.path) {
        try {
          fs.unlinkSync(req.file.path);
        } catch (unlinkError) {
          logger.error('Error deleting file:', unlinkError);
        }
      }

      logger.error('Error uploading proposal:', error);
      console.error('FULL ERROR:', error);
      console.error('ERROR STACK:', error.stack);
      res.status(500).json({
        success: false,
        message: 'Gagal mengupload proposal',
        error: error.message
      });
    }
  }

  /**
   * Update existing proposal (for revision)
   * PATCH /api/desa/bankeu/proposals/:id
   */
  async updateProposal(req, res) {
    try {
      const { id } = req.params;
      const userId = req.user.id;
      const { anggaran_usulan, nama_kegiatan_spesifik, volume, lokasi } = req.body;

      logger.info(`♻️ UPDATE REVISION REQUEST - ID: ${id}, User: ${userId}, Anggaran: ${anggaran_usulan}`);

      // Get desa_id from user
      const [users] = await sequelize.query(`
        SELECT desa_id FROM users WHERE id = ?
      `, { replacements: [userId] });

      if (!users || users.length === 0 || !users[0].desa_id) {
        // Delete uploaded file if exists
        if (req.file && req.file.path) {
          fs.unlinkSync(req.file.path);
        }
        logger.warn(`❌ User ${userId} tidak terkait dengan desa`);
        return res.status(403).json({
          success: false,
          message: 'User tidak terkait dengan desa'
        });
      }

      const desaId = users[0].desa_id;

      // Get existing proposal
      // FIX 2026-03-11: Tambahkan troubleshoot_catatan untuk deteksi troubleshoot case
      const [proposals] = await sequelize.query(`
        SELECT file_proposal, status, desa_id, submitted_to_kecamatan, submitted_to_dinas_at, dinas_status, kecamatan_status, troubleshoot_catatan
        FROM bankeu_proposals
        WHERE id = ?
      `, { replacements: [id] });

      if (!proposals || proposals.length === 0) {
        // Delete uploaded file if exists
        if (req.file && req.file.path) {
          fs.unlinkSync(req.file.path);
        }
        logger.warn(`❌ Proposal ${id} tidak ditemukan`);
        return res.status(404).json({
          success: false,
          message: 'Proposal tidak ditemukan'
        });
      }

      const proposal = proposals[0];
      logger.info(`📋 Proposal info - Status: ${proposal.status}, Dinas Status: ${proposal.dinas_status}, Kec Status: ${proposal.kecamatan_status}, Submitted Kec: ${proposal.submitted_to_kecamatan}, Submitted Dinas: ${proposal.submitted_to_dinas_at}`);

      // Check ownership
      if (proposal.desa_id !== desaId) {
        // Delete uploaded file if exists
        if (req.file && req.file.path) {
          fs.unlinkSync(req.file.path);
        }
        logger.warn(`❌ User ${userId} tidak memiliki akses untuk proposal ${id}`);
        return res.status(403).json({
          success: false,
          message: 'Anda tidak memiliki akses untuk mengupdate proposal ini'
        });
      }

      // Allow update if:
      // 1. Kecamatan status is revision/rejected (returned from kecamatan), OR
      // 2. Dinas status is revision/rejected (returned from dinas), OR
      // 3. Troubleshoot case from DPMD (all status null but troubleshoot_catatan set)
      // AND submitted_to_kecamatan must be FALSE (returned to desa)
      // FIX 2026-03-11: Handle troubleshoot case from DPMD
      const isTroubleshoot = !!proposal.troubleshoot_catatan && (proposal.status === 'revision' || proposal.status === 'rejected');
      const isKecamatanRejected = (proposal.kecamatan_status === 'revision' || proposal.kecamatan_status === 'rejected') ||
                                   ((proposal.status === 'revision' || proposal.status === 'rejected') && !isTroubleshoot);
      const isDinasRejected = proposal.dinas_status === 'revision' || proposal.dinas_status === 'rejected';
      const isReturnedToDesa = !proposal.submitted_to_kecamatan;
      
      logger.info(`🔍 Validation check - Kec rejected: ${isKecamatanRejected}, Dinas rejected: ${isDinasRejected}, Troubleshoot: ${isTroubleshoot}, Returned: ${isReturnedToDesa}`);
      
      if (!isReturnedToDesa || (!isKecamatanRejected && !isDinasRejected && !isTroubleshoot)) {
        // Delete uploaded file if exists
        if (req.file && req.file.path) {
          fs.unlinkSync(req.file.path);
        }
        logger.warn(`❌ Proposal ${id} tidak memenuhi syarat untuk diupdate`);
        return res.status(400).json({
          success: false,
          message: 'Hanya proposal dengan status revisi atau ditolak yang dapat diupdate',
          error: `Status: ${proposal.status}, Dinas Status: ${proposal.dinas_status}, Submitted: ${proposal.submitted_to_kecamatan}`
        });
      }

      // Detect: If returned from Kecamatan (NOT troubleshoot), need to send back to Kecamatan
      // If returned from Dinas OR troubleshoot DPMD, need to send to Dinas
      // FIX 2026-03-11: Troubleshoot cases go to Dinas (reset dari awal)
      const returnedFromKecamatan = isKecamatanRejected && !isTroubleshoot && !isDinasRejected;
      logger.info(`📍 Return detection - From Kecamatan: ${returnedFromKecamatan}, From Dinas/Troubleshoot: ${(isDinasRejected || isTroubleshoot) && !returnedFromKecamatan}`);

      // Build update query
      const updates = [];
      const replacements = [];

      // Update anggaran if provided (with validation)
      if (anggaran_usulan) {
        const anggaranNum = parseInt(String(anggaran_usulan).replace(/\D/g, ''), 10);
        if (anggaranNum > MAX_ANGGARAN) {
          if (req.file && req.file.path) fs.unlinkSync(req.file.path);
          return res.status(400).json({
            success: false,
            message: `Anggaran usulan tidak boleh lebih dari Rp 1.500.000.000 (1,5 Miliar). Nilai yang diinput: Rp ${anggaranNum.toLocaleString('id-ID')}`
          });
        }
        updates.push('anggaran_usulan = ?');
        replacements.push(anggaranNum);
      }

      // Update nama kegiatan spesifik if provided
      if (nama_kegiatan_spesifik) {
        updates.push('nama_kegiatan_spesifik = ?');
        replacements.push(nama_kegiatan_spesifik);
      }

      // Update volume if provided
      if (volume) {
        updates.push('volume = ?');
        replacements.push(volume);
      }

      // Update lokasi if provided
      if (lokasi) {
        updates.push('lokasi = ?');
        replacements.push(lokasi);
      }

      // Update file if uploaded
      if (req.file) {
        const filePath = req.file.filename; // Hanya filename tanpa folder prefix
        const fileSize = req.file.size;

        updates.push('file_proposal = ?', 'file_size = ?');
        replacements.push(filePath, fileSize);

        // Copy old file to bankeu_reference/ before deleting, as safety net for history
        const oldFilePath = proposal.file_proposal;
        if (oldFilePath) {
          const fullOldPath = path.join(__dirname, '../../storage/uploads/bankeu', oldFilePath);
          
          if (fs.existsSync(fullOldPath)) {
            // Copy to reference first (ignore errors - file might already exist there)
            try {
              await copyFileToReference(oldFilePath);
              logger.info(`📋 Copied old file to reference: ${oldFilePath}`);
            } catch (copyErr) {
              logger.warn(`⚠️ Could not copy to reference (may already exist): ${copyErr.message}`);
            }
            // Now safe to delete from bankeu/
            fs.unlinkSync(fullOldPath);
            logger.info(`🗑️ Deleted old file from bankeu/: ${oldFilePath}`);
          }
        }
      }

      // Reset status to pending, clear verification data
      // IMPORTANT: Set verified_at to NOW() for Kecamatan case so frontend can detect reupload
      // FIX 2026-03-11: Clear troubleshoot data karena sudah tidak relevan setelah desa upload ulang
      if (returnedFromKecamatan) {
        // Returned from Kecamatan - SET verified_at untuk detection
        logger.info(`🔄 Revisi dari Kecamatan - siap kirim kembali ke Kecamatan`);
        updates.push(
          'status = ?',
          'submitted_to_kecamatan = ?',  // Set to FALSE, will submit manually
          'submitted_at = NULL',
          'catatan_verifikasi = NULL',
          'verified_at = NOW()',  // CRITICAL: Set this so frontend can detect reupload
          // Clear troubleshoot data (tidak relevan lagi setelah upload ulang)
          'troubleshoot_catatan = NULL',
          'troubleshoot_by = NULL',
          'troubleshoot_at = NULL',
          'updated_at = NOW()'
        );
        // Keep verified_by for tracking who approved before Kecamatan rejection
        replacements.push('pending', false);
      } else {
        // Returned from Dinas/Troubleshoot - Keep dinas_status untuk tracking origin
        logger.info(`🔄 Revisi dari Dinas/Troubleshoot - siap kirim kembali ke Dinas`);
        updates.push(
          'status = ?',
          'submitted_to_kecamatan = ?',
          'submitted_at = NULL',
          'submitted_to_dinas_at = NULL',
          // KEEP verified_by and verified_at (track kecamatan approval)
          // KEEP dinas_status ('rejected'/'revision') untuk tracking bahwa ini dari dinas
          // KEEP dinas_catatan untuk info
          // Reset verified_by dan verified_at untuk dinas saja
          'dinas_verified_by = NULL',
          'dinas_verified_at = NULL',
          // Clear troubleshoot data (tidak relevan lagi setelah upload ulang)
          'troubleshoot_catatan = NULL',
          'troubleshoot_by = NULL',
          'troubleshoot_at = NULL',
          'updated_at = NOW()'
        );
        replacements.push('pending', false);
      }

      // Add id at the end for WHERE clause
      replacements.push(id);

      // Execute update
      await sequelize.query(`
        UPDATE bankeu_proposals
        SET ${updates.join(', ')}
        WHERE id = ?
      `, { replacements });

      logger.info(`♻️ Bankeu proposal updated (revision): ${id} by user ${userId}`);

      // Activity Log
      const destination = returnedFromKecamatan ? 'Kecamatan' : 'Dinas Terkait';
      ActivityLogger.log({
        userId: userId,
        userName: req.user.name || `User ${userId}`,
        userRole: req.user.role,
        bidangId: 3,
        module: 'bankeu',
        action: 'update',
        entityType: 'bankeu_proposal',
        entityId: parseInt(id),
        entityName: proposal.judul_proposal || `Proposal #${id}`,
        description: `${req.user.name || 'User'} mengupdate revisi proposal #${id} (dikembalikan dari ${destination})`,
        oldValue: { status: proposal.status, dinas_status: proposal.dinas_status },
        newValue: { status: 'pending', file_replaced: !!req.file },
        ipAddress: ActivityLogger.getIpFromRequest(req),
        userAgent: ActivityLogger.getUserAgentFromRequest(req)
      });

      // Log untuk debugging
      logger.info(`📋 Revision upload - proposal ${id} siap dikirim ke ${destination}`);

      res.json({
        success: true,
        message: returnedFromKecamatan 
          ? 'Revisi proposal berhasil diupload. Gunakan tombol "Kirim ke Kecamatan" untuk mengirim.'
          : 'Revisi proposal berhasil diupload. Gunakan tombol "Kirim ke Dinas Terkait" untuk mengirim.',
        data: { 
          id: parseInt(id),
          send_to: returnedFromKecamatan ? 'kecamatan' : 'dinas',
          returned_from: returnedFromKecamatan ? 'kecamatan' : 'dinas'
        }
      });
    } catch (error) {
      // Delete uploaded file on error
      if (req.file && req.file.path) {
        try {
          fs.unlinkSync(req.file.path);
        } catch (unlinkError) {
          logger.error('Error deleting file:', unlinkError);
        }
      }

      logger.error('Error updating proposal:', error);
      res.status(500).json({
        success: false,
        message: 'Gagal mengupdate proposal',
        error: error.message
      });
    }
  }

  /**
   * Replace file in existing proposal (before submission to kecamatan)
   * PATCH /api/desa/bankeu/proposals/:id/replace-file
   */
  async replaceFile(req, res) {
    try {
      const { id } = req.params;
      const userId = req.user.id;
      const { anggaran_usulan, keep_status } = req.body;

      // Validate file upload
      if (!req.file) {
        return res.status(400).json({
          success: false,
          message: 'File proposal wajib diupload'
        });
      }

      // Get desa_id from user
      const [users] = await sequelize.query(`
        SELECT desa_id FROM users WHERE id = ?
      `, { replacements: [userId] });

      if (!users || users.length === 0 || !users[0].desa_id) {
        // Delete uploaded file
        if (req.file && req.file.path) {
          fs.unlinkSync(req.file.path);
        }
        return res.status(403).json({
          success: false,
          message: 'User tidak terkait dengan desa'
        });
      }

      const desaId = users[0].desa_id;

      // Get existing proposal
      const [existingProposal] = await sequelize.query(`
        SELECT file_proposal, status, desa_id, submitted_to_kecamatan
        FROM bankeu_proposals
        WHERE id = ?
      `, { replacements: [id] });

      if (!existingProposal || existingProposal.length === 0) {
        // Delete uploaded file
        if (req.file && req.file.path) {
          fs.unlinkSync(req.file.path);
        }
        return res.status(404).json({
          success: false,
          message: 'Proposal tidak ditemukan'
        });
      }

      const proposal = existingProposal[0];

      // Check ownership
      if (proposal.desa_id !== desaId) {
        // Delete uploaded file
        if (req.file && req.file.path) {
          fs.unlinkSync(req.file.path);
        }
        return res.status(403).json({
          success: false,
          message: 'Anda tidak memiliki akses untuk mengupdate proposal ini'
        });
      }

      // Check if proposal can have file replaced:
      // Case 1: Pending status and not yet submitted to kecamatan
      // Case 2: Returned from kecamatan (revision/rejected)
      const isReturnedFromKecamatan = ['rejected', 'revision'].includes(proposal.kecamatan_status) && !proposal.submitted_to_kecamatan;
      
      if (proposal.submitted_to_kecamatan && !isReturnedFromKecamatan) {
        // Delete uploaded file
        if (req.file && req.file.path) {
          fs.unlinkSync(req.file.path);
        }
        return res.status(400).json({
          success: false,
          message: 'Proposal yang sudah dikirim ke kecamatan tidak dapat diganti filenya'
        });
      }

      if (proposal.status !== 'pending' && !isReturnedFromKecamatan) {
        // Delete uploaded file
        if (req.file && req.file.path) {
          fs.unlinkSync(req.file.path);
        }
        return res.status(400).json({
          success: false,
          message: 'Hanya proposal dengan status pending atau dikembalikan untuk revisi yang dapat diganti filenya'
        });
      }

      const filePath = req.file.filename; // Hanya filename tanpa folder prefix
      const fileSize = req.file.size;
      const oldFilePath = proposal.file_proposal;

      // Copy old file to bankeu_reference/ before deleting, as safety net for history
      if (oldFilePath) {
        const fullPath = path.join(__dirname, '../../storage/uploads/bankeu', oldFilePath);
        
        if (fs.existsSync(fullPath)) {
          // Copy to reference first (ignore errors - file might already exist there)
          try {
            await copyFileToReference(oldFilePath);
            logger.info(`📋 Copied old file to reference: ${oldFilePath}`);
          } catch (copyErr) {
            logger.warn(`⚠️ Could not copy to reference (may already exist): ${copyErr.message}`);
          }
          // Now safe to delete from bankeu/
          fs.unlinkSync(fullPath);
          logger.info(`🗑️ Deleted old file from bankeu/: ${oldFilePath}`);
        }
      }

      // Update proposal - only file and optionally anggaran
      // NOTE: JANGAN update dinas_reviewed_file - itu sudah di-set saat Dinas approve
      const updateFields = ['file_proposal = ?', 'file_size = ?', 'updated_at = NOW()'];
      const updateValues = [filePath, fileSize];

      // If proposal was returned (revision/rejected), set status back to pending
      if (isReturnedFromKecamatan) {
        updateFields.push('status = ?', 'verified_at = NOW()');
        updateValues.push('pending');
        logger.info(`📝 Proposal ${id} status reset to pending via replaceFile (was revision/rejected)`);
      }

      if (anggaran_usulan) {
        const anggaranNum = parseInt(String(anggaran_usulan).replace(/\D/g, ''), 10);
        if (anggaranNum > MAX_ANGGARAN) {
          if (req.file && req.file.path) fs.unlinkSync(req.file.path);
          return res.status(400).json({
            success: false,
            message: `Anggaran usulan tidak boleh lebih dari Rp 1.500.000.000 (1,5 Miliar). Nilai yang diinput: Rp ${anggaranNum.toLocaleString('id-ID')}`
          });
        }
        updateFields.push('anggaran_usulan = ?');
        updateValues.push(anggaranNum);
      }

      updateValues.push(id);

      await sequelize.query(`
        UPDATE bankeu_proposals
        SET ${updateFields.join(', ')}
        WHERE id = ?
      `, { replacements: updateValues });

      logger.info(`🔄 Bankeu proposal file replaced: ${id} by user ${userId}`);

      // Activity Log
      ActivityLogger.log({
        userId: userId,
        userName: req.user.name || `User ${userId}`,
        userRole: req.user.role,
        bidangId: 3,
        module: 'bankeu',
        action: 'update',
        entityType: 'bankeu_proposal',
        entityId: parseInt(id),
        entityName: `Proposal #${id}`,
        description: `${req.user.name || 'User'} mengganti file proposal #${id}`,
        oldValue: { file_proposal: proposal.file_proposal },
        newValue: { file_proposal: filePath, anggaran_usulan: anggaran_usulan || null },
        ipAddress: ActivityLogger.getIpFromRequest(req),
        userAgent: ActivityLogger.getUserAgentFromRequest(req)
      });

      res.json({
        success: true,
        message: 'File proposal berhasil diganti',
        data: {
          id: parseInt(id)
        }
      });
    } catch (error) {
      // Delete uploaded file on error
      if (req.file && req.file.path) {
        try {
          fs.unlinkSync(req.file.path);
        } catch (unlinkError) {
          logger.error('Error deleting file:', unlinkError);
        }
      }

      logger.error('Error replacing file:', error);
      res.status(500).json({
        success: false,
        message: 'Gagal mengganti file proposal',
        error: error.message
      });
    }
  }

  /**
   * Delete proposal
   * DELETE /api/desa/bankeu/proposals/:id
   */
  async deleteProposal(req, res) {
    try {
      const { id } = req.params;
      const userId = req.user.id;

      // Get desa_id from user
      const [users] = await sequelize.query(`
        SELECT desa_id FROM users WHERE id = ?
      `, { replacements: [userId] });

      if (!users || users.length === 0 || !users[0].desa_id) {
        return res.status(403).json({
          success: false,
          message: 'User tidak terkait dengan desa'
        });
      }

      const desaId = users[0].desa_id;

      // Get proposal data
      const [proposals] = await sequelize.query(`
        SELECT file_proposal, berita_acara_path, status, desa_id, submitted_to_kecamatan, submitted_to_dinas_at
        FROM bankeu_proposals
        WHERE id = ?
      `, { replacements: [id] });

      if (!proposals || proposals.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'Proposal tidak ditemukan'
        });
      }

      const proposal = proposals[0];

      // Check ownership
      if (proposal.desa_id !== desaId) {
        return res.status(403).json({
          success: false,
          message: 'Anda tidak memiliki akses untuk menghapus proposal ini'
        });
      }

      // Don't allow deletion if already verified or approved
      if (proposal.status === 'verified' || proposal.status === 'approved') {
        return res.status(400).json({
          success: false,
          message: 'Proposal yang sudah diverifikasi tidak dapat dihapus'
        });
      }

      // Don't allow deletion if proposal has been submitted and received revision/rejection
      // Desa hanya bisa upload ulang, tidak bisa hapus
      if (proposal.submitted_to_kecamatan || proposal.submitted_to_dinas_at) {
        return res.status(400).json({
          success: false,
          message: 'Proposal yang sudah dikirim tidak dapat dihapus. Silakan upload ulang file proposal.'
        });
      }

      // Delete related kegiatan records first
      await sequelize.query(`
        DELETE FROM bankeu_proposal_kegiatan WHERE proposal_id = ?
      `, { replacements: [id] });

      // Delete files
      const filesToDelete = [proposal.file_proposal];
      if (proposal.berita_acara_path) {
        filesToDelete.push(proposal.berita_acara_path);
      }

      filesToDelete.forEach(filePath => {
        const fullPath = path.join(__dirname, '../../storage/uploads', filePath);
        if (fs.existsSync(fullPath)) {
          fs.unlinkSync(fullPath);
        }
      });

      // Delete from database
      await sequelize.query(`
        DELETE FROM bankeu_proposals WHERE id = ?
      `, { replacements: [id] });

      logger.info(`✅ Bankeu proposal deleted: ${id}`);

      // Activity Log - CRITICAL: Track siapa yang hapus proposal
      ActivityLogger.log({
        userId: userId,
        userName: req.user.name || `User ${userId}`,
        userRole: req.user.role,
        bidangId: 3,
        module: 'bankeu',
        action: 'delete',
        entityType: 'bankeu_proposal',
        entityId: parseInt(id),
        entityName: proposal.judul_proposal || `Proposal #${id}`,
        description: `${req.user.name || 'User'} MENGHAPUS proposal #${id} (Desa ID: ${desaId})`,
        oldValue: { file_proposal: proposal.file_proposal, status: proposal.status, desa_id: proposal.desa_id },
        ipAddress: ActivityLogger.getIpFromRequest(req),
        userAgent: ActivityLogger.getUserAgentFromRequest(req)
      });

      res.json({
        success: true,
        message: 'Proposal berhasil dihapus'
      });
    } catch (error) {
      logger.error('Error deleting proposal:', error);
      res.status(500).json({
        success: false,
        message: 'Gagal menghapus proposal',
        error: error.message
      });
    }
  }

  /**
   * Upload surat pengantar or surat permohonan
   * POST /api/desa/bankeu/proposals/:id/upload-surat
   * Body: { jenis: 'pengantar' | 'permohonan' }
   */
  async uploadSurat(req, res) {
    try {
      const { id } = req.params;
      const userId = req.user.id;
      const { jenis } = req.body; // 'pengantar' or 'permohonan'

      // Validate file upload
      if (!req.file) {
        return res.status(400).json({
          success: false,
          message: 'File surat wajib diupload'
        });
      }

      // Validate jenis
      if (!jenis || !['pengantar', 'permohonan'].includes(jenis)) {
        if (req.file && req.file.path) {
          fs.unlinkSync(req.file.path);
        }
        return res.status(400).json({
          success: false,
          message: 'Jenis surat harus "pengantar" atau "permohonan"'
        });
      }

      // Get desa_id from user
      const [users] = await sequelize.query(`
        SELECT desa_id FROM users WHERE id = ?
      `, { replacements: [userId] });

      if (!users || users.length === 0 || !users[0].desa_id) {
        if (req.file && req.file.path) {
          fs.unlinkSync(req.file.path);
        }
        return res.status(403).json({
          success: false,
          message: 'User tidak terkait dengan desa'
        });
      }

      const desaId = users[0].desa_id;

      // Get existing proposal
      const [existingProposal] = await sequelize.query(`
        SELECT surat_pengantar, surat_permohonan, desa_id 
        FROM bankeu_proposals
        WHERE id = ?
      `, { replacements: [id] });

      if (!existingProposal || existingProposal.length === 0) {
        if (req.file && req.file.path) {
          fs.unlinkSync(req.file.path);
        }
        return res.status(404).json({
          success: false,
          message: 'Proposal tidak ditemukan'
        });
      }

      const proposal = existingProposal[0];

      // Check ownership
      if (proposal.desa_id !== desaId) {
        if (req.file && req.file.path) {
          fs.unlinkSync(req.file.path);
        }
        return res.status(403).json({
          success: false,
          message: 'Anda tidak memiliki akses untuk proposal ini'
        });
      }

      const filePath = req.file.filename; // Hanya filename tanpa folder prefix
      const fieldName = jenis === 'pengantar' ? 'surat_pengantar' : 'surat_permohonan';
      const oldFilePath = proposal[fieldName];

      // Delete old file if exists
      if (oldFilePath) {
        const fullPath = path.join(__dirname, '../../storage/uploads/bankeu', oldFilePath);
        if (fs.existsSync(fullPath)) {
          fs.unlinkSync(fullPath);
          logger.info(`🗑️ Deleted old ${jenis}: ${oldFilePath}`);
        }
      }

      // Update proposal
      await sequelize.query(`
        UPDATE bankeu_proposals
        SET ${fieldName} = ?, updated_at = NOW()
        WHERE id = ?
      `, { replacements: [filePath, id] });

      logger.info(`✅ Surat ${jenis} uploaded for proposal ${id} by user ${userId}`);

      // Activity Log
      ActivityLogger.log({
        userId: userId,
        userName: req.user.name || `User ${userId}`,
        userRole: req.user.role,
        bidangId: 3,
        module: 'bankeu',
        action: 'upload',
        entityType: 'bankeu_proposal',
        entityId: parseInt(id),
        entityName: `Surat ${jenis} Proposal #${id}`,
        description: `${req.user.name || 'User'} mengupload surat ${jenis} untuk proposal #${id}`,
        newValue: { jenis, file: filePath },
        ipAddress: ActivityLogger.getIpFromRequest(req),
        userAgent: ActivityLogger.getUserAgentFromRequest(req)
      });

      res.json({
        success: true,
        message: `Surat ${jenis} berhasil diupload`,
        data: {
          id: parseInt(id),
          [fieldName]: filePath
        }
      });
    } catch (error) {
      // Delete uploaded file on error
      if (req.file && req.file.path) {
        try {
          fs.unlinkSync(req.file.path);
        } catch (unlinkError) {
          logger.error('Error deleting file:', unlinkError);
        }
      }

      logger.error('Error uploading surat:', error);
      res.status(500).json({
        success: false,
        message: 'Gagal mengupload surat',
        error: error.message
      });
    }
  }

  /**
   * Submit all proposals to kecamatan (FIRST SUBMISSION - NEW FLOW)
   * POST /api/desa/bankeu/submit-to-kecamatan
   * Flow: Desa → KECAMATAN → Dinas Terkait → DPMD
   */
  /**
   * Submit proposals to DINAS TERKAIT (FIRST SUBMISSION)
   * POST /api/desa/bankeu/submit-to-dinas-terkait
   * NEW FLOW 2026-01-30: Desa → Dinas Terkait (bukan Kecamatan)
   */
  async submitToDinasTerkait(req, res) {
    const transaction = await sequelize.transaction();
    
    try {
      const userId = req.user.id;
      const { tahun, proposal_ids } = req.body; // Tahun anggaran + optional per-proposal IDs

      logger.info(`📤 SUBMIT TO DINAS TERKAIT (FIRST SUBMISSION) - User: ${userId}, Tahun: ${tahun || 'ALL'}, ProposalIDs: ${proposal_ids ? proposal_ids.join(',') : 'ALL'}`);

      // Check if submission is open
      const { isOpen } = await checkSubmissionOpen();
      if (!isOpen) {
        await transaction.rollback();
        logger.warn(`⛔ Submission blocked - submission is closed by DPMD`);
        return res.status(403).json({
          success: false,
          message: 'Pengajuan saat ini ditutup oleh DPMD. Silakan hubungi DPMD untuk informasi lebih lanjut.'
        });
      }

      // Get desa_id from user
      const [users] = await sequelize.query(`
        SELECT desa_id FROM users WHERE id = ?
      `, { replacements: [userId] });

      if (!users || users.length === 0 || !users[0].desa_id) {
        await transaction.rollback();
        return res.status(403).json({
          success: false,
          message: 'User tidak terkait dengan desa'
        });
      }

      const desaId = users[0].desa_id;

      // Build filters
      const tahunFilter = tahun ? 'AND tahun_anggaran = ?' : '';
      const proposalIdsFilter = proposal_ids && Array.isArray(proposal_ids) && proposal_ids.length > 0
        ? `AND id IN (${proposal_ids.map(() => '?').join(',')})`
        : '';
      const replacementsCount = [desaId];
      if (tahun) replacementsCount.push(parseInt(tahun));
      if (proposal_ids && Array.isArray(proposal_ids) && proposal_ids.length > 0) {
        replacementsCount.push(...proposal_ids.map(id => parseInt(id)));
      }

      // NEW FLOW 2026-01-30: Submit proposal yang belum pernah submit
      // Kondisi: submitted_to_dinas_at IS NULL (belum pernah dikirim ke dinas)
      const [notSubmittedCount] = await sequelize.query(`
        SELECT COUNT(*) as total
        FROM bankeu_proposals
        WHERE desa_id = ? 
          AND submitted_to_dinas_at IS NULL
          AND (dinas_status IS NULL OR dinas_status = 'pending')
          ${tahunFilter}
          ${proposalIdsFilter}
      `, { replacements: replacementsCount });

      if (notSubmittedCount[0].total < 1) {
        await transaction.rollback();
        return res.status(400).json({
          success: false,
          message: 'Tidak ada proposal yang perlu dikirim'
        });
      }

      const count = notSubmittedCount[0].total;

      // Submit to Dinas Terkait
      const replacementsUpdate = [desaId];
      if (tahun) replacementsUpdate.push(parseInt(tahun));
      if (proposal_ids && Array.isArray(proposal_ids) && proposal_ids.length > 0) {
        replacementsUpdate.push(...proposal_ids.map(id => parseInt(id)));
      }
      await sequelize.query(`
        UPDATE bankeu_proposals
        SET submitted_to_dinas_at = NOW(),
            dinas_status = 'pending',
            status = 'pending'
        WHERE desa_id = ? 
          AND submitted_to_dinas_at IS NULL
          AND (dinas_status IS NULL OR dinas_status = 'pending')
          ${tahunFilter}
          ${proposalIdsFilter}
      `, { 
        replacements: replacementsUpdate,
        transaction 
      });

      await transaction.commit();

      logger.info(`✅ ${count} proposals from desa ${desaId} (tahun: ${tahun || 'ALL'}) submitted to DINAS TERKAIT`);

      // Activity Log
      ActivityLogger.log({
        userId: userId,
        userName: req.user.name || `User ${userId}`,
        userRole: req.user.role,
        bidangId: 3,
        module: 'bankeu',
        action: 'submit',
        entityType: 'bankeu_proposal',
        entityName: `${count} proposal desa ${desaId}`,
        description: `${req.user.name || 'User'} mengirim ${count} proposal ke Dinas Terkait (Tahun: ${tahun || 'ALL'}, Desa ID: ${desaId})`,
        newValue: { count, desa_id: desaId, tahun: tahun || 'ALL', destination: 'dinas_terkait' },
        ipAddress: ActivityLogger.getIpFromRequest(req),
        userAgent: ActivityLogger.getUserAgentFromRequest(req)
      });

      res.json({
        success: true,
        message: `${count} proposal berhasil dikirim ke Dinas Terkait`
      });
    } catch (error) {
      if (transaction && !transaction.finished) {
        await transaction.rollback();
      }
      logger.error('Error submitting to dinas:', error);
      res.status(500).json({
        success: false,
        message: 'Gagal mengirim proposal ke dinas terkait',
        error: error.message
      });
    }
  }

  /**
   * DEPRECATED: Kept for backward compatibility
   * Use submitToDinasTerkait instead
   */
  async submitToKecamatan(req, res) {
    return this.submitToDinasTerkait(req, res);
  }

  /**
   * Resubmit proposals (REVISI dari Dinas/Kecamatan/DPMD)
   * POST /api/desa/bankeu/resubmit
   * NEW FLOW 2026-01-30: Desa upload ulang → Dinas Terkait
   * UPDATED 2026-02-04: Support destination parameter untuk split Kecamatan vs Dinas
   */
  async resubmitProposal(req, res) {
    const transaction = await sequelize.transaction();
    
    try {
      const userId = req.user.id;
      const { destination, tahun, proposal_ids } = req.body; // 'kecamatan' atau 'dinas' + tahun anggaran + optional per-proposal IDs

      logger.info(`📤 RESUBMIT PROPOSAL (REVISI) - User: ${userId}, Destination: ${destination || 'auto-detect'}, Tahun: ${tahun || 'ALL'}, ProposalIDs: ${proposal_ids ? proposal_ids.join(',') : 'ALL'}`);

      // Check if submission is open
      const { isOpen } = await checkSubmissionOpen();
      if (!isOpen) {
        await transaction.rollback();
        logger.warn(`⛔ Resubmit blocked - submission is closed by DPMD`);
        return res.status(403).json({
          success: false,
          message: 'Pengajuan saat ini ditutup oleh DPMD. Silakan hubungi DPMD untuk informasi lebih lanjut.'
        });
      }

      // Get desa_id from user
      const [users] = await sequelize.query(`
        SELECT desa_id FROM users WHERE id = ?
      `, { replacements: [userId] });

      if (!users || users.length === 0 || !users[0].desa_id) {
        await transaction.rollback();
        return res.status(403).json({
          success: false,
          message: 'User tidak terkait dengan desa'
        });
      }

      const desaId = users[0].desa_id;

      // Build filters
      const tahunFilter = tahun ? 'AND tahun_anggaran = ?' : '';
      const proposalIdsFilter = proposal_ids && Array.isArray(proposal_ids) && proposal_ids.length > 0
        ? `AND id IN (${proposal_ids.map(() => '?').join(',')})`
        : '';
      const baseReplacements = [desaId];
      if (tahun) baseReplacements.push(parseInt(tahun));
      if (proposal_ids && Array.isArray(proposal_ids) && proposal_ids.length > 0) {
        baseReplacements.push(...proposal_ids.map(id => parseInt(id)));
      }

      // Get all revision proposals to detect origin
      // Proposal yang SUDAH UPLOAD ULANG: status='pending' tapi punya dinas_status/kecamatan_status/dpmd_status
      // DAN belum dikirim ulang (submitted_to_kecamatan = FALSE)
      // NOTE: submitted_to_dinas_at tidak di-null lagi saat kecamatan revisi, 
      // jadi deteksi hanya pakai submitted_to_kecamatan + status rejection
      // FIX 2026-03-11: Tambahkan troubleshoot_catatan untuk mendeteksi proposal yg di-troubleshoot DPMD
      const [proposals] = await sequelize.query(`
        SELECT id, dinas_status, kecamatan_status, dpmd_status, status, submitted_to_dinas_at, troubleshoot_catatan
        FROM bankeu_proposals
        WHERE desa_id = ? 
          AND status = 'pending'
          AND submitted_to_kecamatan = FALSE
          AND (
            (submitted_to_dinas_at IS NULL AND (dinas_status IS NOT NULL OR dpmd_status IS NOT NULL OR troubleshoot_catatan IS NOT NULL))
            OR kecamatan_status IN ('rejected', 'revision')
          )
          ${tahunFilter}
          ${proposalIdsFilter}
      `, { replacements: baseReplacements });

      if (proposals.length < 1) {
        await transaction.rollback();
        return res.status(400).json({
          success: false,
          message: 'Tidak ada proposal revisi yang perlu dikirim ulang. Upload ulang proposal yang ditolak terlebih dahulu.'
        });
      }

      // Detect rejection origin
      let fromDPMD = false;
      let fromKecamatan = false;
      let fromDinas = false;

      if (destination) {
        // Jika ada parameter destination, gunakan itu (prioritas tinggi)
        if (destination === 'kecamatan') {
          fromKecamatan = true;
        } else if (destination === 'dinas') {
          fromDinas = true;
        }
        logger.info(`✅ Using explicit destination parameter: ${destination}`);
      } else {
        // Fallback: Auto-detect dari proposal pertama (legacy behavior)
        const firstProposal = proposals[0];
        fromDPMD = firstProposal.dpmd_status && 
                   ['rejected', 'revision'].includes(firstProposal.dpmd_status);
        fromKecamatan = !fromDPMD && 
                       firstProposal.kecamatan_status && 
                       ['rejected', 'revision'].includes(firstProposal.kecamatan_status);
        fromDinas = !fromDPMD && !fromKecamatan && 
                   firstProposal.dinas_status && 
                   ['rejected', 'revision'].includes(firstProposal.dinas_status);
        logger.info(`🔍 Auto-detected Origin - DPMD: ${fromDPMD}, Kecamatan: ${fromKecamatan}, Dinas: ${fromDinas}`);
      }

      let updateQuery = '';
      let destinationLabel = '';

      if (fromKecamatan) {
        // REJECT DARI KECAMATAN → Kirim langsung ke Kecamatan (skip Dinas)
        // IMPORTANT: Hanya update proposal yang MEMANG dari Kecamatan (ada kecamatan_status rejection tapi TIDAK ada dinas_status rejection)
        destinationLabel = 'Kecamatan';
        updateQuery = `
          UPDATE bankeu_proposals
          SET submitted_to_kecamatan = TRUE,
              submitted_to_dinas_at = NOW(),
              kecamatan_status = 'pending',
              /* IMPORTANT: KEEP kecamatan_catatan untuk detection tombol Bandingkan */
              /* kecamatan_catatan = NULL, */ 
              kecamatan_verified_by = NULL,
              kecamatan_verified_at = NULL,
              dpmd_status = NULL,
              dpmd_catatan = NULL,
              dpmd_verified_by = NULL,
              dpmd_verified_at = NULL,
              submitted_to_dpmd = FALSE,
              status = 'pending',
              updated_at = NOW()
          WHERE desa_id = ? 
            AND status = 'pending'
            AND submitted_to_kecamatan = FALSE
            AND kecamatan_status IN ('rejected', 'revision')
            AND (dinas_status IS NULL OR dinas_status NOT IN ('rejected', 'revision'))
            AND dpmd_status IS NULL
            ${tahunFilter}
            ${proposalIdsFilter}
        `;
      } else {
        // REJECT DARI DINAS atau DPMD atau TROUBLESHOOT → Kirim ke Dinas (flow normal dari awal)
        // IMPORTANT: Hanya update proposal yang dari Dinas atau DPMD atau troubleshoot
        // FIX 2026-03-11: Tambahkan troubleshoot_catatan untuk troubleshooted proposals
        destinationLabel = fromDPMD ? 'Dinas Terkait (dari DPMD)' : 'Dinas Terkait';
        updateQuery = `
          UPDATE bankeu_proposals
          SET submitted_to_dinas_at = NOW(),
              dinas_status = 'pending',
              -- KEEP dinas_catatan agar verifikator bisa lihat catatan sebelumnya
              dinas_verified_by = NULL,
              dinas_verified_at = NULL,
              kecamatan_status = NULL,
              kecamatan_catatan = NULL,
              kecamatan_verified_by = NULL,
              kecamatan_verified_at = NULL,
              dpmd_status = NULL,
              dpmd_catatan = NULL,
              dpmd_verified_by = NULL,
              dpmd_verified_at = NULL,
              submitted_to_kecamatan = FALSE,
              submitted_to_dpmd = FALSE,
              status = 'pending',
              updated_at = NOW()
          WHERE desa_id = ? 
            AND status = 'pending'
            AND submitted_to_dinas_at IS NULL
            AND submitted_to_kecamatan = FALSE
            AND (
              dinas_status IN ('rejected', 'revision') 
              OR dpmd_status IS NOT NULL
              OR troubleshoot_catatan IS NOT NULL
            )
            ${tahunFilter}
            ${proposalIdsFilter}
        `;
      }

      await sequelize.query(updateQuery, { 
        replacements: baseReplacements,
        transaction 
      });

      await transaction.commit();

      const count = proposals.length;
      logger.info(`✅ ${count} revised proposals from desa ${desaId} resubmitted to ${destinationLabel}`);

      // Activity Log
      ActivityLogger.log({
        userId: userId,
        userName: req.user.name || `User ${userId}`,
        userRole: req.user.role,
        bidangId: 3,
        module: 'bankeu',
        action: 'resubmit',
        entityType: 'bankeu_proposal',
        entityName: `${count} proposal revisi desa ${desaId}`,
        description: `${req.user.name || 'User'} mengirim ulang ${count} proposal revisi ke ${destinationLabel} (Tahun: ${tahun || 'ALL'}, Desa ID: ${desaId})`,
        newValue: { count, desa_id: desaId, tahun: tahun || 'ALL', destination: destinationLabel },
        ipAddress: ActivityLogger.getIpFromRequest(req),
        userAgent: ActivityLogger.getUserAgentFromRequest(req)
      });

      res.json({
        success: true,
        message: `${count} proposal revisi berhasil dikirim ulang ke ${destinationLabel}`,
        data: { count, destination: destinationLabel }
      });
    } catch (error) {
      await transaction.rollback();
      logger.error('Error resubmitting proposals:', error);
      res.status(500).json({
        success: false,
        message: 'Gagal mengirim ulang proposal',
        error: error.message
      });
    }
  }

  /**
   * DEPRECATED: Kept for backward compatibility
   * Use resubmitProposal instead
   */
  async submitToDinas(req, res) {
    return this.resubmitProposal(req, res);
  }

  /**
   * Edit proposal before submission (belum dikirim ke kecamatan/dinas)
   * PUT /api/desa/bankeu/proposals/:id/edit
   */
  async editProposal(req, res) {
    try {
      const { id } = req.params;
      const userId = req.user.id;
      const { judul_proposal, nama_kegiatan_spesifik, volume, lokasi, anggaran_usulan } = req.body;

      logger.info(`✏️ EDIT PROPOSAL REQUEST - ID: ${id}, User: ${userId}`);

      // Get desa_id from user
      const [users] = await sequelize.query(`
        SELECT desa_id FROM users WHERE id = ?
      `, { replacements: [userId] });

      if (!users || users.length === 0 || !users[0].desa_id) {
        // Delete uploaded file if exists
        if (req.file && req.file.path) {
          fs.unlinkSync(req.file.path);
        }
        logger.warn(`❌ User ${userId} tidak terkait dengan desa`);
        return res.status(403).json({
          success: false,
          message: 'User tidak terkait dengan desa'
        });
      }

      const desaId = users[0].desa_id;

      // Get existing proposal
      const [proposals] = await sequelize.query(`
        SELECT bp.*, d.nama as nama_desa
        FROM bankeu_proposals bp
        LEFT JOIN desas d ON bp.desa_id = d.id
        WHERE bp.id = ?
      `, { replacements: [id] });

      if (!proposals || proposals.length === 0) {
        // Delete uploaded file if exists
        if (req.file && req.file.path) {
          fs.unlinkSync(req.file.path);
        }
        logger.warn(`❌ Proposal ${id} tidak ditemukan`);
        return res.status(404).json({
          success: false,
          message: 'Proposal tidak ditemukan'
        });
      }

      const proposal = proposals[0];
      logger.info(`📋 Proposal info - Status: ${proposal.status}, Submitted to Kec: ${proposal.submitted_to_kecamatan}, Submitted to Dinas: ${proposal.submitted_to_dinas_at}`);

      // Check ownership
      if (proposal.desa_id !== desaId) {
        // Delete uploaded file if exists
        if (req.file && req.file.path) {
          fs.unlinkSync(req.file.path);
        }
        logger.warn(`❌ User ${userId} tidak memiliki akses untuk proposal ${id}`);
        return res.status(403).json({
          success: false,
          message: 'Anda tidak memiliki akses untuk mengedit proposal ini'
        });
      }

      // Only allow edit if NOT yet submitted to kecamatan and NOT yet submitted to dinas
      // Tombol Edit hanya untuk DRAFT (belum pernah dikirim)
      // Untuk revisi, desa pakai endpoint updateProposal (PATCH /:id)
      const isSubmittedToKecamatan = proposal.submitted_to_kecamatan;
      const isSubmittedToDinas = proposal.submitted_to_dinas_at !== null;
      
      logger.info(`🔍 Submission check - Kec: ${isSubmittedToKecamatan}, Dinas: ${isSubmittedToDinas}`);
      
      if (isSubmittedToKecamatan || isSubmittedToDinas) {
        // Delete uploaded file if exists
        if (req.file && req.file.path) {
          fs.unlinkSync(req.file.path);
        }
        logger.warn(`❌ Proposal ${id} sudah dikirim, tidak bisa diedit`);
        return res.status(400).json({
          success: false,
          message: 'Proposal yang sudah dikirim ke Kecamatan atau Dinas tidak dapat diedit. Hapus dan buat ulang jika diperlukan.'
        });
      }

      // Build update query
      const updates = [];
      const replacements = [];

      // Update judul_proposal if provided
      if (judul_proposal) {
        updates.push('judul_proposal = ?');
        replacements.push(judul_proposal);
      }

      // Update nama_kegiatan_spesifik if provided
      if (nama_kegiatan_spesifik) {
        updates.push('nama_kegiatan_spesifik = ?');
        replacements.push(nama_kegiatan_spesifik);
      }

      // Update volume if provided
      if (volume) {
        updates.push('volume = ?');
        replacements.push(volume);
      }

      // Update lokasi if provided
      if (lokasi) {
        updates.push('lokasi = ?');
        replacements.push(lokasi);
      }

      // Update anggaran if provided (with validation)
      if (anggaran_usulan) {
        const anggaranNum = parseInt(String(anggaran_usulan).replace(/\D/g, ''), 10);
        if (anggaranNum > MAX_ANGGARAN) {
          if (req.file && req.file.path) fs.unlinkSync(req.file.path);
          return res.status(400).json({
            success: false,
            message: `Anggaran usulan tidak boleh lebih dari Rp 1.500.000.000 (1,5 Miliar). Nilai yang diinput: Rp ${anggaranNum.toLocaleString('id-ID')}`
          });
        }
        updates.push('anggaran_usulan = ?');
        replacements.push(anggaranNum);
      }

      // Update file if uploaded
      if (req.file) {
        const filePath = req.file.filename;
        const fileSize = req.file.size;

        updates.push('file_proposal = ?', 'file_size = ?');
        replacements.push(filePath, fileSize);

        // Move old file to reference folder (preserve for history) instead of deleting
        const oldFilePath = proposal.file_proposal;
        if (oldFilePath) {
          const fullOldPath = path.join(__dirname, '../../storage/uploads/bankeu', oldFilePath);
          const referenceDir = path.join(__dirname, '../../storage/uploads/bankeu_reference');
          const referencePath = path.join(referenceDir, oldFilePath);
          
          if (!fs.existsSync(referenceDir)) {
            fs.mkdirSync(referenceDir, { recursive: true });
          }
          
          if (fs.existsSync(fullOldPath)) {
            fs.renameSync(fullOldPath, referencePath);
            logger.info(`📦 Moved old file to reference: ${oldFilePath}`);
          }
        }
      }

      // Always update updated_at
      updates.push('updated_at = NOW()');

      // Check if there are updates to make
      if (updates.length === 1) { // Only updated_at
        return res.status(400).json({
          success: false,
          message: 'Tidak ada data yang diubah'
        });
      }

      // Add id at the end for WHERE clause
      replacements.push(id);

      // Execute update
      await sequelize.query(`
        UPDATE bankeu_proposals
        SET ${updates.join(', ')}
        WHERE id = ?
      `, { replacements });

      logger.info(`✏️ Bankeu proposal edited: ${id} by user ${userId}`);

      // Activity Log
      ActivityLogger.log({
        userId: userId,
        userName: req.user.name || `User ${userId}`,
        userRole: req.user.role,
        bidangId: 3,
        module: 'bankeu',
        action: 'update',
        entityType: 'bankeu_proposal',
        entityId: parseInt(id),
        entityName: proposal.judul_proposal || `Proposal #${id}`,
        description: `${req.user.name || 'User'} mengedit proposal #${id} (${proposal.nama_desa || 'Desa'})`,
        oldValue: { judul_proposal: proposal.judul_proposal, anggaran_usulan: proposal.anggaran_usulan },
        newValue: { judul_proposal, nama_kegiatan_spesifik, volume, lokasi, anggaran_usulan, file_replaced: !!req.file },
        ipAddress: ActivityLogger.getIpFromRequest(req),
        userAgent: ActivityLogger.getUserAgentFromRequest(req)
      });

      res.json({
        success: true,
        message: 'Proposal berhasil diupdate',
        data: { id: parseInt(id) }
      });
    } catch (error) {
      // Delete uploaded file on error
      if (req.file && req.file.path) {
        try {
          fs.unlinkSync(req.file.path);
        } catch (unlinkError) {
          logger.error('Error deleting file:', unlinkError);
        }
      }

      logger.error('Error editing proposal:', error);
      res.status(500).json({
        success: false,
        message: 'Gagal mengedit proposal',
        error: error.message
      });
    }
  }
}

module.exports = new BankeuProposalController();
