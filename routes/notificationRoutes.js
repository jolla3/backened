const express = require('express');
const router = express.Router();
const { triggerSMS } = require('../controllers/notificationController');

router.post('/send', triggerSMS);

module.exports = router;