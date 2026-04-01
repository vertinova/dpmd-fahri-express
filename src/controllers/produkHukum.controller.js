/**
 * Produk Hukum Controller
 * Handles all produk hukum (legal products) endpoints for desa
 * Converted from Laravel to Express.js with Prisma ORM
 */

const prisma = require('../config/prisma');
const ActivityLogger = require('../utils/activityLogger');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fs = require('fs').promises;

class ProdukHukumController {
  /**
   * Get all produk hukum for authenticated user's desa
   * Supports search and pagination
   */
  async index(req, res) {
    try {
      const { search, all, page = 1, limit = 12, jenis, status_peraturan } = req.query;

      // req.desaId is set by desaContextMiddleware
      // For admin: comes from query parameter (optional - if not provided, show all)
      // For desa: comes from user.desa_id (enforced by middleware - required)
      
      // Build where clause
      const where = {};
      
      // If desaId is provided, filter by desa
      if (req.desaId) {
        where.desa_id = req.desaId;
      }

      // Add search filter if provided
      if (search) {
        where.judul = {
          contains: search
        };
      }

      // Add jenis filter (convert spaces to underscores for enum matching)
      if (jenis) {
        // Support comma-separated jenis for multiple values
        const jenisValues = jenis.split(',').map(j => j.trim().replace(/ /g, '_'));
        if (jenisValues.length === 1) {
          where.jenis = jenisValues[0];
        } else {
          where.jenis = { in: jenisValues };
        }
      }

      // Add status_peraturan filter
      if (status_peraturan) {
        where.status_peraturan = status_peraturan;
      }

      // If 'all' parameter is true, return all data without pagination
      if (all === 'true' || all === '1') {
        const produkHukums = await prisma.produk_hukums.findMany({
          where,
          include: {
            desas: {
              include: {
                kecamatans: true
              }
            }
          },
          orderBy: {
            created_at: 'desc'
          }
        });

        // Transform response to match frontend expectations
        const transformedData = produkHukums.map(item => ({
          ...item,
          desa: item.desas ? {
            id: item.desas.id_desa,
            nama: item.desas.nama_desa,
            kode: item.desas.kode_desa,
            kecamatan: item.desas.kecamatans ? {
              id: item.desas.kecamatans.id_kecamatan,
              nama: item.desas.kecamatans.nama_kecamatan
            } : null
          } : null,
          desas: undefined,  // Remove original desas field
          jenis: item.jenis.replace(/_/g, ' ')  // Convert "Peraturan_Desa" back to "Peraturan Desa"
        }));

        return res.json({
          success: true,
          message: 'Daftar Produk Hukum',
          data: transformedData
        });
      }

      // Pagination
      const skip = (parseInt(page) - 1) * parseInt(limit);
      const [produkHukums, total] = await Promise.all([
        prisma.produk_hukums.findMany({
          where,
          include: {
            desas: {
              include: {
                kecamatans: true
              }
            }
          },
          orderBy: {
            created_at: 'desc'
          },
          skip,
          take: parseInt(limit)
        }),
        prisma.produk_hukums.count({ where })
      ]);

      // Transform response to match frontend expectations
      const transformedData = produkHukums.map(item => ({
        ...item,
        desa: item.desas ? {
          id: item.desas.id_desa,
          nama: item.desas.nama_desa,
          kode: item.desas.kode_desa,
          kecamatan: item.desas.kecamatans ? {
            id: item.desas.kecamatans.id_kecamatan,
            nama: item.desas.kecamatans.nama_kecamatan
          } : null
        } : null,
        desas: undefined,  // Remove original desas field
        jenis: item.jenis.replace(/_/g, ' ')  // Convert "Peraturan_Desa" back to "Peraturan Desa"
      }));

      return res.json({
        success: true,
        message: 'Daftar Produk Hukum',
        data: {
          data: transformedData,
          current_page: parseInt(page),
          per_page: parseInt(limit),
          total,
          last_page: Math.ceil(total / parseInt(limit))
        }
      });
    } catch (error) {
      console.error('Error in index:', error);
      return res.status(500).json({
        success: false,
        message: 'Gagal mengambil data produk hukum',
        error: error.message
      });
    }
  }

