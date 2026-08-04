// src/routes/prolap.routes.js
// Sub bagian Program & Pelaporan (Prolap) — rekap output kegiatan.
const express = require('express');
const router = express.Router();
const { auth, checkRole } = require('../middlewares/auth');
const { getOutputInfrastruktur } = require('../services/outputInfrastruktur.service');
const { getOutputKeuanganDesa } = require('../services/outputKeuanganDesa.service');
const { getOutputKelembagaan } = require('../services/outputKelembagaan.service');
const { getOutputPemerintahanDesa } = require('../services/outputPemerintahanDesa.service');
const { getOutputBumdes } = require('../services/outputBumdes.service');
const logger = require('../utils/logger');

// Prolap merekap output SELURUH bidang, jadi aksesnya dibatasi ke pemilik
// pekerjaannya: pegawai bidang Sekretariat (bidang_id 2, lewat pseudo-role
// 'sekretariat' di checkRole) dan superadmin.
router.use(auth, checkRole('superadmin', 'sekretariat'));

// GET /api/prolap/output-infrastruktur
//   ?tahun=2026&kategori=jalan&sumber=perubahan&status=disetujui
// [SPKED] Output pembangunan hasil Bankeu (reguler + perubahan), per desa.
router.get('/output-infrastruktur', async (req, res, next) => {
  try {
    const data = await getOutputInfrastruktur({
      tahun: req.query.tahun,
      kategori: req.query.kategori,
      sumber: req.query.sumber,
      status: req.query.status,
    });
    return res.json({ success: true, data });
  } catch (error) {
    logger.error('Error getting output infrastruktur:', error);
    return next(error);
  }
});

// GET /api/prolap/output-keuangan
//   ?tahun=2026&sumber=add&force=1
// [KKD] Output penyaluran keuangan desa per sumber dana, diolah dari SIPANDA.
router.get('/output-keuangan', async (req, res, next) => {
  try {
    const data = await getOutputKeuanganDesa({
      tahun: req.query.tahun,
      sumber: req.query.sumber,
      force: req.query.force === '1',
    });
    return res.json({ success: true, data });
  } catch (error) {
    // SIPANDA milik pihak lain. Bedakan "sumber data sedang tidak bisa
    // dihubungi" dari kesalahan aplikasi, supaya halaman bisa mengatakannya
    // apa adanya alih-alih menampilkan galat umum.
    if (/SIPANDA/i.test(error.message)) {
      logger.error('SIPANDA tidak bisa dihubungi:', error);
      return res.status(503).json({
        success: false,
        message: 'Data SIPANDA sedang tidak bisa diambil. Coba lagi beberapa saat.',
        detail: error.message,
      });
    }
    logger.error('Error getting output keuangan desa:', error);
    return next(error);
  }
});

// GET /api/prolap/output-bumdes
// [SPKED] Output BUMDes: badan hukum, penyertaan modal, omset/laba, PADes.
router.get('/output-bumdes', async (req, res, next) => {
  try {
    const data = await getOutputBumdes();
    return res.json({ success: true, data });
  } catch (error) {
    logger.error('Error getting output bumdes:', error);
    return next(error);
  }
});

// GET /api/prolap/output-kelembagaan
//   ?jenis=posyandu
// [PMD] Output kelembagaan desa + pengurusnya, delapan jenis lembaga.
router.get('/output-kelembagaan', async (req, res, next) => {
  try {
    const data = await getOutputKelembagaan({ jenis: req.query.jenis });
    return res.json({ success: true, data });
  } catch (error) {
    logger.error('Error getting output kelembagaan:', error);
    return next(error);
  }
});

// GET /api/prolap/output-pemerintahan
// [Pemdes] Output aparatur desa, produk hukum desa, kelengkapan profil desa.
router.get('/output-pemerintahan', async (req, res, next) => {
  try {
    const data = await getOutputPemerintahanDesa();
    return res.json({ success: true, data });
  } catch (error) {
    logger.error('Error getting output pemerintahan desa:', error);
    return next(error);
  }
});

module.exports = router;
