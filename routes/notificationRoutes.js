const express = require('express');
const router = express.Router();
const { triggerSMS, broadcastSMS } = require('../controllers/notificationController');
const { authMiddleware } = require('../middlewares/authMiddleware');

router.post('/send', authMiddleware, triggerSMS);
router.post('/broadcast', authMiddleware, broadcastSMS);

module.exports = router;