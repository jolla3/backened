// utils/smsUtil.js
const smsConfig = require('../config/smsConfig');
const { queueSMS, restoreQueue } = require('../utils/sms/SmsQueue');
const logger = require('./logger');

// Log provider on startup
logger.info(`SMS Provider: ${smsConfig.provider}`);

/**
 * Public interface – remains exactly the same for all controllers.
 */
const sendSMS = async ({ to, message, from }) => {
  // Queue the SMS and return immediately (fire-and-forget)
  return queueSMS({ to, message, from });
};

/**
 * Initialize the SMS queue (restore pending from DB)
 * Call this once during app startup (after DB connection).
 */
const initSmsQueue = async () => {
  await restoreQueue();
};

module.exports = { sendSMS, initSmsQueue };