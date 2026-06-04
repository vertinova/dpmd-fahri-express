const express = require('express');
const router = express.Router();
const controller = require('../controllers/bankeuPerubahanConfig.controller');
const timConfigController = require('../controllers/bankeuPerubahanTimConfig.controller');
const { auth } = require('../middlewares/auth');
const upload = require('../middlewares/upload');

router.use(auth);

// Config Kecamatan
router.get('/config/:kecamatanId', controller.getConfig);
router.post('/config/:kecamatanId', controller.saveConfig);
router.post('/config/:kecamatanId/sync-from-reguler', controller.syncFromReguler);
router.post('/config/:kecamatanId/upload-logo', upload.bankeuPerubahanConfigFile, controller.uploadLogo);
router.post('/config/:kecamatanId/upload-camat-signature', upload.bankeuPerubahanConfigFile, controller.uploadCamatSignature);
router.post('/config/:kecamatanId/upload-stempel', upload.bankeuPerubahanConfigFile, controller.uploadStempel);
router.delete('/config/:kecamatanId/delete-camat-signature', controller.deleteCamatSignature);
router.delete('/config/:kecamatanId/delete-stempel', controller.deleteStempel);

// Tim Verifikasi (lama, level kecamatan - dipertahankan untuk kompatibilitas)
router.get('/tim-verifikasi/:kecamatanId', controller.getTimVerifikasi);
router.post('/tim-verifikasi/:kecamatanId', controller.addTimVerifikasi);
router.delete('/tim-verifikasi/:id', controller.removeTimVerifikasi);
router.post('/tim-verifikasi/:id/upload-signature', upload.bankeuPerubahanSignature, controller.uploadTimSignature);

// Tim Verifikasi per-proposal berbasis posisi (mirror bankeu reguler)
// anggota-list didaftarkan sebelum :posisi agar tidak tertangkap sebagai posisi
router.get('/tim-config/:kecamatanId/anggota-list', timConfigController.getAnggotaList);
router.get('/tim-config/:kecamatanId', timConfigController.getAllTimConfig);
router.post('/tim-config/:kecamatanId/:posisi/upload-ttd', upload.bankeuPerubahanSignature, timConfigController.uploadTTD);
router.delete('/tim-config/:kecamatanId/:posisi/ttd', timConfigController.deleteTTD);
router.post('/tim-config/:kecamatanId/:posisi', timConfigController.upsertTimMemberConfig);
router.delete('/tim-config/:kecamatanId/:posisi', timConfigController.deleteAnggota);

module.exports = router;
