/**
 * Unggahan berkas Drive.
 *
 * Berbeda dari `upload.js` yang menaruh berkas di `storage/uploads/`, berkas
 * Drive TIDAK boleh berada di mana pun di bawah `storage/`. Alasannya konkret:
 * `server.js` memasang `express.static` pada SELURUH direktori `storage/`, dan
 * nginx meneruskan `/storage` ke sana — jadi apa pun yang diletakkan di situ
 * bisa diunduh tanpa login, termasuk kalau ditaruh di subfolder bernama
 * "private". Menaruhnya di direktori terpisah membuat penguncian bersifat
 * struktural, bukan bergantung pada urutan middleware yang bisa berubah.
 *
 * Satu-satunya jalan mengambil berkas Drive adalah lewat
 * GET /api/drive/file/:id/unduh yang memeriksa izin lebih dulu.
 */

const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const prisma = require('../config/prisma');

// Sejajar dengan `storage/`, bukan di dalamnya. Perlu ikut dicadangkan saat
// backup dan perlu dibuat manual saat menyiapkan server baru.
const DRIVE_ROOT = path.join(__dirname, '../../private/drive');

// 100 MB, menyamai batas LPJ yang sudah berjalan supaya tidak ada aturan baru
// yang perlu dihafal pengguna.
const MAX_UKURAN_BERKAS = 100 * 1024 * 1024;

if (!fs.existsSync(DRIVE_ROOT)) {
  fs.mkdirSync(DRIVE_ROOT, { recursive: true });
}

/** Lintasan relatif berkas baru: "<bidang>/<tahun>/<bulan>". */
const segmenTujuan = (bidangId) => {
  const sekarang = new Date();
  const bulan = String(sekarang.getMonth() + 1).padStart(2, '0');
  return path.join(String(bidangId), String(sekarang.getFullYear()), bulan);
};

const storage = multer.diskStorage({
  destination(req, file, cb) {
    try {
      const relatif = segmenTujuan(req.params.bidangId);
      const absolut = path.join(DRIVE_ROOT, relatif);
      fs.mkdirSync(absolut, { recursive: true });
      // Disimpan supaya controller tidak perlu menghitung ulang lintasannya.
      req.driveSegmen = relatif;
      cb(null, absolut);
    } catch (error) {
      cb(error);
    }
  },
  filename(req, file, cb) {
    // Nama acak, bukan nama asli: menghindari tabrakan nama sekaligus membuat
    // lintasan di disk tidak bisa ditebak dari luar.
    const ext = path.extname(file.originalname || '').slice(0, 20);
    cb(null, `${crypto.randomBytes(24).toString('hex')}${ext}`);
  },
});

const uploadDrive = multer({
  storage,
  limits: { fileSize: MAX_UKURAN_BERKAS, files: 20 },
});

/**
 * Tolak unggahan yang jelas melewati kuota SEBELUM byte-nya ditulis ke disk.
 *
 * Pemeriksaan ini memakai Content-Length, jadi hanya perkiraan (termasuk
 * overhead multipart). Pemeriksaan yang tepat tetap dilakukan setelah berkas
 * mendarat — ini semata supaya unggahan 90 MB yang pasti ditolak tidak perlu
 * ditulis dulu ke disk baru dihapus lagi.
 */
const cekKuotaAwal = async (req, res, next) => {
  try {
    const bidangId = BigInt(req.params.bidangId);
    const kuota = await prisma.drive_kuota.findUnique({ where: { bidang_id: bidangId } });

    if (!kuota) {
      return res.status(403).json({
        success: false,
        message: 'Bidang ini belum memiliki Drive.',
      });
    }

    const perkiraan = BigInt(req.headers['content-length'] || 0);
    const sisa = kuota.batas_bytes - kuota.terpakai_bytes;

    if (perkiraan > sisa) {
      return res.status(413).json({
        success: false,
        message: 'Kuota Drive bidang tidak mencukupi.',
        data: {
          sisa_bytes: Number(sisa),
          batas_bytes: Number(kuota.batas_bytes),
          terpakai_bytes: Number(kuota.terpakai_bytes),
        },
      });
    }

    req.driveKuota = kuota;
    next();
  } catch (error) {
    console.error('Error cek kuota Drive:', error);
    res.status(500).json({ success: false, message: 'Gagal memeriksa kuota Drive.' });
  }
};

module.exports = {
  DRIVE_ROOT,
  MAX_UKURAN_BERKAS,
  uploadDrive,
  cekKuotaAwal,
};
