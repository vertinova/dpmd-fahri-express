/**
 * Video Meeting Routes
 */

const express = require('express');
const router = express.Router();
const videoMeetingController = require('../controllers/videoMeeting.controller');
const { auth } = require('../middlewares/auth');

// Public route - no auth required (for public meeting join)
router.get('/public/:roomId', videoMeetingController.getPublicMeetingInfo.bind(videoMeetingController));

// Protected routes - require authentication
router.use(auth);

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
