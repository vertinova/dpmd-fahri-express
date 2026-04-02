const { Prisma } = require('@prisma/client');
const prisma = require('../config/prisma');
const bcrypt = require('bcrypt');
const logger = require('../utils/logger');

/**
 * Get all verifikator for a dinas
 */
exports.getAllVerifikator = async (req, res) => {
  try {
    const { dinasId } = req.params;
    const dinasIdInt = parseInt(dinasId);
    
    // Check if table exists first
    const tableExists = await prisma.$queryRaw`
      SELECT COUNT(*) as cnt FROM information_schema.tables 
      WHERE table_schema = DATABASE() AND table_name = 'dinas_verifikator'
    `;
    
    if (!tableExists[0] || tableExists[0].cnt === 0n) {
      // Table doesn't exist, return empty array
      return res.json({
        success: true,
        data: []
      });
    }
    
    const verifikators = await prisma.$queryRaw`
      SELECT 
        dv.id,
        dv.dinas_id,
        dv.user_id,
        dv.nama,
        dv.nip,
        dv.jabatan,
        dv.email,
        dv.is_active,
        dv.created_at,
        u.name as username,
        u.email as user_email,
        u.plain_password
      FROM dinas_verifikator dv
      JOIN users u ON dv.user_id = u.id
      WHERE dv.dinas_id = ${dinasIdInt}
      ORDER BY dv.created_at DESC
    `;
    
    res.json({
      success: true,
      data: verifikators
    });
  } catch (error) {
    logger.error('Error getting verifikators:', error);
    res.status(500).json({
      success: false,
      message: 'Gagal mengambil data verifikator',
      error: error.message
    });
  }
};

/**
 * Create new verifikator account
 */
exports.createVerifikator = async (req, res) => {
  try {
    const { dinasId } = req.params;
    const { nama, nip, jabatan, email, password } = req.body;
    const createdBy = BigInt(req.user.id);
    const dinasIdInt = parseInt(dinasId);

    // Validation
    if (!nama || !jabatan || !email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Nama, jabatan, email, dan password wajib diisi'
      });
    }

    // Check if email already exists
    const existingEmail = await prisma.users.findFirst({
      where: { email }
    });

    if (existingEmail) {
      return res.status(400).json({
        success: false,
        message: 'Email sudah digunakan'
      });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Create user account (use 'name' not 'username')
    const newUser = await prisma.users.create({
      data: {
        name: nama,
        email,
        password: hashedPassword,
        plain_password: password,
        role: 'verifikator_dinas',
        dinas_id: dinasIdInt,
        is_active: true
      }
    });

    // Create verifikator record
    const newUserId = BigInt(newUser.id);
    const nipValue = nip || null;
    const now = new Date();
    const verifikator = await prisma.$executeRaw`
      INSERT INTO dinas_verifikator (dinas_id, user_id, nama, nip, jabatan, email, created_by, created_at, updated_at)
      VALUES (${dinasIdInt}, ${newUserId}, ${nama}, ${nipValue}, ${jabatan}, ${email}, ${createdBy}, ${now}, ${now})
    `;

    logger.info(`Verifikator created: ${nama} (${email}) by user ${createdBy}`);

    res.status(201).json({
      success: true,
      message: 'Verifikator berhasil dibuat',
      data: {
        user_id: newUser.id,
        name: newUser.name,
        nama,
        email
      }
    });
  } catch (error) {
    logger.error('Error creating verifikator:', error);
    res.status(500).json({
      success: false,
      message: 'Gagal membuat verifikator',
      error: error.message
    });
  }
};

/**
 * Update verifikator info
 */
