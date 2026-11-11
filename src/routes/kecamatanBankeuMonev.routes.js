const express = require('express');
const router = express.Router();
const { auth, checkRole } = require('../middlewares/auth');
const upload = require('../middlewares/upload');
const c = require('../controllers/kecamatanBankeuMonev.controller');

// Hasil monev Bankeu per desa: diunggah kecamatan, hanya dibaca DPMD (lewat pemantauan LPJ).
router.use(auth, checkRole('kecamatan'));
router.get('/', c.list);
router.post('/', upload.bankeuMonev, c.upload);
router.delete('/:id', c.remove);

module.exports = router;
