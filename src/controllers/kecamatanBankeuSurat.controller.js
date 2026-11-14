// Controller untuk Kecamatan review Surat Pengantar & Surat Permohonan dari Desa
const sequelize = require('../config/database');
const { jumlah, urutNull, enumTeks } = require('../config/dialek');
const logger = require('../utils/logger');
const fs = require('fs');
const path = require('path');

/**
 * GET all surat bundles from all desas in kecamatan
 * Setiap bundle berisi: surat pengantar, surat permohonan, dan semua proposals
 */
exports.getAllDesaSurat = async (req, res) => {
  try {
    const { kecamatan_id } = req.user;
    const { tahun = 2027, status } = req.query;

    if (!kecamatan_id) {
      return res.status(403).json({
        success: false,
        message: 'User tidak memiliki akses kecamatan'
      });
    }

    // Build WHERE clause
    let whereConditions = [
      'dbs.tahun = ?',
      'd.kecamatan_id = ?',
      'dbs.submitted_to_kecamatan = TRUE'
    ];
    let params = [tahun, kecamatan_id];

    if (status) {
      whereConditions.push(`${enumTeks('dbs.kecamatan_status')} = ?`);
      params.push(status);
    }

    // Get surat bundles
    const suratQuery = `
      SELECT 
        dbs.*,
        d.nama AS nama_desa,
        d.kode AS kode_desa,
        k.nama AS kecamatan_name,
        u.name AS reviewer_name
      FROM desa_bankeu_surat dbs
      INNER JOIN desas d ON dbs.desa_id = d.id
      LEFT JOIN kecamatans k ON d.kecamatan_id = k.id
      LEFT JOIN users u ON dbs.kecamatan_reviewed_by = u.id
      WHERE ${whereConditions.join(' AND ')}
      ORDER BY ${urutNull('dbs.submitted_at', 'DESC')}, d.nama ASC
    `;

    const suratList = await sequelize.query(suratQuery, {
      replacements: params,
      type: sequelize.QueryTypes.SELECT
    });

    // Get proposals for each surat bundle
    const bundleList = await Promise.all(suratList.map(async (surat) => {
      const proposalsQuery = `
        SELECT 
          bp.id,
          bp.judul_proposal,
          bp.nama_kegiatan_spesifik,
          bp.volume,
          bp.lokasi,
          bp.anggaran_usulan,
          bp.file_proposal,
          bp.status,
          bp.kecamatan_status,
          bp.kecamatan_catatan,
          bp.created_at
        FROM bankeu_proposals bp
        WHERE bp.desa_id = ? 
          AND EXTRACT(YEAR FROM bp.created_at) = ?
          AND bp.submitted_to_kecamatan = TRUE
        ORDER BY bp.created_at DESC
      `;
      
      const proposals = await sequelize.query(proposalsQuery, {
        replacements: [surat.desa_id, surat.tahun],
        type: sequelize.QueryTypes.SELECT
      });

      return {
        ...surat,
        proposals,
        total_proposals: proposals.length,
        total_anggaran: proposals.reduce((sum, p) => sum + (parseFloat(p.anggaran_usulan) || 0), 0)
      };
    }));

    logger.info(`Kecamatan ${kecamatan_id} fetched ${bundleList.length} desa bundles (tahun=${tahun}, status=${status || 'all'})`);

    res.json({
      success: true,
      data: bundleList,
      meta: {
        total: bundleList.length,
        tahun,
        status: status || 'all'
      }
    });

  } catch (error) {
    logger.error('Error fetching desa surat bundles for kecamatan:', error);
    res.status(500).json({
      success: false,
      message: 'Gagal memuat data bundle desa',
      error: error.message
    });
  }
};

/**
 * GET single desa surat detail
 */
exports.getDesaSuratDetail = async (req, res) => {
  try {
    const { id } = req.params;
    const { kecamatan_id } = req.user;

    const query = `
      SELECT 
        dbs.*,
        d.nama AS nama_desa,
        d.kode AS kode_desa,
        d.kecamatan_id,
        k.nama AS kecamatan_name,
        u.name AS reviewer_name
      FROM desa_bankeu_surat dbs
      INNER JOIN desas d ON dbs.desa_id = d.id
      LEFT JOIN kecamatans k ON d.kecamatan_id = k.id
      LEFT JOIN users u ON dbs.kecamatan_reviewed_by = u.id
      WHERE dbs.id = ? AND d.kecamatan_id = ?
    `;

    const [surat] = await sequelize.query(query, {
      replacements: [id, kecamatan_id],
      type: sequelize.QueryTypes.SELECT
    });

    if (!surat) {
      return res.status(404).json({
        success: false,
        message: 'Surat tidak ditemukan atau bukan bagian dari kecamatan Anda'
      });
    }

    res.json({
      success: true,
      data: surat
    });

  } catch (error) {
    logger.error('Error fetching desa surat detail:', error);
    res.status(500).json({
      success: false,
      message: 'Gagal memuat detail surat',
      error: error.message
    });
  }
};

/**
 * POST review surat (approve or reject)
 */
