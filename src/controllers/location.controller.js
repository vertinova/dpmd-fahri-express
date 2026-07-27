const prisma = require('../config/prisma');
const logger = require('../utils/logger');

class LocationController {
  
  // GET /api/kecamatans - Get all kecamatans
  async getKecamatans(req, res, next) {
    try {
      logger.info('Fetching all kecamatans');

      const kecamatans = await prisma.kecamatans.findMany({
        orderBy: { nama: 'asc' }
      });

      logger.info(`Found ${kecamatans.length} kecamatans`);

      // Convert BigInt to String for JSON serialization
      const serializedData = kecamatans.map(kec => ({
        ...kec,
        id: kec.id.toString()
      }));

      return res.json({
        success: true,
        data: serializedData
      });

    } catch (error) {
      logger.error('Error getting kecamatans:', error);
      next(error);
    }
  }

  // GET /api/desas - Get all desas
  // ?include_kelurahan=1 untuk ikut menyertakan kelurahan (mis. saat superadmin
  // membuat akun Admin Desa; kelurahan juga punya Admin Desa sendiri).
  // Default tetap hanya desa supaya pemakai lama tidak berubah perilakunya.
  async getDesas(req, res, next) {
    try {
      const includeKelurahan = ['1', 'true', 'yes'].includes(
        String(req.query.include_kelurahan || '').toLowerCase()
      );

      logger.info(`Fetching all desas (${includeKelurahan ? 'termasuk' : 'tanpa'} kelurahan)`);

      const desas = await prisma.desas.findMany({
        where: includeKelurahan ? {} : { status_pemerintahan: 'desa' },
        include: {
          kecamatans: true
        },
        orderBy: { nama: 'asc' }
      });

      logger.info(`Found ${desas.length} desas`);

      // Convert BigInt to String for JSON serialization
      const serializedData = desas.map(desa => ({
        ...desa,
        id: desa.id.toString(),
        kecamatan_id: desa.kecamatan_id.toString(),
        kecamatans: desa.kecamatans ? {
          ...desa.kecamatans,
          id: desa.kecamatans.id.toString()
        } : null
      }));

      return res.json({
        success: true,
        data: serializedData
      });

    } catch (error) {
      logger.error('Error getting desas:', error);
      next(error);
    }
  }

  // GET /api/desas/:id - Get single desa by ID
  async getDesaById(req, res, next) {
    try {
      const { id } = req.params;
      logger.info(`Fetching desa with ID: ${id}`);

      const desa = await prisma.desas.findUnique({
        where: { id: BigInt(id) },
        include: {
          kecamatans: true
        }
      });

      if (!desa) {
        return res.status(404).json({
          success: false,
          message: 'Desa tidak ditemukan'
        });
      }

      logger.info(`Found desa: ${desa.nama}`);

      // Convert BigInt to String for JSON serialization
      const serializedData = {
        ...desa,
        id: desa.id.toString(),
        kecamatan_id: desa.kecamatan_id.toString(),
        kecamatans: desa.kecamatans ? {
          ...desa.kecamatans,
          id: desa.kecamatans.id.toString()
        } : null
      };

      return res.json({
        success: true,
        data: serializedData
      });

    } catch (error) {
      logger.error('Error getting desa by ID:', error);
      next(error);
    }
  }

  // GET /api/desas/kecamatan/:kecamatanId - Get desas by kecamatan
  async getDesasByKecamatan(req, res, next) {
    try {
      const { kecamatanId } = req.params;

      logger.info(`Fetching desas for kecamatan_id: ${kecamatanId}`);

      const desas = await prisma.desas.findMany({
        where: { 
          kecamatan_id: BigInt(kecamatanId),
          status_pemerintahan: 'desa' // Exclude kelurahan
        },
        orderBy: { nama: 'asc' }
      });

      logger.info(`Found ${desas.length} desas for kecamatan_id: ${kecamatanId}`);

      // Convert BigInt to String for JSON serialization
      const serializedData = desas.map(desa => ({
        ...desa,
        id: desa.id.toString(),
        kecamatan_id: desa.kecamatan_id.toString()
      }));

      return res.json({
        success: true,
        data: serializedData
      });

    } catch (error) {
      logger.error('Error getting desas by kecamatan:', error);
      next(error);
    }
  }

}

module.exports = new LocationController();
