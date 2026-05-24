const express = require('express');
const router = express.Router();
const controller = require('../controllers/bankeuPerubahanConfig.controller');
const { auth } = require('../middlewares/auth');
const upload = require('../middlewares/upload');

router.use(auth);

// Config Kecamatan
router.get('/config/:kecamatanId', controller.getConfig);
router.post('/config/:kecamatanId', controller.saveConfig);
router.post('/config/:kecamatanId/upload-logo', upload.bankeuPerubahanConfigFile, controller.uploadLogo);
router.post('/config/:kecamatanId/upload-camat-signature', upload.bankeuPerubahanConfigFile, controller.uploadCamatSignature);
router.post('/config/:kecamatanId/upload-stempel', upload.bankeuPerubahanConfigFile, controller.uploadStempel);
router.delete('/config/:kecamatanId/delete-camat-signature', controller.deleteCamatSignature);
router.delete('/config/:kecamatanId/delete-stempel', controller.deleteStempel);

// Tim Verifikasi
router.get('/tim-verifikasi/:kecamatanId', controller.getTimVerifikasi);
router.post('/tim-verifikasi/:kecamatanId', controller.addTimVerifikasi);
router.delete('/tim-verifikasi/:id', controller.removeTimVerifikasi);
router.post('/tim-verifikasi/:id/upload-signature', upload.bankeuPerubahanSignature, controller.uploadTimSignature);

module.exports = router;
