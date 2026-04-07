const express = require('express');
const router = express.Router();
const chatbotController = require('../controllers/chatbot.controller');
const { auth, checkRole } = require('../middlewares/auth');

// All chatbot routes require authentication
router.use(auth);

// Search across all database tables
router.post('/search', chatbotController.search);

// Get available search categories
router.get('/categories', chatbotController.getCategories);

// Get quick stats
router.get('/stats', chatbotController.getStats);

module.exports = router;
