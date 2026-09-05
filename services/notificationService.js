const logger = require('../utils/logger');
const smsService = require('./smsService');
const Farmer = require('../models/farmer');
const { normalizePhone } = require('../utils/phoneUtils');

// Hard limit for SMS length (GSM-7)
const MAX_SMS_LENGTH = 160;

/**
 * Generic SMS queue – used for manual / custom notifications to a single recipient.
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

  const normalizedPhone = normalizePhone(phone);
  if (!normalizedPhone) {
    throw new Error('Invalid phone number');
  }

  if (message.length > MAX_SMS_LENGTH) {
    throw new Error(
      `SMS is too long (${message.length} chars). Maximum is ${MAX_SMS_LENGTH} characters.`
    );
  }

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
    type: options.type || 'notification',
  });

  return result;
};

/**
 * Broadcast SMS to all (or selected) farmers.
 * Looks up farmers internally; controller does not need to import Farmer.
 */
const sendBroadcast = async ({
  message,
  cooperativeId,
  farmerIds = null, // optional array of farmer IDs; if null, send to all active farmers
  adminId,
  type = 'broadcast',
  metadata = {},
}) => {
  if (!message) throw new Error('Message is required');
  if (!cooperativeId) throw new Error('Cooperative ID is required');
  if (!adminId) throw new Error('Admin ID is required');

  // Build query for farmers
  const query = {
    cooperativeId,
    isActive: true,
    phone: { $ne: null, $ne: '' },
  };
  if (farmerIds && Array.isArray(farmerIds) && farmerIds.length > 0) {
    query._id = { $in: farmerIds };
  }

  const farmers = await Farmer.find(query).select('_id phone name').lean();

  if (farmers.length === 0) {
    throw new Error('No active farmers with phone numbers found');
  }

  // Queue SMS for each farmer
  const results = [];
  let queued = 0;
  let failed = 0;

  for (const farmer of farmers) {
    try {
      const result = await queueSMS({
        phone: farmer.phone,
        message,
        adminId,
        cooperativeId,
        options: {
          type,
          farmerId: farmer._id,
          notificationType: 'broadcast',
          metadata: {
            ...metadata,
            broadcast: true,
          },
        },
      });
      results.push({ farmerId: farmer._id, jobId: result.jobId, queued: result.queued });
      if (result.queued) queued++;
      else failed++;
    } catch (err) {
      logger.error('Broadcast: failed to queue for farmer', {
        farmerId: farmer._id,
        error: err.message,
      });
      failed++;
      results.push({ farmerId: farmer._id, error: err.message });
    }
  }

  logger.info('Broadcast SMS completed', {
    cooperativeId,
    adminId,
    total: farmers.length,
    queued,
    failed,
  });

  return {
    total: farmers.length,
    queued,
    failed,
    details: results,
  };
};

/**
 * Send monthly milk summary – business-level notification.
 */
const sendMonthlyMilkSummary = async ({
  farmerPhone,
  farmerName,
  farmerId,
  litresDelivered,
  totalPayout,
  totalDeductions,
  cooperativeId,
  period,
  adminId = null,
}) => {
  if (!farmerPhone) throw new Error('Farmer phone number is required');
  if (!farmerName) throw new Error('Farmer name is required');
  if (!farmerId) throw new Error('Farmer ID is required');
  if (!cooperativeId) throw new Error('Cooperative ID is required');
  if (!period) throw new Error('Settlement period is required');

  const idempotencyKey = `monthly_summary:${cooperativeId}:${farmerId}:${period}`;

  const result = await smsService.sendMonthlyMilkSummary(
    farmerPhone,
    farmerName,
    Number(litresDelivered),
    Number(totalPayout),
    Number(totalDeductions),
    cooperativeId,
    {
      farmerId,
      idempotencyKey,
      metadata: {
        notificationType: 'monthly_summary',
        period,
        adminId,
      },
    }
  );

  logger.info('Monthly milk summary notification queued', {
    farmerId,
    cooperativeId,
    period,
    jobId: result.jobId,
    idempotencyKey,
    adminId,
  });

  return result;
};

/**
 * Send feed transaction notification – business-level notification.
 */
const sendFeedTransactionNotification = async ({
  farmerPhone,
  farmerName,
  farmerId,
  productName,
  quantity,
  pricePerUnit,
  totalCost,
  cooperativeName,
  newBalance,
  cooperativeId,
  transactionId,
  adminId = null,
}) => {
  if (!farmerPhone) throw new Error('Farmer phone number is required');
  if (!farmerName) throw new Error('Farmer name is required');
  if (!farmerId) throw new Error('Farmer ID is required');
  if (!productName) throw new Error('Product name is required');
  if (!transactionId) throw new Error('Transaction ID is required');
  if (!cooperativeId) throw new Error('Cooperative ID is required');

  const idempotencyKey = `feed_purchase:${cooperativeId}:${transactionId}`;

  const result = await smsService.sendFeedTransactionNotification({
    farmerPhone,
    farmerName,
    farmerId,
    productName,
    quantity,
    pricePerUnit,
    totalCost,
    cooperativeName,
    newBalance,
    cooperativeId,
    idempotencyKey,
    metadata: {
      notificationType: 'feed_purchase',
      transactionId,
      adminId,
    },
  });

  logger.info('Feed transaction notification queued', {
    farmerId,
    cooperativeId,
    transactionId,
    jobId: result.jobId,
    idempotencyKey,
    adminId,
  });

  return result;
};

/**
 * Legacy – deprecated.
 */
const processSMS = async (job) => {
  logger.warn('processSMS called – deprecated. Use queueSMS() or sendBroadcast().');
  return { success: true };
};

module.exports = {
  queueSMS,
  sendBroadcast,
  sendMonthlyMilkSummary,
  sendFeedTransactionNotification,
  processSMS,
};