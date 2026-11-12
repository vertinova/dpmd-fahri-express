// src/controllers/berita.controller.js
const prisma = require('../config/prisma');
const fs = require('fs');
const path = require('path');
const ActivityLogger = require('../utils/activityLogger');

const BERITA_UPLOAD_DIR = path.join(__dirname, '../../storage/uploads/berita');

const STATUS_BERITA = ['draft', 'published', 'archived'];
const KATEGORI_BERITA = ['umum', 'bumdes', 'perjadin', 'musdesus', 'pengumuman'];

const urutanPublik = [{ tanggal_publish: 'desc' }, { created_at: 'desc' }];

// Filter enum yang tidak dikenal harus menghasilkan daftar kosong (seperti SQL biasa), bukan galat Prisma.
const cocokEnum = (nilai, daftar) => (daftar.includes(nilai) ? nilai : { in: [] });

// Meniru validasi model Sequelize lama: tiap galat berpesan "Validation error: ...", digabung ",\n".
const validasiBerita = ({ judul, slug, konten }) => {
  const pesan = [];
  if (judul !== undefined) {
    if (/^\s*$/.test(judul)) pesan.push('Judul tidak boleh kosong');
    if (judul.length < 5 || judul.length > 255) pesan.push('Judul harus antara 5-255 karakter');
  }
  if (slug !== undefined && /^\s*$/.test(slug)) pesan.push('Slug tidak boleh kosong');
  if (konten !== undefined && /^\s*$/.test(konten)) pesan.push('Konten tidak boleh kosong');
  if (pesan.length) throw new Error(pesan.map((m) => `Validation error: ${m}`).join(',\n'));
};

// Meniru galat MySQL strict-mode yang dulu muncul lewat Sequelize (pesan dipakai klien apa adanya).
const cekKolomDb = ({ kategori, status, ringkasan, penulis }) => {
  if (kategori !== undefined && !KATEGORI_BERITA.includes(kategori)) throw new Error("Data truncated for column 'kategori' at row 1");
  if (status !== undefined && !STATUS_BERITA.includes(status)) throw new Error("Data truncated for column 'status' at row 1");
  if (typeof ringkasan === 'string' && ringkasan.length > 500) throw new Error("Data too long for column 'ringkasan' at row 1");
  if (typeof penulis === 'string' && penulis.length > 100) throw new Error("Data too long for column 'penulis' at row 1");
};

