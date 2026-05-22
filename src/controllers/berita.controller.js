// src/controllers/berita.controller.js
const Berita = require('../models/Berita');
const { Op } = require('sequelize');
const fs = require('fs');
const path = require('path');
const ActivityLogger = require('../utils/activityLogger');

const BERITA_UPLOAD_DIR = path.join(__dirname, '../../storage/uploads/berita');

const generateSlug = (text) => {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
};

const getUploadedBeritaFile = (req, fieldName) => req.files?.[fieldName]?.[0] || null;

const deleteBeritaFile = (filename) => {
  if (!filename) return;

  const filePath = path.join(BERITA_UPLOAD_DIR, filename);
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }
};

const cleanupUploadedBeritaFiles = (req) => {
  Object.values(req.files || {}).flat().forEach((file) => {
    deleteBeritaFile(file.filename);
  });
};

exports.getAllBerita = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 10,
      kategori,
      status = 'published',
      search
    } = req.query;

    const offset = (page - 1) * limit;
    const whereClause = { status };

    if (kategori) {
      whereClause.kategori = kategori;
    }

    if (search) {
      whereClause[Op.or] = [
        { judul: { [Op.like]: `%${search}%` } },
        { ringkasan: { [Op.like]: `%${search}%` } },
        { konten: { [Op.like]: `%${search}%` } }
      ];
    }

    const { count, rows } = await Berita.findAndCountAll({
      where: whereClause,
      limit: parseInt(limit),
      offset: parseInt(offset),
      order: [['tanggal_publish', 'DESC'], ['created_at', 'DESC']]
    });

    res.status(200).json({
      status: 'success',
      data: rows,
      pagination: {
        total: count,
        current_page: parseInt(page),
        last_page: Math.ceil(count / limit),
        limit: parseInt(limit)
      }
    });
  } catch (error) {
    console.error('Error fetching berita:', error);
    res.status(500).json({
      status: 'error',
      message: 'Gagal mengambil data berita',
      error: error.message
    });
  }
};

exports.getBeritaTerbaru = async (req, res) => {
  try {
    const { limit = 6 } = req.query;

    const berita = await Berita.findAll({
      where: { status: 'published' },
      limit: parseInt(limit),
      order: [['tanggal_publish', 'DESC'], ['created_at', 'DESC']]
    });

    res.status(200).json({
      status: 'success',
      data: berita
    });
  } catch (error) {
    console.error('Error fetching berita terbaru:', error);
    res.status(500).json({
      status: 'error',
      message: 'Gagal mengambil berita terbaru',
      error: error.message
    });
  }
};

exports.getBeritaBySlug = async (req, res) => {
  try {
    const { slug } = req.params;

    const berita = await Berita.findOne({
      where: { slug, status: 'published' }
    });

    if (!berita) {
      return res.status(404).json({
        status: 'error',
        message: 'Berita tidak ditemukan'
      });
    }

    await berita.increment('views');

    res.status(200).json({
      status: 'success',
      data: berita
    });
  } catch (error) {
    console.error('Error fetching berita by slug:', error);
    res.status(500).json({
      status: 'error',
      message: 'Gagal mengambil detail berita',
      error: error.message
    });
  }
};