exports.reviewSurat = async (req, res) => {
  try {
    const { id } = req.params;
    const { status, catatan } = req.body;
    const { kecamatan_id, id: reviewer_id } = req.user;

    // Validasi status
    if (!['approved', 'rejected'].includes(status)) {
      return res.status(400).json({
        success: false,
        message: 'Status harus "approved" atau "rejected"'
      });
    }

    // Validasi catatan wajib jika reject
    if (status === 'rejected' && (!catatan || catatan.trim() === '')) {
      return res.status(400).json({
        success: false,
        message: 'Catatan wajib diisi jika status rejected'
      });
    }

    // Check apakah surat ada dan milik kecamatan ini
    const checkQuery = `
      SELECT dbs.*, d.nama AS nama_desa, d.kecamatan_id
      FROM desa_bankeu_surat dbs
      INNER JOIN desas d ON dbs.desa_id = d.id
      WHERE dbs.id = ? AND d.kecamatan_id = ?
    `;

    const [surat] = await sequelize.query(checkQuery, {
      replacements: [id, kecamatan_id],
      type: sequelize.QueryTypes.SELECT
    });

    if (!surat) {
      return res.status(404).json({
        success: false,
        message: 'Surat tidak ditemukan atau bukan bagian dari kecamatan Anda'
      });
    }

    // Check apakah surat sudah direview
    if (surat.kecamatan_status !== 'pending') {
      return res.status(400).json({
        success: false,
        message: `Surat sudah di-${surat.kecamatan_status} sebelumnya`
      });
    }

    // Jika reject, reset submitted_to_kecamatan dan hapus file surat agar desa wajib upload ulang
    const resetSubmitted = status === 'rejected';

    // Jika reject, hapus file surat yang ada
    if (resetSubmitted) {
      const uploadDir = path.join(__dirname, '../../storage/uploads/bankeu');
      
      // Hapus surat pengantar
      if (surat.surat_pengantar) {
        const pengantarPath = path.join(uploadDir, surat.surat_pengantar);
        if (fs.existsSync(pengantarPath)) {
          fs.unlinkSync(pengantarPath);
          logger.info(`🗑️ Deleted surat pengantar: ${surat.surat_pengantar}`);
        }
      }
      
      // Hapus surat permohonan
      if (surat.surat_permohonan) {
        const permohonanPath = path.join(uploadDir, surat.surat_permohonan);
        if (fs.existsSync(permohonanPath)) {
          fs.unlinkSync(permohonanPath);
          logger.info(`🗑️ Deleted surat permohonan: ${surat.surat_permohonan}`);
        }
      }
    }

    // Update query - jika reject, reset juga surat_pengantar dan surat_permohonan ke NULL
    const updateQuery = resetSubmitted 
      ? `
        UPDATE desa_bankeu_surat
        SET 
          kecamatan_status = ?,
          kecamatan_reviewed_by = ?,
          kecamatan_reviewed_at = NOW(),
          kecamatan_catatan = ?,
          submitted_to_kecamatan = FALSE,
          surat_pengantar = NULL,
          surat_permohonan = NULL
        WHERE id = ?
      `
      : `
        UPDATE desa_bankeu_surat
        SET 
          kecamatan_status = ?,
          kecamatan_reviewed_by = ?,
          kecamatan_reviewed_at = NOW(),
          kecamatan_catatan = ?,
          submitted_to_kecamatan = TRUE
        WHERE id = ?
      `;

    await sequelize.query(updateQuery, {
      replacements: [
        status,
        reviewer_id,
        catatan || null,
        id
      ]
    });

    logger.info(`Kecamatan user ${reviewer_id} ${status} surat desa ID ${id} (Desa: ${surat.nama_desa})`);

    res.json({
      success: true,
      message: `Surat berhasil di-${status === 'approved' ? 'approve' : 'reject'}`,
      data: {
        id,
        status,
        reviewed_by: reviewer_id,
        reviewed_at: new Date(),
        catatan,
        desa_name: surat.nama_desa,
        can_reupload: resetSubmitted
      }
    });

  } catch (error) {
    logger.error('Error reviewing desa surat:', error);
    res.status(500).json({
      success: false,
      message: 'Gagal melakukan review surat',
      error: error.message
    });
  }
};

/**
 * GET statistics surat for kecamatan dashboard
 */
exports.getSuratStatistics = async (req, res) => {
  try {
    const { kecamatan_id } = req.user;
    const { tahun = 2027 } = req.query;

    const query = `
      SELECT 
        COUNT(*) as total_surat,
        ${jumlah("CASE WHEN kecamatan_status = 'pending' THEN 1 ELSE 0 END")} as pending,
        ${jumlah("CASE WHEN kecamatan_status = 'approved' THEN 1 ELSE 0 END")} as approved,
        ${jumlah("CASE WHEN kecamatan_status = 'rejected' THEN 1 ELSE 0 END")} as rejected,
        ${jumlah("CASE WHEN submitted_to_kecamatan = TRUE AND kecamatan_status = 'pending' THEN 1 ELSE 0 END")} as menunggu_review
      FROM desa_bankeu_surat dbs
      INNER JOIN desas d ON dbs.desa_id = d.id
      WHERE d.kecamatan_id = ? AND dbs.tahun = ? AND dbs.submitted_to_kecamatan = TRUE
    `;

    const [stats] = await sequelize.query(query, {
      replacements: [kecamatan_id, tahun],
      type: sequelize.QueryTypes.SELECT
    });

    res.json({
      success: true,
      data: {
        ...stats,
        tahun
      }
    });

  } catch (error) {
    logger.error('Error fetching surat statistics:', error);
    res.status(500).json({
      success: false,
      message: 'Gagal memuat statistik surat',
      error: error.message
    });
  }
};
