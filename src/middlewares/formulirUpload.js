/**
 * Lampiran jawaban formulir.
 *
 * Alasan penyimpanannya sama persis dengan Drive: `server.js` memasang
 * `express.static` pada SELURUH direktori `storage/`, jadi apa pun yang ditaruh
 * di sana bisa diunduh tanpa login. Lampiran formulir justru sering berisi data
 * pribadi (KTP, foto, berkas persyaratan) yang dikirim orang luar, sehingga
 * disimpan sejajar dengan `storage/`, bukan di dalamnya.
 *
 * Satu-satunya jalan mengambilnya adalah GET /api/formulir/berkas/:id/unduh
 * yang memeriksa izin lebih dulu.
 */

const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const prisma = require('../config/prisma');

const FORMULIR_ROOT = path.join(__dirname, '../../private/formulir');

// 25 MB per berkas. Lebih kecil dari Drive (100 MB) karena yang mengunggah di
// sini adalah orang luar lewat tautan publik — batas longgar di jalur yang tidak
// butuh login adalah cara termurah untuk menghabiskan disk server.
const MAX_UKURAN_BERKAS = 25 * 1024 * 1024;

// Batas jumlah berkas dalam satu pengiriman, apa pun jumlah pertanyaannya.
const MAX_BERKAS_PER_KIRIM = 10;

if (!fs.existsSync(FORMULIR_ROOT)) {
  fs.mkdirSync(FORMULIR_ROOT, { recursive: true });
}

const storage = multer.diskStorage({
  destination(req, file, cb) {
    try {
      const sekarang = new Date();
      const bulan = String(sekarang.getMonth() + 1).padStart(2, '0');
      // Dikelompokkan per token formulir supaya lampiran satu formulir mudah
      // ditemukan (dan dihapus) tanpa menyusuri seluruh direktori.
      const relatif = path.join(
        String(req.params.token || 'lainnya').slice(0, 32),
        String(sekarang.getFullYear()),
        bulan
      );
      const absolut = path.join(FORMULIR_ROOT, relatif);
      fs.mkdirSync(absolut, { recursive: true });
      req.formulirSegmen = relatif;
      cb(null, absolut);
    } catch (error) {
      cb(error);
    }
  },
  filename(req, file, cb) {
    const ext = path.extname(file.originalname || '').slice(0, 20);
    cb(null, `${crypto.randomBytes(24).toString('hex')}${ext}`);
  },
});

const uploadFormulir = multer({
  storage,
  limits: { fileSize: MAX_UKURAN_BERKAS, files: MAX_BERKAS_PER_KIRIM },
});

/**
 * Auth yang tidak memaksa.
 *
 * Formulir publik harus tetap bisa dibuka tanpa login, tapi kalau kebetulan
 * penggunanya sudah login identitasnya perlu ikut tercatat — dan formulir yang
 * `butuh_login` baru bisa menolak dengan benar kalau tahu ada/tidaknya sesi.
 * Token yang rusak sengaja diabaikan, bukan ditolak: bagi tamu, gagal memverifikasi
 * token sama artinya dengan tidak punya token.
 */
const authOpsional = async (req, res, next) => {
  const token = req.header('Authorization')?.replace('Bearer ', '');
  if (!token) return next();

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    const user = await prisma.users.findUnique({
      where: { id: BigInt(payload.id) },
      select: { id: true, name: true, email: true, role: true, bidang_id: true },
    });
    if (user) {
      req.user = {
        id: Number(user.id),
        name: user.name,
        email: user.email,
        role: user.role,
        bidang_id: user.bidang_id ? Number(user.bidang_id) : null,
      };
    }
  } catch {
    // Tamu dengan token basi tetap dilayani sebagai tamu.
  }
  next();
};

module.exports = {
  FORMULIR_ROOT,
  MAX_UKURAN_BERKAS,
  MAX_BERKAS_PER_KIRIM,
  uploadFormulir,
  authOpsional,
};
