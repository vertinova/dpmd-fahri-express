/**
 * Produk Hukum Bidang — produk hukum tingkat kabupaten milik tiap bidang DPMD.
 *
 * Membaca terbuka untuk seluruh pegawai DPMD (Core Dashboard menyatukan
 * semuanya), menulis dibatasi ke bidang si penulis. Batas menulis itu ditegakkan
 * di controller, bukan di sini: rute tidak tahu bidang mana yang sedang disentuh
 * sampai barisnya dibaca.
 */

const express = require('express');
const router = express.Router();
const controller = require('../controllers/produkHukumBidang.controller');
const { auth, checkRole } = require('../middlewares/auth');
const { uploadProdukHukumBidang } = require('../middlewares/upload');

const PERAN_DPMD = [
	'pegawai',
	'kepala_bidang',
	'ketua_tim',
	'sekretaris_dinas',
	'kepala_dinas',
	'bendahara',
	'superadmin',
];

router.use(auth);
router.use(checkRole(PERAN_DPMD));

// Rute statis didaftarkan sebelum '/:id' supaya "opsi" dan "stats" tidak
// tertangkap sebagai id.
router.get('/opsi', controller.opsi);
router.get('/stats', controller.stats);
router.get('/', controller.index);
router.get('/:id', controller.show);

router.post('/', uploadProdukHukumBidang.single('file'), controller.store);
router.put('/:id', uploadProdukHukumBidang.single('file'), controller.update);
router.delete('/:id', controller.destroy);

module.exports = router;
