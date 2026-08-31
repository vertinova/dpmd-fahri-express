const express = require('express');
const router = express.Router();
const dinasVerifikatorController = require('../controllers/dinasVerifikator.controller');
const { auth, checkRole, denyDinasPelihat } = require('../middlewares/auth');

// All routes require authentication and appropriate roles
// DPMD bidang staff can manage dinas verifikators from SPKED config page
router.use(auth);
router.use(checkRole(['kepala_dinas', 'sekretaris_dinas', 'dinas_terkait', 'superadmin', 'kepala_bidang', 'ketua_tim', 'pegawai', 'verifikator_dinas']));
// Akun dinas pelihat (BPKAD/Inspektorat) — pengelolaan verifikator bukan haknya.
router.use(denyDinasPelihat);

// Get all verifikator for a dinas
router.get('/:dinasId/verifikator', dinasVerifikatorController.getAllVerifikator);

// Get aggregate verification stats for all verifikators of a dinas
router.get('/:dinasId/verifikator/stats', dinasVerifikatorController.getVerifikatorStats);

// Create new verifikator
router.post('/:dinasId/verifikator', dinasVerifikatorController.createVerifikator);

// Update verifikator info
router.put('/:dinasId/verifikator/:verifikatorId', dinasVerifikatorController.updateVerifikator);

// Toggle verifikator active status
router.patch('/:dinasId/verifikator/:verifikatorId/toggle-status', dinasVerifikatorController.toggleVerifikatorStatus);

// Reset verifikator password
router.post('/:dinasId/verifikator/:verifikatorId/reset-password', dinasVerifikatorController.resetVerifikatorPassword);

// Delete verifikator
router.delete('/:dinasId/verifikator/:verifikatorId', dinasVerifikatorController.deleteVerifikator);

module.exports = router;
