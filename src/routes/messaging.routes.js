const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { auth } = require('../middlewares/auth');
const messagingController = require('../controllers/messaging.controller');

// Ensure upload directory exists
const uploadDir = 'storage/uploads/messaging';
if (!fs.existsSync(uploadDir)) {
	fs.mkdirSync(uploadDir, { recursive: true });
}

// Configure multer for chat file uploads
const storage = multer.diskStorage({
	destination: function (req, file, cb) {
		cb(null, uploadDir);
	},
	filename: function (req, file, cb) {
		const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
		cb(null, 'msg-' + uniqueSuffix + path.extname(file.originalname));
	}
});

const upload = multer({
	storage: storage,
	limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
	fileFilter: function (req, file, cb) {
		const allowedTypes = /jpeg|jpg|png|gif|webp|pdf|doc|docx|xls|xlsx|zip|rar/;
		const ext = allowedTypes.test(path.extname(file.originalname).toLowerCase());
		const mime = allowedTypes.test(file.mimetype) || file.mimetype.startsWith('image/') || file.mimetype.startsWith('application/');
		if (ext && mime) {
			cb(null, true);
		} else {
			cb(new Error('Tipe file tidak diperbolehkan'));
		}
	}
});

// Get all conversations
router.get('/conversations', auth, (req, res) => messagingController.getConversations(req, res));

// Get or create contextual conversation (tied to verification entity)
router.post('/conversations/context', auth, (req, res) => messagingController.getOrCreateContextualConversation(req, res));

// Get conversations for a specific reference entity
router.get('/conversations/reference/:type/:id', auth, (req, res) => messagingController.getConversationByReference(req, res));

// Get or create conversation with target user (general)
router.post('/conversations', auth, (req, res) => messagingController.getOrCreateConversation(req, res));

// Get messages for a conversation (cursor-based pagination)
router.get('/conversations/:id/messages', auth, (req, res) => messagingController.getMessages(req, res));

// Send a text message
router.post('/conversations/:id/messages', auth, (req, res) => messagingController.sendMessage(req, res));

// Upload file in conversation
router.post('/conversations/:id/upload', auth, upload.single('file'), (req, res) => messagingController.uploadFile(req, res));

// Mark messages in conversation as read
router.put('/conversations/:id/read', auth, (req, res) => messagingController.markAsRead(req, res));

// Get available contacts
router.get('/contacts', auth, (req, res) => messagingController.getContacts(req, res));

// Get unread message count
router.get('/unread-count', auth, (req, res) => messagingController.getUnreadCount(req, res));

// Delete a conversation and all its messages
router.delete('/conversations/:id', auth, (req, res) => messagingController.deleteConversation(req, res));

// Delete a message (own messages only)
router.delete('/messages/:id', auth, (req, res) => messagingController.deleteMessage(req, res));

module.exports = router;
