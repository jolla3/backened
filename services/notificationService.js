// backend/src/services/notificationService.js
const { Queue } = require('bullmq');
const redis = require('../config/redis');
const logger = require('../utils/logger');

let notificationQueue;

if (redis) {
  notificationQueue = new Queue('notifications', { connection: redis });
} else {
  console.warn('⚠️ Redis not available, SMS queue disabled');
}

const queueSMS = async (phone, message) => {
  if (!notificationQueue) {
    console.log(`📱 [SMS] Would send to ${phone}: ${message}`);
    return { success: true };
  }
  
  await notificationQueue.add('send-sms', { phone, message }, {
    attempts: 3,
    backoff: { type: 'exponential', delay: 1000 }
  });
  logger.info('SMS queued', { phone });
};

const processSMS = async (job) => {
  const { phone, message } = job.data;
  return { success: true };
};

module.exports = { queueSMS, processSMS };