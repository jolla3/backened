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
  farmerIds = null,
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
 * Send monthly milk summary – fetches farmer details from DB.
 * Now only requires farmerId (and other numeric fields).
 */
const sendMonthlyMilkSummary = async ({
  farmerId,
  cooperativeId,
  period,
  litresDelivered,
  totalPayout,
  totalDeductions,
  adminId = null,
}) => {
  if (!farmerId) throw new Error('Farmer ID is required');
  if (!cooperativeId) throw new Error('Cooperative ID is required');
  if (!period) throw new Error('Settlement period is required');
  if (litresDelivered === undefined || isNaN(Number(litresDelivered))) {
    throw new Error('Valid litresDelivered is required');
  }
  if (totalPayout === undefined || isNaN(Number(totalPayout))) {
    throw new Error('Valid totalPayout is required');
  }
  if (totalDeductions === undefined || isNaN(Number(totalDeductions))) {
    throw new Error('Valid totalDeductions is required');
  }

  // Fetch farmer from DB to get phone and name
  const farmer = await Farmer.findOne({
    _id: farmerId,
    cooperativeId,
    isActive: true,
  }).select('phone name').lean();

  if (!farmer) {
    throw new Error('Farmer not found or inactive');
  }
  if (!farmer.phone) {
    throw new Error('Farmer has no phone number');
  }

  const normalizedPhone = normalizePhone(farmer.phone);
  if (!normalizedPhone) {
    throw new Error('Invalid phone number for farmer');
  }

  const idempotencyKey = `monthly_summary:${cooperativeId}:${farmerId}:${period}`;

  // Call smsService with the resolved phone and name
  const result = await smsService.sendMonthlyMilkSummary(
    normalizedPhone,
    farmer.name || 'Farmer',
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
 * Send feed transaction notification – fetches farmer details from DB.
 * Now only requires farmerId (and other transaction fields).
 */
const sendFeedTransactionNotification = async ({
  farmerId,
  cooperativeId,
  transactionId,
  productName,
  quantity,
  pricePerUnit,
  totalCost,
  cooperativeName,
  newBalance,
  adminId = null,
}) => {
  if (!farmerId) throw new Error('Farmer ID is required');
  if (!cooperativeId) throw new Error('Cooperative ID is required');
  if (!transactionId) throw new Error('Transaction ID is required');
  if (!productName) throw new Error('Product name is required');
  if (quantity === undefined || isNaN(Number(quantity)) || Number(quantity) <= 0) {
    throw new Error('Valid quantity is required');
  }
  if (pricePerUnit === undefined || isNaN(Number(pricePerUnit)) || Number(pricePerUnit) <= 0) {
    throw new Error('Valid price per unit is required');
  }
  if (totalCost === undefined || isNaN(Number(totalCost)) || Number(totalCost) <= 0) {
    throw new Error('Valid total cost is required');
  }
  if (newBalance === undefined || isNaN(Number(newBalance))) {
    throw new Error('Valid new balance is required');
  }

  // Fetch farmer from DB to get phone and name
  const farmer = await Farmer.findOne({
    _id: farmerId,
    cooperativeId,
    isActive: true,
  }).select('phone name').lean();

  if (!farmer) {
    throw new Error('Farmer not found or inactive');
  }
  if (!farmer.phone) {
    throw new Error('Farmer has no phone number');
  }

  const normalizedPhone = normalizePhone(farmer.phone);
  if (!normalizedPhone) {
    throw new Error('Invalid phone number for farmer');
  }

  const idempotencyKey = `feed_purchase:${cooperativeId}:${transactionId}`;

  // Call smsService with the resolved phone and name
  const result = await smsService.sendFeedTransactionNotification({
    farmerPhone: normalizedPhone,
    farmerName: farmer.name || 'Farmer',
    farmerId,
    productName,
    quantity: Number(quantity),
    pricePerUnit: Number(pricePerUnit),
    totalCost: Number(totalCost),
    cooperativeName: cooperativeName || 'Cooperative',
    newBalance: Number(newBalance),
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