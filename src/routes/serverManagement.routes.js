/**
 * Routes Manajemen Server.
 * Base path: /api/superadmin/server
 *
 * HANYA superadmin: halaman ini bisa me-restart aplikasi, memblokir IP,
 * menghapus berkas, dan membaca log sistem.
 */

const express = require('express');
const router = express.Router();
const c = require('../controllers/serverManagement.controller');
const { auth, checkRole } = require('../middlewares/auth');

router.use(auth, checkRole('superadmin'));

router.get('/overview', c.overview);
router.get('/history', c.history);
router.get('/alerts', c.alerts);

router.get('/apps', c.apps);
router.post('/apps/pm2/:name/:action', c.pm2Action);
router.get('/apps/pm2/:name/logs', c.pm2Logs);
router.post('/monitors/check', c.checkMonitors);
router.put('/monitors', c.saveMonitors);

router.get('/database', c.database);

router.get('/storage', c.storage);
router.get('/storage/cleanup', c.cleanupPreview);
router.post('/storage/cleanup', c.cleanup);

router.get('/security/summary', c.securitySummary);
router.get('/security/events', c.securityEvents);
router.delete('/security/events', c.clearEvents);
router.get('/security/blocklist', c.blocklist);
router.post('/security/blocklist', c.blockIp);
router.delete('/security/blocklist/:ip', c.unblockIp);

router.get('/traffic', c.traffic);
router.post('/traffic/reset', c.resetTraffic);

router.get('/logs/sources', c.logSources);
router.get('/logs', c.logs);

router.get('/proxmox/status', c.pveStatus);
router.get('/proxmox/overview', c.pveOverview);
router.get('/proxmox/tasks', c.pveTasks);
router.get('/proxmox/rrd/:vmid', c.pveRrd);
router.get('/proxmox/guests/:vmid', c.pveGuest);
router.post('/proxmox/guests/:vmid/power/:action', c.pvePower);
router.post('/proxmox/guests/:vmid/resize', c.pveResize);
router.put('/proxmox/guests/:vmid/resources', c.pveResources);

router.get('/config', c.getConfig);
router.put('/config', c.saveConfig);

module.exports = router;