  /**
   * Store a new produk hukum
   */
  async store(req, res) {
    try {
      const user = req.user;
      
      // Validate required fields
      const {
        judul,
        nomor,
        tahun,
        jenis,
        singkatan_jenis,
        tempat_penetapan,
        tanggal_penetapan,
        status_peraturan,
        sumber,
        subjek,
        keterangan_status
      } = req.body;

      if (!judul || !nomor || !tahun || !jenis || !singkatan_jenis || 
          !tempat_penetapan || !tanggal_penetapan || !status_peraturan) {
        return res.status(422).json({
          success: false,
          message: 'Semua field wajib harus diisi'
        });
      }

      // Validate file
      if (!req.file) {
        return res.status(422).json({
          success: false,
          message: 'File PDF harus diupload'
        });
      }

      // Validate file type
      if (req.file.mimetype !== 'application/pdf') {
        // Delete uploaded file if wrong type
        await fs.unlink(req.file.path);
        return res.status(422).json({
          success: false,
          message: 'File harus berformat PDF'
        });
      }

      // Convert jenis from "Peraturan Desa" format to "Peraturan_Desa" (Prisma enum format)
      const jenisEnum = jenis.replace(/\s+/g, '_');
      // Convert singkatan_jenis (e.g., "SK KADES" -> "SK_KADES")
      const singkatanJenisEnum = singkatan_jenis.replace(/\s+/g, '_');

      // Create produk hukum
      const produkHukum = await prisma.produk_hukums.create({
        data: {
          id: uuidv4(),
          desa_id: user.desa_id,
          judul,
          nomor,
          tahun: parseInt(tahun),
          jenis: jenisEnum,  // Use converted enum value
          singkatan_jenis: singkatanJenisEnum,
          tempat_penetapan,
          tanggal_penetapan: new Date(tanggal_penetapan),
          status_peraturan,
          sumber: sumber || null,
          subjek: subjek || null,
          keterangan_status: keterangan_status || null,
          file: req.file.filename
        }
      });

      // Log activity
      await ActivityLogger.log({
        userId: user.id,
        userName: user.nama || user.email,
        userRole: user.role,
        bidangId: 6, // Pemdes
        module: 'produk_hukum',
        action: 'create',
        entityType: 'produk_hukum',
        entityId: null, // UUID not BigInt
        entityName: judul,
        description: `${user.nama || user.email} membuat produk hukum baru: ${judul} (${nomor})`,
        newValue: { judul, nomor, tahun, jenis, status_peraturan },
        ipAddress: ActivityLogger.getIpFromRequest(req),
        userAgent: ActivityLogger.getUserAgentFromRequest(req)
      });

      return res.status(201).json({
        success: true,
        message: 'Produk Hukum berhasil ditambahkan',
        data: produkHukum
      });
    } catch (error) {
      console.error('Error in store:', error);
      
      // Delete uploaded file if database insert fails
      if (req.file) {
        try {
          await fs.unlink(req.file.path);
        } catch (unlinkError) {
          console.error('Error deleting file:', unlinkError);
        }
      }

      return res.status(500).json({
        success: false,
        message: 'Produk Hukum gagal ditambahkan',
        error: error.message
      });
    }
  }