exports.updateVerifikator = async (req, res) => {
  try {
    const { dinasId, verifikatorId } = req.params;
    const { nama, nip, jabatan, email } = req.body;
    const dinasIdInt = parseInt(dinasId);
    const verifikatorIdInt = parseInt(verifikatorId);
    const nipValue = nip || null;

    // Get verifikator to find user_id
    const verifikator = await prisma.$queryRaw`
      SELECT user_id FROM dinas_verifikator 
      WHERE id = ${verifikatorIdInt} AND dinas_id = ${dinasIdInt}
      LIMIT 1
    `;

    if (!verifikator || verifikator.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Verifikator tidak ditemukan'
      });
    }

    const userId = verifikator[0].user_id;

    // Update verifikator info
    await prisma.$executeRaw`
      UPDATE dinas_verifikator 
      SET nama = ${nama}, nip = ${nipValue}, jabatan = ${jabatan}, email = ${email}
      WHERE id = ${verifikatorIdInt}
    `;

    // Update user email and name if changed
    if (email || nama) {
      const updateData = {};
      if (email) updateData.email = email;
      if (nama) updateData.name = nama;
      
      await prisma.users.update({
        where: { id: userId },
        data: updateData
      });
    }

    logger.info(`Verifikator updated: ID ${verifikatorId}`);

    res.json({
      success: true,
      message: 'Verifikator berhasil diupdate'
    });
  } catch (error) {
    logger.error('Error updating verifikator:', error);
    res.status(500).json({
      success: false,
      message: 'Gagal mengupdate verifikator',
      error: error.message
    });
  }
};

/**
 * Toggle verifikator active status
 */
exports.toggleVerifikatorStatus = async (req, res) => {
  try {
    const { dinasId, verifikatorId } = req.params;
    const dinasIdInt = parseInt(dinasId);
    const verifikatorIdInt = parseInt(verifikatorId);

    // Get current status and user_id
    const verifikator = await prisma.$queryRaw`
      SELECT user_id, is_active FROM dinas_verifikator 
      WHERE id = ${verifikatorIdInt} AND dinas_id = ${dinasIdInt}
      LIMIT 1
    `;

    if (!verifikator || verifikator.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Verifikator tidak ditemukan'
      });
    }

    const newStatus = !verifikator[0].is_active;
    const userId = verifikator[0].user_id;

    // Update verifikator status
    await prisma.$executeRaw`
      UPDATE dinas_verifikator 
      SET is_active = ${newStatus}
      WHERE id = ${verifikatorIdInt}
    `;

    // Update user active status too
    await prisma.users.update({
      where: { id: userId },
      data: { is_active: newStatus }
    });

    logger.info(`Verifikator status toggled: ID ${verifikatorId} to ${newStatus}`);

    res.json({
      success: true,
      message: `Verifikator berhasil ${newStatus ? 'diaktifkan' : 'dinonaktifkan'}`,
      data: { is_active: newStatus }
    });
  } catch (error) {
    logger.error('Error toggling verifikator status:', error);
    res.status(500).json({
      success: false,
      message: 'Gagal mengubah status verifikator',
      error: error.message
    });
  }
};

/**
 * Reset verifikator password
 */
exports.resetVerifikatorPassword = async (req, res) => {
  try {
    const { dinasId, verifikatorId } = req.params;
    let { new_password } = req.body || {};
    const dinasIdInt = parseInt(dinasId);
    const verifikatorIdInt = parseInt(verifikatorId);

    // Auto-generate password if not provided
    if (!new_password) {
      new_password = Math.random().toString(36).slice(-8) + Math.random().toString(36).slice(-4).toUpperCase();
    }

    if (new_password.length < 6) {
      return res.status(400).json({
        success: false,
        message: 'Password baru minimal 6 karakter'
      });
    }

    // Get user_id
    const verifikator = await prisma.$queryRaw`
      SELECT user_id FROM dinas_verifikator 
      WHERE id = ${verifikatorIdInt} AND dinas_id = ${dinasIdInt}
      LIMIT 1
    `;

    if (!verifikator || verifikator.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Verifikator tidak ditemukan'
      });
    }

    const userId = verifikator[0].user_id;

    // Hash new password
    const hashedPassword = await bcrypt.hash(new_password, 10);

    // Update password
    await prisma.users.update({
      where: { id: userId },
      data: { 
        password: hashedPassword,
        plain_password: new_password
      }
    });

    logger.info(`Verifikator password created: ID ${verifikatorId}`);

    res.json({
      success: true,
      message: 'Password baru berhasil dibuat',
      data: { newPassword: new_password }
    });
  } catch (error) {
    logger.error('Error resetting verifikator password:', error);
    res.status(500).json({
      success: false,
      message: 'Gagal reset password verifikator',
      error: error.message
    });
  }
};

