const express = require('express');
const router = express.Router();
const {
  triggerSMS,
  broadcastSMS,
  sendMonthlySummary,
  sendFeedNotification,
} = require('../controllers/notificationController');
const { authMiddleware } = require('../middlewares/authMiddleware');

// All routes require authentication
router.post('/send', authMiddleware, triggerSMS);
router.post('/broadcast', authMiddleware, broadcastSMS);
router.post('/monthly-summary', authMiddleware, sendMonthlySummary);
router.post('/feed-notification', authMiddleware, sendFeedNotification);

module.exports = router;