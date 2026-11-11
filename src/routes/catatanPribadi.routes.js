const express = require('express');
const router = express.Router();
const { auth } = require('../middlewares/auth');
const c = require('../controllers/catatanPribadi.controller');

// Data per pengguna (difilter user_id dari token), jadi cukup login; UI-nya saat ini hanya di Ruang Pribadi dashboard Sekretaris Dinas.
router.get('/', auth, c.list);
router.post('/', auth, c.create);
router.patch('/:id', auth, c.update);
router.delete('/:id', auth, c.remove);

module.exports = router;