// Meniru findByPk Sequelize: id non-numerik dianggap tidak ditemukan.
const cariBeritaById = (id) => {
  const idNum = parseInt(id);
  return Number.isNaN(idNum) ? null : prisma.berita.findUnique({ where: { id_berita: idNum } });
};

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
    const whereClause = { status: cocokEnum(status, STATUS_BERITA) };

    if (kategori) {
      whereClause.kategori = cocokEnum(kategori, KATEGORI_BERITA);
    }

    if (search) {
      whereClause.OR = [
        { judul: { contains: search } },
        { ringkasan: { contains: search } },
        { konten: { contains: search } }
      ];
    }

    const [count, rows] = await Promise.all([
      prisma.berita.count({ where: whereClause }),
      prisma.berita.findMany({
        where: whereClause,
        take: parseInt(limit),
        skip: parseInt(offset),
        orderBy: urutanPublik
      })
    ]);

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

    const berita = await prisma.berita.findMany({
      where: { status: 'published' },
      take: parseInt(limit),
      orderBy: urutanPublik
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

    const berita = await prisma.berita.findFirst({
      where: { slug, status: 'published' }
    });

    if (!berita) {
      return res.status(404).json({
        status: 'error',
        message: 'Berita tidak ditemukan'
      });
    }

    await prisma.berita.update({
      where: { id_berita: berita.id_berita },
      data: { views: { increment: 1 } }
    });

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
      whereClause.kategori = cocokEnum(kategori, KATEGORI_BERITA);
    }

    if (status) {
      whereClause.status = cocokEnum(status, STATUS_BERITA);
    }

    if (search) {
      whereClause.OR = [
        { judul: { contains: search } },
        { ringkasan: { contains: search } }
      ];
    }

    const [count, rows] = await Promise.all([
      prisma.berita.count({ where: whereClause }),
      prisma.berita.findMany({
        where: whereClause,
        take: parseInt(limit),
        skip: parseInt(offset),
        orderBy: { created_at: 'desc' }
      })
    ]);

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
    const existingBerita = await prisma.berita.findFirst({ where: { slug } });
    if (existingBerita) {
      slug = `${slug}-${Date.now()}`;
    }

    const gambar = imageFile ? imageFile.filename : null;
    const dokumen_pdf = pdfFile ? pdfFile.filename : null;
    const tanggal_publish = status === 'published' ? new Date() : null;

    const kontenFinal = konten || 'Dokumen berita tersedia dalam lampiran PDF.';
    validasiBerita({ judul, slug, konten: kontenFinal });
    cekKolomDb({ kategori: kategori || 'umum', status: status || 'draft', ringkasan, penulis });

    const sekarang = new Date();
    const berita = await prisma.berita.create({
      data: {
        judul,
        slug,
        konten: kontenFinal,
        ringkasan,
        gambar,
        dokumen_pdf,
        kategori: kategori || 'umum',
        status: status || 'draft',
        tanggal_publish,
        penulis,
        created_at: sekarang,
        updated_at: sekarang
      }
    });

    // Sequelize dulu tidak menyertakan kolom yang tidak dikirim klien di respons create.
    if (ringkasan === undefined) delete berita.ringkasan;
    if (penulis === undefined) delete berita.penulis;

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

    const berita = await cariBeritaById(id);

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

      const existingBerita = await prisma.berita.findFirst({
        where: {
          slug,
          id_berita: { not: berita.id_berita }
        }
      });

      if (existingBerita) {
        slug = `${slug}-${Date.now()}`;
      }
    }

    const data = {};

    if (imageFile) {
      deleteBeritaFile(berita.gambar);
      data.gambar = imageFile.filename;
    }

    if (pdfFile) {
      deleteBeritaFile(berita.dokumen_pdf);
      data.dokumen_pdf = pdfFile.filename;
    }

    if (status === 'published' && berita.status !== 'published' && !berita.tanggal_publish) {
      data.tanggal_publish = new Date();
    }

    if (judul) data.judul = judul;
    if (slug) data.slug = slug;
    if (konten !== undefined && (konten || (data.dokumen_pdf ?? berita.dokumen_pdf))) {
      data.konten = konten || 'Dokumen berita tersedia dalam lampiran PDF.';
    }
    if (ringkasan !== undefined) data.ringkasan = ringkasan;
    if (kategori) data.kategori = kategori;
    if (status) data.status = status;
    if (penulis !== undefined) data.penulis = penulis;
    data.updated_at = new Date();

    // Sequelize hanya memvalidasi kolom yang berubah.
    const berubah = (k) => (data[k] !== undefined && data[k] !== berita[k] ? data[k] : undefined);
    validasiBerita({ judul: berubah('judul'), slug: berubah('slug'), konten: berubah('konten') });

    cekKolomDb(data);

    const beritaBaru = await prisma.berita.update({
      where: { id_berita: berita.id_berita },
      data
    });

    await ActivityLogger.log({
      userId: req.user?.id,
      userName: req.user?.name || 'Admin',
      userRole: req.user?.role || 'admin',
      bidangId: 2,
      module: 'berita',
      action: 'update',
      entityType: 'berita',
      entityId: beritaBaru.id_berita,
      entityName: beritaBaru.judul,
      description: `${req.user?.name || 'Admin'} memperbarui berita: ${beritaBaru.judul}`,
      newValue: {
        judul: beritaBaru.judul,
        status: beritaBaru.status,
        kategori: beritaBaru.kategori,
        dokumen_pdf: beritaBaru.dokumen_pdf
      },
      ipAddress: ActivityLogger.getIpFromRequest(req),
      userAgent: ActivityLogger.getUserAgentFromRequest(req)
    });

    res.status(200).json({
      status: 'success',
      message: 'Berita berhasil diupdate',
      data: beritaBaru
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

    const berita = await cariBeritaById(id);

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

    await prisma.berita.delete({ where: { id_berita: beritaId } });

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
    const totalBerita = await prisma.berita.count();
    const publishedBerita = await prisma.berita.count({ where: { status: 'published' } });
    const draftBerita = await prisma.berita.count({ where: { status: 'draft' } });
    const withPdf = await prisma.berita.count({
      where: {
        dokumen_pdf: { not: null }
      }
    });

    const kelompokKategori = await prisma.berita.groupBy({
      by: ['kategori'],
      where: { status: 'published' },
      _count: { id_berita: true }
    });
    const beritaByKategori = kelompokKategori.map((k) => ({
      kategori: k.kategori,
      total: k._count.id_berita
    }));

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
