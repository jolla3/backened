const notificationService = require('../services/notificationService');

const triggerSMS = async (req, res) => {
  try {
    const { phone, message } = req.body;
    await notificationService.queueSMS(phone, message);
    res.json({ success: true });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

module.exports = { triggerSMS };