/**
 * Delete verifikator
 */
exports.deleteVerifikator = async (req, res) => {
  try {
    const { dinasId, verifikatorId } = req.params;
    const dinasIdInt = parseInt(dinasId);
    const verifikatorIdInt = parseInt(verifikatorId);

    // Get user_id before deleting
    const verifikator = await prisma.$queryRaw`
      SELECT user_id FROM dinas_verifikator 
      WHERE id = ${verifikatorIdInt} AND dinas_id = ${dinasIdInt}
      LIMIT 1
    `;

    if (!verifikator || verifikator.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Verifikator tidak ditemukan'
      });
    }

    const userId = verifikator[0].user_id;

    // Delete verifikator record (will cascade to user if needed)
    await prisma.$executeRaw`
      DELETE FROM dinas_verifikator WHERE id = ${verifikatorIdInt}
    `;

    // Delete user account
    await prisma.users.delete({
      where: { id: userId }
    });

    logger.info(`Verifikator deleted: ID ${verifikatorId}, User ID ${userId}`);

    res.json({
      success: true,
      message: 'Verifikator berhasil dihapus'
    });
  } catch (error) {
    logger.error('Error deleting verifikator:', error);
    res.status(500).json({
      success: false,
      message: 'Gagal menghapus verifikator',
      error: error.message
    });
  }
};

/**
 * Get aggregate verification statistics for all verifikators of a dinas
 * Returns per-verifikator stats and overall totals
 */