  /**
   * Get single produk hukum
   */
  async show(req, res) {
    try {
      const { id } = req.params;

      const produkHukum = await prisma.produk_hukums.findUnique({
        where: { id },
        include: {
          desas: {
            include: {
              kecamatans: true
            }
          }
        }
      });

      if (!produkHukum) {
        return res.status(404).json({
          success: false,
          message: 'Produk Hukum tidak ditemukan'
        });
      }

      // Transform response to match frontend expectations
      const transformedData = {
        ...produkHukum,
        desa: produkHukum.desas ? {
          id: produkHukum.desas.id_desa,
          nama: produkHukum.desas.nama_desa,
          kode: produkHukum.desas.kode_desa,
          kecamatan: produkHukum.desas.kecamatans ? {
            id: produkHukum.desas.kecamatans.id_kecamatan,
            nama: produkHukum.desas.kecamatans.nama_kecamatan
          } : null
        } : null,
        desas: undefined,  // Remove original desas field
        jenis: produkHukum.jenis.replace(/_/g, ' ')  // Convert "Peraturan_Desa" back to "Peraturan Desa"
      };

      return res.json({
        success: true,
        message: 'Detail Produk Hukum',
        data: transformedData
      });
    } catch (error) {
      console.error('Error in show:', error);
      return res.status(500).json({
        success: false,
        message: 'Gagal mengambil detail produk hukum',
        error: error.message
      });
    }
  }

  /**
   * Update produk hukum
   */
  async update(req, res) {
    try {
      const { id } = req.params;

      // Check if produk hukum exists
      const produkHukum = await prisma.produk_hukums.findUnique({
        where: { id }
      });

      if (!produkHukum) {
        return res.status(404).json({
          success: false,
          message: 'Produk Hukum tidak ditemukan'
        });
      }

      // Validate required fields
      const {
        judul,
        nomor,
        tahun,
        jenis,
        singkatan_jenis,
        tempat_penetapan,
        tanggal_penetapan,
        status_peraturan,
        sumber,
        subjek,
        keterangan_status
      } = req.body;

      if (!judul || !nomor || !tahun || !jenis || !singkatan_jenis || 
          !tempat_penetapan || !tanggal_penetapan || !status_peraturan) {
        return res.status(422).json({
          success: false,
          message: 'Semua field wajib harus diisi'
        });
      }

      // Prepare update data
      const updateData = {
        judul,
        nomor,
        tahun: parseInt(tahun),
        jenis: jenis.replace(/\s+/g, '_'),  // Convert "Peraturan Desa" to "Peraturan_Desa"
        singkatan_jenis: singkatan_jenis.replace(/\s+/g, '_'),  // Convert "SK KADES" to "SK_KADES"
        tempat_penetapan,
        tanggal_penetapan: new Date(tanggal_penetapan),
        status_peraturan,
        sumber: sumber || null,
        subjek: subjek || null,
        keterangan_status: keterangan_status || null
      };

      // Handle file upload if new file provided
      if (req.file) {
        // Validate file type
        if (req.file.mimetype !== 'application/pdf') {
          await fs.unlink(req.file.path);
          return res.status(422).json({
            success: false,
            message: 'File harus berformat PDF'
          });
        }

        // Delete old file
        if (produkHukum.file) {
          const oldFilePath = path.join(__dirname, '../../storage/produk_hukum', produkHukum.file);
          try {
            await fs.unlink(oldFilePath);
          } catch (error) {
            console.error('Error deleting old file:', error);
          }
        }

        updateData.file = req.file.filename;
      }

      // Update database
      const updatedProdukHukum = await prisma.produk_hukums.update({
        where: { id },
        data: updateData
      });

      // Log activity
      await ActivityLogger.log({
        userId: req.user.id,
        userName: req.user.nama || req.user.email,
        userRole: req.user.role,
        bidangId: 6, // Pemdes
        module: 'produk_hukum',
        action: 'update',
        entityType: 'produk_hukum',
        entityId: null,
        entityName: judul,
        description: `${req.user.nama || req.user.email} mengupdate produk hukum: ${judul}`,
        oldValue: { judul: produkHukum.judul, nomor: produkHukum.nomor },
        newValue: { judul, nomor, tahun, jenis, status_peraturan },
        ipAddress: ActivityLogger.getIpFromRequest(req),
        userAgent: ActivityLogger.getUserAgentFromRequest(req)
      });

      return res.json({
        success: true,
        message: 'Produk Hukum berhasil diupdate',
        data: updatedProdukHukum
      });
    } catch (error) {
      console.error('Error in update:', error);

      // Delete uploaded file if database update fails
      if (req.file) {
        try {
          await fs.unlink(req.file.path);
        } catch (unlinkError) {
          console.error('Error deleting file:', unlinkError);
        }
      }

      return res.status(500).json({
        success: false,
        message: 'Produk Hukum gagal diupdate',
        error: error.message
      });
    }
  }

