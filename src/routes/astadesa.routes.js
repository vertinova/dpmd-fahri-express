/**
 * Rute Asta Desa — proxy baca ke API super admin ASTA DESA.
 *
 * Seluruh rute di sini WAJIB di balik auth + peran internal DPMD. Di ujung sana
 * yang dipakai adalah token super_admin ASTA DESA; membuka rute ini ke publik
 * berarti membocorkan akses baca seluruh data sensus mereka, termasuk NIK dan
 * nomor KK, ke siapa pun yang menebak URL-nya.
 */

const express = require('express');
const router = express.Router();
const controller = require('../controllers/astadesa.controller');
const { auth, checkRole } = require('../middlewares/auth');
const { PERAN_INTERNAL_DPMD } = require('../config/peranDpmd');

router.use(auth);
router.use(checkRole(PERAN_INTERNAL_DPMD));

router.get('/status', controller.getStatus);
router.get('/ringkasan', controller.getRingkasan);
router.get('/sebaran', controller.getSebaran);
router.get('/sensus', controller.getSensus);
router.get('/demografi', controller.getDemografi);
router.get('/pengguna', controller.getPengguna);
router.get('/layer', controller.getLayer);
router.get('/pesan', controller.getPesan);
router.post('/segarkan', controller.segarkan);

// Ditaruh setelah rute statis. '/sensus/:id' dan '/status' tidak bertabrakan,
// tetapi menaruh rute berparameter paling akhir menjaga urutannya tetap aman
// saat rute statis baru ditambahkan di atas.
router.get('/sensus/:id', controller.getSensusDetail);

module.exports = router;