exports.getVerifikatorStats = async (req, res) => {
  try {
    const { dinasId } = req.params;
    const dinasIdInt = parseInt(dinasId);
    const { tahun } = req.query;
    const tahunFilter = tahun ? parseInt(tahun) : null;

    // Get the dinas info for kode_dinas matching
    const dinas = await prisma.master_dinas.findUnique({
      where: { id: dinasIdInt }
    });

    if (!dinas) {
      return res.status(404).json({
        success: false,
        message: 'Dinas tidak ditemukan'
      });
    }

    const kodeDinasForMatch = dinas.kode_dinas.replace(/_/g, ' ');

    // Get all verifikators for this dinas
    const verifikators = await prisma.dinas_verifikator.findMany({
      where: { dinas_id: dinasIdInt },
      orderBy: { created_at: 'desc' }
    });

    if (verifikators.length === 0) {
      return res.json({
        success: true,
        data: {
          aggregate: { total: 0, pending: 0, in_review: 0, approved: 0, rejected: 0, revision: 0 },
          per_verifikator: [],
          unassigned: { total: 0, pending: 0, in_review: 0, approved: 0, rejected: 0, revision: 0 }
        }
      });
    }

    // Get all verifikator akses desa mappings
    const verifikatorIds = verifikators.map(v => v.id);
    const allAksesDesa = await prisma.verifikator_akses_desa.findMany({
      where: { verifikator_id: { in: verifikatorIds } },
      select: { verifikator_id: true, desa_id: true }
    });

    // Group desa_ids by verifikator
    const desaByVerifikator = {};
    const allAssignedDesaIds = new Set();
    for (const akses of allAksesDesa) {
      const vId = akses.verifikator_id.toString();
      if (!desaByVerifikator[vId]) desaByVerifikator[vId] = [];
      desaByVerifikator[vId].push(akses.desa_id);
      allAssignedDesaIds.add(akses.desa_id);
    }

    // Build per-verifikator stats
    const perVerifikatorStats = [];

    for (const v of verifikators) {
      const vDesaIds = desaByVerifikator[v.id.toString()] || [];
      
      let stats = { total: 0, pending: 0, in_review: 0, approved: 0, rejected: 0, revision: 0 };
      
      if (vDesaIds.length > 0) {
        const result = await prisma.$queryRaw`
          SELECT 
            COUNT(DISTINCT bp.id) as total,
            SUM(CASE WHEN bp.dinas_status IS NULL OR bp.dinas_status = 'pending' THEN 1 ELSE 0 END) as pending,
            SUM(CASE WHEN bp.dinas_status = 'in_review' THEN 1 ELSE 0 END) as in_review,
            SUM(CASE WHEN bp.dinas_status = 'approved' THEN 1 ELSE 0 END) as approved,
            SUM(CASE WHEN bp.dinas_status = 'rejected' THEN 1 ELSE 0 END) as rejected,
            SUM(CASE WHEN bp.dinas_status = 'revision' THEN 1 ELSE 0 END) as revision
          FROM bankeu_proposals bp
          INNER JOIN desas d ON bp.desa_id = d.id
          INNER JOIN bankeu_proposal_kegiatan bpk ON bp.id = bpk.proposal_id
          INNER JOIN bankeu_master_kegiatan bmk ON bpk.kegiatan_id = bmk.id
          WHERE (FIND_IN_SET(${kodeDinasForMatch}, bmk.dinas_terkait) > 0 OR FIND_IN_SET(${dinas.kode_dinas}, bmk.dinas_terkait) > 0)
            AND (bp.submitted_to_dinas_at IS NOT NULL OR bp.dinas_status IS NOT NULL OR bp.kecamatan_status IN ('rejected', 'revision'))
            AND d.status_pemerintahan = 'desa'
            AND bp.desa_id IN (${Prisma.join(vDesaIds)})
            AND (${tahunFilter} IS NULL OR bp.tahun_anggaran = ${tahunFilter})
        `;
        
        if (result[0]) {
          stats = {
            total: Number(result[0].total || 0),
            pending: Number(result[0].pending || 0),
            in_review: Number(result[0].in_review || 0),
            approved: Number(result[0].approved || 0),
            rejected: Number(result[0].rejected || 0),
            revision: Number(result[0].revision || 0)
          };
        }
      }

      perVerifikatorStats.push({
        id: v.id,
        nama: v.nama,
        jabatan: v.jabatan,
        is_active: v.is_active,
        jumlah_desa: vDesaIds.length,
        stats
      });
    }

    // Get stats for unassigned desa (proposals not covered by any verifikator)
    let unassignedStats = { total: 0, pending: 0, in_review: 0, approved: 0, rejected: 0, revision: 0 };
    const allAssignedDesaArray = Array.from(allAssignedDesaIds);

    if (allAssignedDesaArray.length > 0) {
      const unassignedResult = await prisma.$queryRaw`
        SELECT 
          COUNT(DISTINCT bp.id) as total,
          SUM(CASE WHEN bp.dinas_status IS NULL OR bp.dinas_status = 'pending' THEN 1 ELSE 0 END) as pending,
          SUM(CASE WHEN bp.dinas_status = 'in_review' THEN 1 ELSE 0 END) as in_review,
          SUM(CASE WHEN bp.dinas_status = 'approved' THEN 1 ELSE 0 END) as approved,
          SUM(CASE WHEN bp.dinas_status = 'rejected' THEN 1 ELSE 0 END) as rejected,
          SUM(CASE WHEN bp.dinas_status = 'revision' THEN 1 ELSE 0 END) as revision
        FROM bankeu_proposals bp
        INNER JOIN desas d ON bp.desa_id = d.id
        INNER JOIN bankeu_proposal_kegiatan bpk ON bp.id = bpk.proposal_id
        INNER JOIN bankeu_master_kegiatan bmk ON bpk.kegiatan_id = bmk.id
        WHERE (FIND_IN_SET(${kodeDinasForMatch}, bmk.dinas_terkait) > 0 OR FIND_IN_SET(${dinas.kode_dinas}, bmk.dinas_terkait) > 0)
          AND (bp.submitted_to_dinas_at IS NOT NULL OR bp.dinas_status IS NOT NULL OR bp.kecamatan_status IN ('rejected', 'revision'))
          AND d.status_pemerintahan = 'desa'
          AND bp.desa_id NOT IN (${Prisma.join(allAssignedDesaArray)})
          AND (${tahunFilter} IS NULL OR bp.tahun_anggaran = ${tahunFilter})
      `;
      if (unassignedResult[0]) {
        unassignedStats = {
          total: Number(unassignedResult[0].total || 0),
          pending: Number(unassignedResult[0].pending || 0),
          in_review: Number(unassignedResult[0].in_review || 0),
          approved: Number(unassignedResult[0].approved || 0),
          rejected: Number(unassignedResult[0].rejected || 0),
          revision: Number(unassignedResult[0].revision || 0)
        };
      }
    } else {
      // No assigned desa at all → all proposals are "unassigned"
      const allResult = await prisma.$queryRaw`
        SELECT 
          COUNT(DISTINCT bp.id) as total,
          SUM(CASE WHEN bp.dinas_status IS NULL OR bp.dinas_status = 'pending' THEN 1 ELSE 0 END) as pending,
          SUM(CASE WHEN bp.dinas_status = 'in_review' THEN 1 ELSE 0 END) as in_review,
          SUM(CASE WHEN bp.dinas_status = 'approved' THEN 1 ELSE 0 END) as approved,
          SUM(CASE WHEN bp.dinas_status = 'rejected' THEN 1 ELSE 0 END) as rejected,
          SUM(CASE WHEN bp.dinas_status = 'revision' THEN 1 ELSE 0 END) as revision
        FROM bankeu_proposals bp
        INNER JOIN desas d ON bp.desa_id = d.id
        INNER JOIN bankeu_proposal_kegiatan bpk ON bp.id = bpk.proposal_id
        INNER JOIN bankeu_master_kegiatan bmk ON bpk.kegiatan_id = bmk.id
        WHERE (FIND_IN_SET(${kodeDinasForMatch}, bmk.dinas_terkait) > 0 OR FIND_IN_SET(${dinas.kode_dinas}, bmk.dinas_terkait) > 0)
          AND (bp.submitted_to_dinas_at IS NOT NULL OR bp.dinas_status IS NOT NULL OR bp.kecamatan_status IN ('rejected', 'revision'))
          AND d.status_pemerintahan = 'desa'
          AND (${tahunFilter} IS NULL OR bp.tahun_anggaran = ${tahunFilter})
      `;
      if (allResult[0]) {
        unassignedStats = {
          total: Number(allResult[0].total || 0),
          pending: Number(allResult[0].pending || 0),
          in_review: Number(allResult[0].in_review || 0),
          approved: Number(allResult[0].approved || 0),
          rejected: Number(allResult[0].rejected || 0),
          revision: Number(allResult[0].revision || 0)
        };
      }
    }

    // Aggregate: sum of all verifikators + unassigned
    const aggregate = {
      total: unassignedStats.total,
      pending: unassignedStats.pending,
      in_review: unassignedStats.in_review,
      approved: unassignedStats.approved,
      rejected: unassignedStats.rejected,
      revision: unassignedStats.revision
    };
    for (const pv of perVerifikatorStats) {
      aggregate.total += pv.stats.total;
      aggregate.pending += pv.stats.pending;
      aggregate.in_review += pv.stats.in_review;
      aggregate.approved += pv.stats.approved;
      aggregate.rejected += pv.stats.rejected;
      aggregate.revision += pv.stats.revision;
    }

    res.json({
      success: true,
      data: {
        aggregate,
        per_verifikator: perVerifikatorStats,
        unassigned: unassignedStats
      }
    });
  } catch (error) {
    logger.error('Error getting verifikator stats:', error);
    res.status(500).json({
      success: false,
      message: 'Gagal mengambil statistik verifikator',
      error: error.message
    });
  }
};
