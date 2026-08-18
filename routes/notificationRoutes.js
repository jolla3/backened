const express = require('express');
const router = express.Router();
const { triggerSMS } = require('../controllers/notificationController');
const { authMiddleware } = require('../middlewares/authMiddleware');

router.post('/send', authMiddleware, triggerSMS);

module.exports = router;