exports.getAllBeritaAdmin = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 10,
      kategori,
      status,
      search
    } = req.query;

    const offset = (page - 1) * limit;
    const whereClause = {};

    if (kategori) {
      whereClause.kategori = kategori;
    }

    if (status) {
      whereClause.status = status;
    }

    if (search) {
      whereClause[Op.or] = [
        { judul: { [Op.like]: `%${search}%` } },
        { ringkasan: { [Op.like]: `%${search}%` } }
      ];
    }

    const { count, rows } = await Berita.findAndCountAll({
      where: whereClause,
      limit: parseInt(limit),
      offset: parseInt(offset),
      order: [['created_at', 'DESC']]
    });

    res.status(200).json({
      status: 'success',
      data: rows,
      pagination: {
        total: count,
        current_page: parseInt(page),
        last_page: Math.ceil(count / limit),
        limit: parseInt(limit)
      }
    });
  } catch (error) {
    console.error('[BeritaAdmin] Error fetching berita admin:', error);
    res.status(500).json({
      status: 'error',
      message: 'Gagal mengambil data berita',
      error: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
};

exports.createBerita = async (req, res) => {
  try {
    const { judul, konten, ringkasan, kategori, status, penulis } = req.body;
    const imageFile = getUploadedBeritaFile(req, 'gambar');
    const pdfFile = getUploadedBeritaFile(req, 'dokumen_pdf');

    if (!judul || (!konten && !pdfFile)) {
      return res.status(400).json({
        status: 'error',
        message: 'Judul harus diisi, lalu isi konten atau upload PDF berita'
      });
    }

    let slug = generateSlug(judul);
    const existingBerita = await Berita.findOne({ where: { slug } });
    if (existingBerita) {
      slug = `${slug}-${Date.now()}`;
    }

    const gambar = imageFile ? imageFile.filename : null;
    const dokumen_pdf = pdfFile ? pdfFile.filename : null;
    const tanggal_publish = status === 'published' ? new Date() : null;

    const berita = await Berita.create({
      judul,
      slug,
      konten: konten || 'Dokumen berita tersedia dalam lampiran PDF.',
      ringkasan,
      gambar,
      dokumen_pdf,
      kategori: kategori || 'umum',
      status: status || 'draft',
      tanggal_publish,
      penulis
    });

    await ActivityLogger.log({
      userId: req.user?.id,
      userName: req.user?.name || penulis || 'Admin',
      userRole: req.user?.role || 'admin',
      bidangId: 2,
      module: 'berita',
      action: 'create',
      entityType: 'berita',
      entityId: berita.id_berita,
      entityName: judul,
      description: `${req.user?.name || penulis || 'Admin'} membuat berita baru: ${judul}`,
      newValue: { judul, status, kategori, dokumen_pdf },
      ipAddress: ActivityLogger.getIpFromRequest(req),
      userAgent: ActivityLogger.getUserAgentFromRequest(req)
    });

    res.status(201).json({
      status: 'success',
      message: 'Berita berhasil dibuat',
      data: berita
    });
  } catch (error) {
    console.error('[CreateBerita] Error:', error);
    cleanupUploadedBeritaFiles(req);

    res.status(500).json({
      status: 'error',
      message: 'Gagal membuat berita',
      error: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
};

exports.updateBerita = async (req, res) => {
  try {
    const { id } = req.params;
    const { judul, konten, ringkasan, kategori, status, penulis } = req.body;
    const imageFile = getUploadedBeritaFile(req, 'gambar');
    const pdfFile = getUploadedBeritaFile(req, 'dokumen_pdf');

    const berita = await Berita.findByPk(id);

    if (!berita) {
      cleanupUploadedBeritaFiles(req);
      return res.status(404).json({
        status: 'error',
        message: 'Berita tidak ditemukan'
      });
    }

    let slug = berita.slug;
    if (judul && judul !== berita.judul) {
      slug = generateSlug(judul);

      const existingBerita = await Berita.findOne({
        where: {
          slug,
          id_berita: { [Op.ne]: id }
        }
      });

      if (existingBerita) {
        slug = `${slug}-${Date.now()}`;
      }
    }

    if (imageFile) {
      deleteBeritaFile(berita.gambar);
      berita.gambar = imageFile.filename;
    }

    if (pdfFile) {
      deleteBeritaFile(berita.dokumen_pdf);
      berita.dokumen_pdf = pdfFile.filename;
    }

    if (status === 'published' && berita.status !== 'published' && !berita.tanggal_publish) {
      berita.tanggal_publish = new Date();
    }

    if (judul) berita.judul = judul;
    if (slug) berita.slug = slug;
    if (konten !== undefined && (konten || berita.dokumen_pdf)) {
      berita.konten = konten || 'Dokumen berita tersedia dalam lampiran PDF.';
    }
    if (ringkasan !== undefined) berita.ringkasan = ringkasan;
    if (kategori) berita.kategori = kategori;
    if (status) berita.status = status;
    if (penulis !== undefined) berita.penulis = penulis;
    berita.updated_at = new Date();

    await berita.save();

    await ActivityLogger.log({
      userId: req.user?.id,
      userName: req.user?.name || 'Admin',
      userRole: req.user?.role || 'admin',
      bidangId: 2,
      module: 'berita',
      action: 'update',
      entityType: 'berita',
      entityId: berita.id_berita,
      entityName: berita.judul,
      description: `${req.user?.name || 'Admin'} memperbarui berita: ${berita.judul}`,
      newValue: {
        judul: berita.judul,
        status: berita.status,
        kategori: berita.kategori,
        dokumen_pdf: berita.dokumen_pdf
      },
      ipAddress: ActivityLogger.getIpFromRequest(req),
      userAgent: ActivityLogger.getUserAgentFromRequest(req)
    });

    res.status(200).json({
      status: 'success',
      message: 'Berita berhasil diupdate',
      data: berita
    });
  } catch (error) {
    console.error('Error updating berita:', error);
    cleanupUploadedBeritaFiles(req);

    res.status(500).json({
      status: 'error',
      message: 'Gagal mengupdate berita',
      error: error.message
    });
  }
};

exports.deleteBerita = async (req, res) => {
  try {
    const { id } = req.params;

    const berita = await Berita.findByPk(id);

    if (!berita) {
      return res.status(404).json({
        status: 'error',
        message: 'Berita tidak ditemukan'
      });
    }

    deleteBeritaFile(berita.gambar);
    deleteBeritaFile(berita.dokumen_pdf);

    const beritaJudul = berita.judul;
    const beritaId = berita.id_berita;

    await berita.destroy();

    await ActivityLogger.log({
      userId: req.user?.id,
      userName: req.user?.name || 'Admin',
      userRole: req.user?.role || 'admin',
      bidangId: 2,
      module: 'berita',
      action: 'delete',
      entityType: 'berita',
      entityId: beritaId,
      entityName: beritaJudul,
      description: `${req.user?.name || 'Admin'} menghapus berita: ${beritaJudul}`,
      oldValue: { judul: beritaJudul },
      ipAddress: ActivityLogger.getIpFromRequest(req),
      userAgent: ActivityLogger.getUserAgentFromRequest(req)
    });

    res.status(200).json({
      status: 'success',
      message: 'Berita berhasil dihapus'
    });
  } catch (error) {
    console.error('Error deleting berita:', error);
    res.status(500).json({
      status: 'error',
      message: 'Gagal menghapus berita',
      error: error.message
    });
  }
};

exports.getBeritaStats = async (req, res) => {
  try {
    const totalBerita = await Berita.count();
    const publishedBerita = await Berita.count({ where: { status: 'published' } });
    const draftBerita = await Berita.count({ where: { status: 'draft' } });
    const withPdf = await Berita.count({
      where: {
        dokumen_pdf: { [Op.ne]: null }
      }
    });

    const beritaByKategori = await Berita.findAll({
      attributes: [
        'kategori',
        [Berita.sequelize.fn('COUNT', Berita.sequelize.col('id_berita')), 'total']
      ],
      where: { status: 'published' },
      group: ['kategori']
    });

    res.status(200).json({
      status: 'success',
      data: {
        total_berita: totalBerita,
        published: publishedBerita,
        draft: draftBerita,
        with_pdf: withPdf,
        by_kategori: beritaByKategori
      }
    });
  } catch (error) {
    console.error('Error fetching berita stats:', error);
    res.status(500).json({
      status: 'error',
      message: 'Gagal mengambil statistik berita',
      error: error.message
    });
  }
};
