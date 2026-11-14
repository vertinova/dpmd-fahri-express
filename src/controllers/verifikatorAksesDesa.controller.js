const { Prisma } = require('@prisma/client');
const prisma = require('../config/prisma');
const logger = require('../utils/logger');
const { saatBentrok } = require('../config/dialek');

/**
 * Get all akses desa for a specific verifikator
 * GET /api/dinas/verifikator/:verifikatorId/akses-desa
 */
exports.getVerifikatorAksesDesa = async (req, res) => {
  try {
    const { verifikatorId } = req.params;
    const { dinas_id } = req.user;

    // Verify verifikator belongs to this dinas
    const verifikator = await prisma.dinas_verifikator.findFirst({
      where: {
        id: BigInt(verifikatorId),
        dinas_id: dinas_id
      }
    });

    if (!verifikator) {
      return res.status(404).json({
        success: false,
        message: 'Verifikator tidak ditemukan atau tidak memiliki akses'
      });
    }

    // Get all akses desa
    const aksesDesa = await prisma.$queryRaw`
      SELECT 
        vad.id,
        vad.verifikator_id,
        vad.desa_id,
        vad.kecamatan_id,
        d.nama as nama_desa,
        d.kode as kode_desa,
        k.nama as nama_kecamatan,
        k.kode as kode_kecamatan,
        vad.created_at
      FROM verifikator_akses_desa vad
      INNER JOIN desas d ON vad.desa_id = d.id
      INNER JOIN kecamatans k ON vad.kecamatan_id = k.id
      WHERE vad.verifikator_id = ${BigInt(verifikatorId)}
      ORDER BY k.nama, d.nama
    `;

    res.json({
      success: true,
      data: aksesDesa
    });
  } catch (error) {
    logger.error('Error getting verifikator akses desa:', error);
    res.status(500).json({
      success: false,
      message: 'Gagal mengambil data akses desa',
      error: error.message
    });
  }
};

/**
 * Add akses desa to verifikator (single or batch)
 * POST /api/dinas/verifikator/:verifikatorId/akses-desa
 */
exports.addVerifikatorAksesDesa = async (req, res) => {
  try {
    const { verifikatorId } = req.params;
    const { dinas_id } = req.user;
    const { desa_ids } = req.body; // array of desa IDs

    if (!Array.isArray(desa_ids) || desa_ids.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'desa_ids harus berupa array dan tidak boleh kosong'
      });
    }

    // Verify verifikator belongs to this dinas
    const verifikator = await prisma.dinas_verifikator.findFirst({
      where: {
        id: BigInt(verifikatorId),
        dinas_id: dinas_id
      }
    });

    if (!verifikator) {
      return res.status(404).json({
        success: false,
        message: 'Verifikator tidak ditemukan'
      });
    }

    // Get desa info (with kecamatan_id)
    const desas = await prisma.desas.findMany({
      where: {
        id: { in: desa_ids.map(id => BigInt(id)) }
      },
      select: {
        id: true,
        kecamatan_id: true,
        nama: true
      }
    });

    if (desas.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Desa tidak ditemukan'
      });
    }

    // Check if any of the desas are already assigned to other verifikators from this dinas
    const conflictingDesas = await prisma.$queryRaw`
      SELECT 
        d.id,
        d.nama as nama_desa,
        dv.nama as nama_verifikator
      FROM verifikator_akses_desa vad
      INNER JOIN desas d ON vad.desa_id = d.id
      INNER JOIN dinas_verifikator dv ON vad.verifikator_id = dv.id
      WHERE vad.desa_id IN (${Prisma.join(desa_ids.map(id => BigInt(id)))})
        AND dv.dinas_id = ${dinas_id}
        AND dv.id != ${BigInt(verifikatorId)}
    `;

    if (conflictingDesas.length > 0) {
      const conflictList = conflictingDesas.map(c => 
        `${c.nama_desa} (sudah diassign ke ${c.nama_verifikator})`
      ).join(', ');
      
      return res.status(400).json({
        success: false,
        message: `Desa berikut sudah memiliki verifikator lain: ${conflictList}`,
        conflicts: conflictingDesas
      });
    }

    // Create akses (use createMany to handle duplicates gracefully)
    const createData = desas.map(desa => ({
      verifikator_id: BigInt(verifikatorId),
      desa_id: desa.id,
      kecamatan_id: desa.kecamatan_id
    }));

    // Insert with ON DUPLICATE KEY UPDATE to avoid errors
    for (const data of createData) {
      await prisma.$executeRaw`
        INSERT INTO verifikator_akses_desa 
          (verifikator_id, desa_id, kecamatan_id, created_at, updated_at)
        VALUES 
          (${data.verifikator_id}, ${data.desa_id}, ${data.kecamatan_id}, NOW(), NOW())
        ${Prisma.raw(saatBentrok(['verifikator_id', 'desa_id'], ['updated_at']))}
      `;
    }

    logger.info(`Added ${desas.length} akses desa for verifikator ${verifikatorId}`);

    res.json({
      success: true,
      message: `Berhasil menambahkan akses ke ${desas.length} desa`,
      data: {
        verifikator_id: verifikatorId,
        added_count: desas.length
      }
    });
  } catch (error) {
    logger.error('Error adding verifikator akses desa:', error);
    res.status(500).json({
      success: false,
      message: 'Gagal menambahkan akses desa',
      error: error.message
    });
  }
};

