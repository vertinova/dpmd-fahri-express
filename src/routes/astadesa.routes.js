/**
 * Rute Asta Desa — proxy baca ke API super admin ASTA DESA.
 *
 * Seluruh rute di sini WAJIB di balik auth + peran internal DPMD. Di ujung sana
 * yang dipakai adalah token super_admin ASTA DESA; membuka rute ini ke publik
 * berarti membocorkan akses baca seluruh data sensus mereka, termasuk NIK dan
 * nomor KK, ke siapa pun yang menebak URL-nya. Pengecualian satu-satunya:
 * akun dinas di KODE_DINAS_LIHAT_ASTA_DESA (BAPPERIDA), baca saja.
 */

const express = require('express');
const router = express.Router();
const controller = require('../controllers/astadesa.controller');
const { auth, isDinasLihatAstaDesa } = require('../middlewares/auth');
const { PERAN_INTERNAL_DPMD } = require('../config/peranDpmd');
const logger = require('../utils/logger');

/**
 * Pegawai internal DPMD lolos ke seluruh rute. Selain itu hanya akun dinas
 * yang terdaftar di KODE_DINAS_LIHAT_ASTA_DESA (BAPPERIDA), dan hanya untuk
 * GET: ia ditandai `req.astaDesaLihatSaja` sehingga `force` diabaikan
 * controller — akun luar tidak boleh memicu penyusuran ulang ke ASTA DESA.
 */
const izinkanAstaDesa = async (req, res, next) => {
  try {
    const role = String(req.user?.role || '').trim().toLowerCase();
    if (PERAN_INTERNAL_DPMD.includes(role)) return next();

    if (req.method === 'GET' && (await isDinasLihatAstaDesa(req.user))) {
      req.astaDesaLihatSaja = true;
      return next();
    }

    logger.warn(`❌ Asta Desa ditolak - User ${req.user?.email} (role: ${req.user?.role}, dinas_id: ${req.user?.dinas_id}) ${req.method} ${req.path}`);
    return res.status(403).json({ success: false, message: 'Akses ditolak - Asta Desa hanya untuk internal DPMD' });
  } catch (error) {
    logger.error('izinkanAstaDesa error:', error);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

router.use(auth);
router.use(izinkanAstaDesa);

router.get('/status', controller.getStatus);
router.get('/ringkasan', controller.getRingkasan);
router.get('/sebaran', controller.getSebaran);
router.get('/sensus', controller.getSensus);
router.get('/demografi', controller.getDemografi);
router.get('/demografi/kategori', controller.getKategoriSensus);
// Bahan ekspor: seluruh rincian per kecamatan DAN per desa dalam satu muatan.
router.get('/demografi/wilayah', controller.getDemografiWilayah);
// Harus berdiri SEBELUM '/sensus/:id' di kaki berkas ini, kalau tidak 'ekspor'
// akan terbaca sebagai sebuah id sensus.
router.get('/sensus/ekspor', controller.getSensusEkspor);
router.get('/pengguna', controller.getPengguna);
router.get('/layer', controller.getLayer);
router.get('/pesan', controller.getPesan);
// Capaian target KK (persen terhadap target desa, per hari) — sama dengan kartu
// "Capaian Target KK" di dasbor super admin ASTA DESA.
router.get('/target-kk', controller.getTargetKk);

// Penunjang halaman Peta Sebaran (WebGIS). Meneruskan endpoint PUBLIK ASTA DESA,
// tetapi tetap berada di balik auth + peran internal DPMD seperti rute lain di
// berkas ini — tidak ada alasan membuka pintu baru hanya karena di ujung sana
// endpointnya publik.
router.get('/sebaran-peta', controller.getSebaranPeta);
router.get('/wilayah/kecamatan', controller.getWilayahKecamatan);
router.get('/wilayah/desa', controller.getWilayahDesa);
router.get('/wilayah/geojson', controller.getWilayahGeojson);
router.get('/cuaca', controller.getCuaca);

router.post('/segarkan', controller.segarkan);

// Ditaruh setelah rute statis. '/sensus/:id' dan '/status' tidak bertabrakan,
// tetapi menaruh rute berparameter paling akhir menjaga urutannya tetap aman
// saat rute statis baru ditambahkan di atas.
router.get('/sensus/:id', controller.getSensusDetail);

module.exports = router;
