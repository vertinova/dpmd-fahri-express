const express = require('express');
const router = express.Router();
const controller = require('../controllers/bankeuPerubahanQuestionnaire.controller');
const { auth } = require('../middlewares/auth');

router.use(auth);

router.get('/:proposalId', controller.getQuestionnaire);
router.post('/:proposalId', controller.upsertQuestionnaire);

module.exports = router;
