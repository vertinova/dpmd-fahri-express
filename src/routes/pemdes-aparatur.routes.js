const express = require('express');
const router = express.Router();
const controller = require('../controllers/pemdes-aparatur.controller');
const desaController = require('../controllers/aparatur-desa.controller');
const prisma = require('../config/prisma');
const { auth, checkRole } = require('../middlewares/auth');
const { uploadAparaturDesa } = require('../middlewares/upload');
const { PERAN_INTERNAL_DPMD } = require('../config/peranDpmd');

router.use(auth);
router.use(checkRole(PERAN_INTERNAL_DPMD));

// GET /api/pemdes/aparatur-desa - List all aparatur desa from database
router.get('/', controller.getAllAparaturDesa);

// GET /api/pemdes/aparatur-desa/stats - Get aparatur desa statistics
router.get('/stats', controller.getStats);

// GET /api/pemdes/aparatur-desa/grouped - Kecamatan → Desa, urut jabatan
router.get('/grouped', controller.getGrouped);

// GET /api/pemdes/aparatur-desa/riwayat-terbaru - Aktivitas lintas desa
router.get('/riwayat-terbaru', controller.getRiwayatTerbaru);

// GET /api/pemdes/aparatur-desa/notifikasi - Usia lanjut & menunggu verifikasi
router.get('/notifikasi', controller.getNotifikasi);

// GET /api/pemdes/aparatur-desa/:id - Get single aparatur desa detail
router.get('/:id', controller.getAparaturDesaById);

// Menyunting dan memverifikasi hanya untuk staf Bidang Pemerintahan Desa.
// 'pemerintahan_desa' di checkRole adalah pseudo-role bidang: yang lolos adalah
// akun ber-bidang_id 6, apa pun jabatannya (lihat BIDANG_ROLE_MAP di auth.js).
const hanyaBidangPemdes = checkRole(['pemerintahan_desa', 'superadmin']);

// Bidang mengisi langsung untuk desa yang dipilihnya, memakai create/update
// milik desa (lihat konteksTulis di aparatur-desa.controller.js). Desa tujuan
// diperiksa SEBELUM multer: kalau ditolak, berkasnya belum sempat tertulis.
const berkasAparatur = uploadAparaturDesa.fields(
  [
    'file_bpjs_kesehatan',
    'file_bpjs_ketenagakerjaan',
    'file_pas_foto',
    'file_ktp',
    'file_kk',
    'file_akta_kelahiran',
    'file_ijazah_terakhir',
    'file_sk_terakhir',
  ].map((name) => ({ name, maxCount: 1 }))
);

// Desa dari ?desa_id= — body multipart belum terbaca di titik ini. Kelurahan
// ditolak: perangkatnya ASN kecamatan, bukan aparatur desa.
const atasNamaDesaBaru = async (req, res, next) => {
  try {
    const id = /^\d+$/.test(String(req.query.desa_id || '')) ? BigInt(req.query.desa_id) : null;
    const desa = id ? await prisma.desas.findUnique({ where: { id }, select: { id: true, status_pemerintahan: true } }) : null;
    if (!desa || desa.status_pemerintahan !== 'desa') {
      return res.status(400).json({ success: false, message: 'Pilih desa tujuan yang valid' });
    }
    req.atasNamaDesa = { desaId: desa.id };
    next();
  } catch (error) {
    next(error);
  }
};

// Desa pemilik baris yang disunting — tidak pernah dari kiriman pengguna.
const atasNamaDesaPemilik = async (req, res, next) => {
  try {
    const baris = await prisma.aparatur_desa.findUnique({ where: { id: req.params.id }, select: { desa_id: true } });
    if (!baris) return res.status(404).json({ success: false, message: 'Data aparatur desa tidak ditemukan' });
    req.atasNamaDesa = { desaId: baris.desa_id };
    next();
  } catch (error) {
    next(error);
  }
};

// POST /api/pemdes/aparatur-desa?desa_id= - Tambah aparatur untuk desa terpilih
router.post('/', hanyaBidangPemdes, atasNamaDesaBaru, berkasAparatur, desaController.createAparaturDesa);

// POST /api/pemdes/aparatur-desa/:id/lengkap - Sunting lengkap termasuk berkas
router.post('/:id/lengkap', hanyaBidangPemdes, atasNamaDesaPemilik, berkasAparatur, desaController.updateAparaturDesa);

// PUT /api/pemdes/aparatur-desa/:id - Perbaiki isian data aparatur
router.put('/:id', hanyaBidangPemdes, controller.updateAparaturDesa);

// POST /api/pemdes/aparatur-desa/:id/verifikasi - Tandai / batalkan verifikasi
router.post('/:id/verifikasi', hanyaBidangPemdes, controller.verifikasiAparaturDesa);

module.exports = router;
