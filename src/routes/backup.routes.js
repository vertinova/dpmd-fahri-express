/**
 * Routes pencadangan sistem.
 * Base path: /api/superadmin/backup
 *
 * HANYA superadmin. Endpoint di sini mengeluarkan seluruh isi basis data dan
 * seluruh berkas unggahan dalam satu unduhan — kewenangan paling luas di
 * aplikasi ini, jadi tidak dibagi ke peran lain sekalipun peran itu "hampir
 * superadmin".
 */

const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const backupController = require('../controllers/backup.controller');
const { auth, checkRole } = require('../middlewares/auth');
const logger = require('../utils/logger');

const JWT_SECRET = process.env.JWT_SECRET;

/**
 * Penjaga jalur unduhan.
 *
 * Jalur ini TIDAK memakai header Authorization: ia dibuka lewat navigasi
 * peramban supaya berkasnya ditulis langsung ke disk dengan bilah progres,
 * dan navigasi tidak bisa membawa header. Penggantinya tiket berumur 2 menit
 * yang diterbitkan endpoint ber-Authorization biasa.
 *
 * Yang diperiksa di sini bukan hanya tanda tangan tiket, tapi juga bahwa
 * jenis backup di tiket sama dengan yang diminta — tanpa itu, tiket untuk
 * "foto" bisa dipakai menarik seluruh basis data.
 */
const verifikasiTiket = (req, res, next) => {
  const tiket = String(req.query.tiket || '');
  if (!tiket) {
    return res.status(401).json({ success: false, message: 'Tiket unduhan tidak ada' });
  }

  let isi;
  try {
    isi = jwt.verify(tiket, JWT_SECRET);
  } catch (error) {
    const kedaluwarsa = error.name === 'TokenExpiredError';
    logger.warn(`❌ Tiket backup ditolak (${error.name}) dari IP ${req.ip}`);
    return res.status(401).json({
      success: false,
      code: kedaluwarsa ? 'TIKET_KEDALUWARSA' : 'TIKET_TIDAK_SAH',
      message: kedaluwarsa
        ? 'Tiket unduhan sudah kedaluwarsa. Tekan tombol unduh lagi.'
        : 'Tiket unduhan tidak sah.',
    });
  }

  if (isi.tipe !== 'backup') {
    return res.status(401).json({ success: false, message: 'Tiket ini bukan untuk pencadangan' });
  }
  if (isi.peran !== 'superadmin') {
    return res.status(403).json({ success: false, message: 'Pencadangan hanya untuk superadmin' });
  }
  if (isi.jenis !== req.params.jenis) {
    logger.warn(`❌ Tiket backup jenis "${isi.jenis}" dipakai untuk "${req.params.jenis}"`);
    return res.status(403).json({
      success: false,
      message: 'Tiket ini tidak berlaku untuk jenis cadangan yang diminta',
    });
  }

  // Controller memakai req.user untuk mencatat jejak audit; isinya diambil dari
  // tiket, bukan dari basis data, karena tiketnya hanya berumur dua menit.
  req.user = { id: isi.uid, name: isi.nama, email: isi.email || isi.nama, role: isi.peran };
  return next();
};

router.get('/ringkasan', auth, checkRole('superadmin'), backupController.getRingkasan);
router.post('/tiket', auth, checkRole('superadmin'), backupController.buatTiket);
router.get('/unduh/:jenis', verifikasiTiket, backupController.unduh);

module.exports = router;