/**
 * Remove specific akses desa
 * DELETE /api/dinas/verifikator/:verifikatorId/akses-desa/:aksesId
 */
exports.removeVerifikatorAksesDesa = async (req, res) => {
  try {
    const { verifikatorId, aksesId } = req.params;
    const { dinas_id } = req.user;

    // Verify verifikator belongs to this dinas
    const verifikator = await prisma.dinas_verifikator.findFirst({
      where: {
        id: BigInt(verifikatorId),
        dinas_id: dinas_id
      }
    });

    if (!verifikator) {
      return res.status(404).json({
        success: false,
        message: 'Verifikator tidak ditemukan'
      });
    }

    // Delete akses (use deleteMany for compound where)
    await prisma.verifikator_akses_desa.deleteMany({
      where: {
        id: BigInt(aksesId),
        verifikator_id: BigInt(verifikatorId)
      }
    });

    logger.info(`Removed akses desa ${aksesId} for verifikator ${verifikatorId}`);

    res.json({
      success: true,
      message: 'Berhasil menghapus akses desa'
    });
  } catch (error) {
    logger.error('Error removing verifikator akses desa:', error);
    res.status(500).json({
      success: false,
      message: 'Gagal menghapus akses desa',
      error: error.message
    });
  }
};

/**
 * Batch remove akses desa by desa_ids
 * POST /api/dinas/verifikator/:verifikatorId/akses-desa/batch-remove
 */
exports.batchRemoveVerifikatorAksesDesa = async (req, res) => {
  try {
    const { verifikatorId } = req.params;
    const { dinas_id } = req.user;
    const { desa_ids } = req.body;

    if (!Array.isArray(desa_ids) || desa_ids.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'desa_ids harus berupa array dan tidak boleh kosong'
      });
    }

    // Verify verifikator
    const verifikator = await prisma.dinas_verifikator.findFirst({
      where: {
        id: BigInt(verifikatorId),
        dinas_id: dinas_id
      }
    });

    if (!verifikator) {
      return res.status(404).json({
        success: false,
        message: 'Verifikator tidak ditemukan'
      });
    }

    // Delete multiple akses
    const result = await prisma.verifikator_akses_desa.deleteMany({
      where: {
        verifikator_id: BigInt(verifikatorId),
        desa_id: { in: desa_ids.map(id => BigInt(id)) }
      }
    });

    logger.info(`Batch removed ${result.count} akses desa for verifikator ${verifikatorId}`);

    res.json({
      success: true,
      message: `Berhasil menghapus ${result.count} akses desa`,
      data: {
        deleted_count: result.count
      }
    });
  } catch (error) {
    logger.error('Error batch removing verifikator akses desa:', error);
    res.status(500).json({
      success: false,
      message: 'Gagal menghapus akses desa',
      error: error.message
    });
  }
};

/**
 * Get list of available desas (not yet assigned to verifikator)
 * GET /api/dinas/verifikator/:verifikatorId/akses-desa/available
 */
exports.getAvailableDesas = async (req, res) => {
  try {
    const { verifikatorId } = req.params;
    const { dinas_id } = req.user;

    // Verify verifikator
    const verifikator = await prisma.dinas_verifikator.findFirst({
      where: {
        id: BigInt(verifikatorId),
        dinas_id: dinas_id
      }
    });

    if (!verifikator) {
      return res.status(404).json({
        success: false,
        message: 'Verifikator tidak ditemukan'
      });
    }

    // Get desas that are NOT assigned to ANY verifikator from this dinas
    // This prevents conflicts where multiple verifikators have the same desa access
    // Filter: only 'desa' (not kelurahan), exclude Kecamatan Cibinong
    const availableDesas = await prisma.$queryRaw`
      SELECT 
        d.id,
        d.kode,
        d.nama,
        d.kecamatan_id,
        k.nama as nama_kecamatan,
        k.kode as kode_kecamatan
      FROM desas d
      INNER JOIN kecamatans k ON d.kecamatan_id = k.id
      WHERE d.id NOT IN (
        SELECT vad.desa_id 
        FROM verifikator_akses_desa vad
        INNER JOIN dinas_verifikator dv ON vad.verifikator_id = dv.id
        WHERE dv.dinas_id = ${dinas_id}
      )
      AND d.status_pemerintahan = 'desa'
      AND LOWER(k.nama) != 'cibinong'
      ORDER BY k.nama, d.nama
    `;

    res.json({
      success: true,
      data: availableDesas
    });
  } catch (error) {
    logger.error('Error getting available desas:', error);
    res.status(500).json({
      success: false,
      message: 'Gagal mengambil daftar desa tersedia',
      error: error.message
    });
  }
};
