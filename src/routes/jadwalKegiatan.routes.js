/**
 * Jadwal Kegiatan Routes - REBUILT
 */

const express = require('express');
const router = express.Router();
const jadwalKegiatanController = require('../controllers/jadwalKegiatan.controller');
const { auth } = require('../middlewares/auth');

// All routes require authentication
router.use(auth);

// Get all jadwal (with role-based filtering)
router.get('/', jadwalKegiatanController.getAllJadwal);

// Get disposisi data for jadwal display (must be before /:id)
router.get('/disposisi-jadwal', (req, res) => jadwalKegiatanController.getDisposisiForJadwal(req, res));

// Get single jadwal by ID
router.get('/:id', jadwalKegiatanController.getJadwalById);

// Create new jadwal
router.post('/', jadwalKegiatanController.createJadwal);

// Update jadwal
router.put('/:id', jadwalKegiatanController.updateJadwal);

// Delete jadwal
router.delete('/:id', jadwalKegiatanController.deleteJadwal);

// View tracking
router.post('/:id/view', (req, res) => jadwalKegiatanController.trackView(req, res));
router.get('/:id/viewers', (req, res) => jadwalKegiatanController.getViewers(req, res));

// Emoji reactions
router.get('/:id/reactions', (req, res) => jadwalKegiatanController.getReactions(req, res));
router.post('/:id/reactions', (req, res) => jadwalKegiatanController.addReaction(req, res));
router.delete('/:id/reactions', (req, res) => jadwalKegiatanController.removeReaction(req, res));

// Comments
router.get('/:id/comments', (req, res) => jadwalKegiatanController.getComments(req, res));
router.post('/:id/comments', (req, res) => jadwalKegiatanController.addComment(req, res));
router.delete('/:id/comments/:commentId', (req, res) => jadwalKegiatanController.deleteComment(req, res));

module.exports = router;