  /**
   * Delete produk hukum
   */
  async destroy(req, res) {
    try {
      const { id } = req.params;

      const produkHukum = await prisma.produk_hukums.findUnique({
        where: { id }
      });

      if (!produkHukum) {
        return res.status(404).json({
          success: false,
          message: 'Produk Hukum tidak ditemukan'
        });
      }

      // Delete file
      if (produkHukum.file) {
        const filePath = path.join(__dirname, '../../storage/produk_hukum', produkHukum.file);
        try {
          await fs.unlink(filePath);
        } catch (error) {
          console.error('Error deleting file:', error);
        }
      }

      // Delete from database
      await prisma.produk_hukums.delete({
        where: { id }
      });

      // Log activity
      await ActivityLogger.log({
        userId: req.user.id,
        userName: req.user.nama || req.user.email,
        userRole: req.user.role,
        bidangId: 6, // Pemdes
        module: 'produk_hukum',
        action: 'delete',
        entityType: 'produk_hukum',
        entityId: null,
        entityName: produkHukum.judul,
        description: `${req.user.nama || req.user.email} menghapus produk hukum: ${produkHukum.judul}`,
        oldValue: { judul: produkHukum.judul, nomor: produkHukum.nomor },
        ipAddress: ActivityLogger.getIpFromRequest(req),
        userAgent: ActivityLogger.getUserAgentFromRequest(req)
      });

      return res.json({
        success: true,
        message: 'Produk Hukum berhasil dihapus'
      });
    } catch (error) {
      console.error('Error in destroy:', error);
      return res.status(500).json({
        success: false,
        message: 'Produk Hukum gagal dihapus',
        error: error.message
      });
    }
  }

  /**
   * Update status of produk hukum
   */
  async updateStatus(req, res) {
    try {
      const { id } = req.params;
      const { status_peraturan } = req.body;

      // Validate status
      if (!['berlaku', 'dicabut'].includes(status_peraturan)) {
        return res.status(422).json({
          success: false,
          message: 'Status harus "berlaku" atau "dicabut"'
        });
      }

      const produkHukum = await prisma.produk_hukums.findUnique({
        where: { id }
      });

      if (!produkHukum) {
        return res.status(404).json({
          success: false,
          message: 'Produk Hukum tidak ditemukan'
        });
      }

      // Update status
      const updated = await prisma.produk_hukums.update({
        where: { id },
        data: { status_peraturan }
      });

      return res.json({
        success: true,
        message: 'Status Produk Hukum berhasil diupdate',
        data: updated
      });
    } catch (error) {
      console.error('Error in updateStatus:', error);
      return res.status(500).json({
        success: false,
        message: 'Gagal mengupdate status',
        error: error.message
      });
    }
  }

  /**
   * Download PDF file of produk hukum
   */
  async download(req, res) {
    try {
      const { id } = req.params;

      // Get produk hukum from database
      const produkHukum = await prisma.produk_hukums.findUnique({
        where: { id }
      });

      if (!produkHukum) {
        return res.status(404).json({
          success: false,
          message: 'Produk Hukum tidak ditemukan'
        });
      }

      if (!produkHukum.file) {
        return res.status(404).json({
          success: false,
          message: 'File PDF tidak ditemukan'
        });
      }

      // Construct file path
      const filePath = path.join(__dirname, '../../storage/produk_hukum', produkHukum.file);

      // Check if file exists
      try {
        await fs.access(filePath);
      } catch (error) {
        return res.status(404).json({
          success: false,
          message: 'File tidak ditemukan di server'
        });
      }

      // Send file
      return res.sendFile(filePath);
    } catch (error) {
      console.error('Error in download:', error);
      return res.status(500).json({
        success: false,
        message: 'Gagal mengunduh file',
        error: error.message
      });
    }
  }
}

module.exports = new ProdukHukumController();
