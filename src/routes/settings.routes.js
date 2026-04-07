const express = require('express');
const router = express.Router();
const { changePassword, backupDatabase, getDatabaseInfo, getLoginHistory, getOnlineUsers } = require('../controllers/settings.controller');
const { auth, requireSuperadmin } = require('../middlewares/auth');

// Password change - any authenticated user
router.put('/change-password', auth, changePassword);

// Login history - any authenticated user
router.get('/login-history', auth, getLoginHistory);

// Online users - superadmin only
router.get('/online-users', auth, requireSuperadmin, getOnlineUsers);

// Database backup - superadmin only
router.get('/database/backup', auth, requireSuperadmin, backupDatabase);
router.get('/database/info', auth, requireSuperadmin, getDatabaseInfo);

module.exports = router;
