/**
 * Video Meeting Routes
 */

const express = require('express');
const router = express.Router();
const videoMeetingController = require('../controllers/videoMeeting.controller');
const { auth } = require('../middlewares/auth');

// Public route - no auth required (for public meeting join)
router.get('/public/:roomId', videoMeetingController.getPublicMeetingInfo.bind(videoMeetingController));
// Public: status siaran HLS (untuk halaman penonton webinar)
router.get('/:roomId/broadcast/status', videoMeetingController.broadcastStatus.bind(videoMeetingController));

// Protected routes - require authentication
router.use(auth);

// Webinar broadcast (HLS) — host-only
router.post('/:roomId/broadcast/start', videoMeetingController.startBroadcast.bind(videoMeetingController));
router.post('/:roomId/broadcast/stop', videoMeetingController.stopBroadcast.bind(videoMeetingController));

// Meeting CRUD
router.post('/', videoMeetingController.createMeeting.bind(videoMeetingController));
router.get('/', videoMeetingController.getMeetings.bind(videoMeetingController));
router.get('/room/:roomId', videoMeetingController.getMeetingByRoomId.bind(videoMeetingController));

// Meeting actions
router.post('/:id/start', videoMeetingController.startMeeting.bind(videoMeetingController));
router.post('/:id/end', videoMeetingController.endMeeting.bind(videoMeetingController));
router.delete('/:id', videoMeetingController.deleteMeeting.bind(videoMeetingController));

// Chat
router.get('/:id/chat', videoMeetingController.getChatMessages.bind(videoMeetingController));

module.exports = router;
