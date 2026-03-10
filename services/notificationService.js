const logger = require('../utils/logger');
const smsClient = require('../config/sms');

const queueSMS = async (phone, message) => {
  try {
    // Direct SMS send (no queue)
    const result = await smsClient.send(phone, message);
    logger.info('SMS sent', { phone, success: true });
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