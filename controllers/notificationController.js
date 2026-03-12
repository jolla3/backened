const notificationService = require('../services/notificationService');
const logger = require('../utils/logger');

const triggerSMS = async (req, res) => {
  try {
    const adminId = req.user.id;
    const { phone, message } = req.body;
    await notificationService.queueSMS(phone, message, adminId);
    res.json({ success: true });
  } catch (error) {
    logger.error('SMS trigger failed', { error: error.message, adminId: req.user.id });
    res.status(400).json({ error: error.message });
  }
};

module.exports = { triggerSMS };