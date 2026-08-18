const logger = require('../utils/logger');
const smsService = require('./smsService');
const { normalizePhone } = require('../utils/phoneUtils');

// Hard limit for SMS length (GSM-7)
const MAX_SMS_LENGTH = 160;

/**
 * Queue an SMS notification using the same queue system as milk receipts.
 *
 * @param {Object} params
 * @param {string} params.phone          - Recipient phone number
 * @param {string} params.message        - SMS text (will be validated for length)
 * @param {string} params.adminId        - ID of the authenticated admin/user
 * @param {string} params.cooperativeId  - Cooperative ID (must be valid)
 * @param {Object} params.options        - Optional: type, priority, metadata, etc.
 * @returns {Promise<Object>}            - { jobId, queued, duplicate }
 */
const queueSMS = async ({
  phone,
  message,
  adminId,
  cooperativeId,
  options = {},
}) => {
  if (!phone || !message) {
    throw new Error('Phone number and message are required');
  }
  if (!adminId) {
    throw new Error('Admin ID is required');
  }
  if (!cooperativeId) {
    throw new Error('Cooperative ID is required');
  }

  // Normalize phone number
  const normalizedPhone = normalizePhone(phone);

  // Validate SMS length – prevent unnecessary segmentation costs
  if (message.length > MAX_SMS_LENGTH) {
    throw new Error(
      `SMS is too long (${message.length} chars). Maximum is ${MAX_SMS_LENGTH} characters.`
    );
  }

  // Delegate to the queue-based SMS service
  const result = await smsService.queueSMS({
    to: normalizedPhone,
    message,
    type: options.type || 'notification',
    cooperativeId,
    farmerId: options.farmerId || null,
    priority: options.priority || 0,
    metadata: {
      adminId,
      notificationType: options.notificationType || 'manual',
      ...options.metadata,
    },
    expiresAt: options.expiresAt || null,
    idempotencyKey: options.idempotencyKey || null,
  });

  logger.info('Notification SMS queued', {
    phone: normalizedPhone.substring(0, 7) + '****',
    jobId: result.jobId,
    cooperativeId,
    adminId,
  });

  return result;
};

/**
 * Legacy function – kept for backward compatibility, but deprecated.
 * Use queueSMS() instead.
 */
const processSMS = async (job) => {
  logger.warn('processSMS called – this is deprecated. Use queueSMS().');
  return { success: true };
};

module.exports = { queueSMS, processSMS };