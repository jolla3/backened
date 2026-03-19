const logger = require('../utils/logger');
const smsClient = require('../config/smsConfig');
const Cooperative = require('../models/cooperative');

const queueSMS = async (phone, message, adminId) => {
  try {
    const cooperative = await Cooperative.findById(adminId);
    if (!cooperative) throw new Error('Cooperative not found');

    // Direct SMS send (no queue)
    const result = await smsClient.send(phone, message);
    logger.info('SMS sent', { phone, success: true, cooperativeId: cooperative._id });
    return { success: true, messageId: result.messageId };
  } catch (error) {
    logger.error('SMS failed', { phone, error: error.message });
    return { success: false, error: error.message };
  }
};

const processSMS = async (job) => {
  // Not used without BullMQ
  return { success: true };
};

module.exports = { queueSMS, processSMS };