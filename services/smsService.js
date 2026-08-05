const mongoose = require('mongoose');
const OutboundSms = require('../models/OutboundSms');
const SmsGateway = require('../models/SmsGateway');
const smsConfig = require('../config/smsConfig');
const { normalizePhone } = require('../utils/phoneUtils');
const logger = require('../utils/logger');
const SMS_PRIORITY = require('../constants/smsPriorities');

const PROCESSING_TIMEOUT_MINUTES = 5;

const queueSMS = async ({ to, message, from, type = 'general', priority = SMS_PRIORITY.GENERAL, cooperativeId, farmerId, maxRetries = smsConfig.MAX_RETRIES || 3, metadata = {}, expiresAt = null, idempotencyKey = null }) => {
  if (!to || !message) throw new Error('Phone number and message are required');
  if (!cooperativeId) throw new Error('cooperativeId is required');

  if (idempotencyKey) {
    const existing = await OutboundSms.findOne({ idempotencyKey });
    if (existing) {
      logger.info('Duplicate SMS prevented', { idempotencyKey });
      return { jobId: existing._id, queued: true, duplicate: true };
    }
  }

  const normalizedPhone = normalizePhone(to);
  const job = new OutboundSms({
    phone: normalizedPhone,
    message,
    from: from || process.env.SMS_SENDER || 'Cooperative',
    type,
    priority,
    cooperativeId,
    farmerId,
    maxRetries,
    metadata,
    expiresAt,
    idempotencyKey,
    status: 'queued',
  });

  await job.save();
  logger.info('SMS job queued', { jobId: job._id, phone: normalizedPhone, type });
  return { jobId: job._id, queued: true };
};

const claimJobs = async (gatewayId, limit = 10) => {
  const gateway = await SmsGateway
    .findOne({ gatewayId })
    .select('_id cooperativeId')
    .lean();

  if (!gateway) throw new Error('Gateway not found');

  const cutoff = new Date(Date.now() - PROCESSING_TIMEOUT_MINUTES * 60 * 1000);
  const claimed = [];

  while (claimed.length < limit) {
    const now = new Date();

    const filter = {
      cooperativeId: gateway.cooperativeId,
      $or: [
        { status: 'queued' },
        {
          status: 'processing',
          processingStartedAt: { $lte: cutoff }
        }
      ],
      $and: [
        {
          $or: [
            { nextRetryAt: null },
            { nextRetryAt: { $exists: false } },
            { nextRetryAt: { $lte: now } }
          ]
        },
        {
          $or: [
            { expiresAt: null },
            { expiresAt: { $exists: false } },
            { expiresAt: { $gt: now } }
          ]
        }
      ]
    };

    const job = await OutboundSms.findOneAndUpdate(
      filter,
      {
        $set: {
          status: 'processing',
          gatewayId: gateway._id,
          processingStartedAt: now,
          updatedAt: now
        }
      },
      {
        sort: { priority: -1, createdAt: 1 },
        returnDocument: 'after'   // ✅ fixed
      }
    );

    if (!job) break;
    claimed.push(job);
  }

  if (claimed.length > 0) {
    logger.info(`Claimed ${claimed.length} jobs`, {
      gatewayId,
      claimed: claimed.map(j => j._id)
    });
  }

  return claimed;
};

const markSent = async (jobId, gatewayId, providerResponse) => {
  const job = await OutboundSms.findOneAndUpdate(
    { _id: jobId, gatewayId },
    {
      $set: {
        status: 'sent',
        sentAt: new Date(),
        providerResponse,
        updatedAt: new Date(),
      },
    },
    { returnDocument: 'after' }
  );
  if (!job) throw new Error('Job not found or not owned by this gateway');
  logger.info('SMS job marked sent', { jobId });
  return job;
};

const markFailed = async (jobId, gatewayId, error, providerResponse) => {
  const job = await OutboundSms.findOneAndUpdate(
    { _id: jobId, gatewayId },
    {
      $inc: { retryCount: 1 },
      $set: {
        error,
        providerResponse,
        updatedAt: new Date(),
      },
    },
    { returnDocument: 'after' }
  );

  if (!job) throw new Error('Job not found or not owned by this gateway');

  const newStatus = job.retryCount < job.maxRetries ? 'queued' : 'failed';
  const update = { status: newStatus, updatedAt: new Date() };

  if (newStatus === 'queued') {
    const delaySeconds = smsConfig.RETRY_DELAYS[job.retryCount - 1] || 300;
    update.nextRetryAt = new Date(Date.now() + delaySeconds * 1000);
  } else {
    update.failedAt = new Date();
  }

  const finalJob = await OutboundSms.findOneAndUpdate(
    { _id: jobId, gatewayId },
    { $set: update },
    { returnDocument: 'after' }
  );

  logger.warn('SMS job marked failed', { jobId, retryCount: finalJob.retryCount, error });
  return finalJob;
};

const recoverStuckJobs = async (olderThanMinutes = PROCESSING_TIMEOUT_MINUTES) => {
  const cutoff = new Date(Date.now() - olderThanMinutes * 60 * 1000);
  const result = await OutboundSms.updateMany(
    {
      status: 'processing',
      processingStartedAt: { $lte: cutoff },
    },
    {
      $set: {
        status: 'queued',
        gatewayId: null,
        processingStartedAt: null,
        updatedAt: new Date(),
      },
    }
  );
  if (result.modifiedCount > 0) {
    logger.info(`Recovered ${result.modifiedCount} stuck processing jobs`);
  }
  return result;
};

const getJobStatus = async (jobId) => {
  const job = await OutboundSms.findById(jobId);
  if (!job) throw new Error('Job not found');
  return job;
};

const sendSMS = async ({ to, message, from, type = 'general', cooperativeId, farmerId, priority = SMS_PRIORITY.GENERAL }) => {
  if (!cooperativeId) throw new Error('cooperativeId required');
  return await queueSMS({ to, message, from, type, cooperativeId, farmerId, priority });
};

const sendMonthlyMilkSummary = async (farmerPhone, farmerName, litresDelivered, totalPayout, totalDeductions, cooperativeId) => {
  if (!cooperativeId) throw new Error('cooperativeId required');
  const netPayout = totalPayout - totalDeductions;
  const message = `Dear ${farmerName}, Monthly: ${litresDelivered}L, Payout:${totalPayout}, Deduct:${totalDeductions}, Net:${netPayout}`;
  return await queueSMS({
    to: farmerPhone,
    message,
    type: 'monthly_summary',
    cooperativeId,
    priority: SMS_PRIORITY.MONTHLY_SUMMARY,
  });
};

const sendFeedTransactionNotification = async ({
  farmerPhone,
  farmerName,
  productName,
  quantity,
  pricePerUnit,
  totalCost,
  cooperativeName,
  newBalance,
  cooperativeId,
}) => {
  if (!cooperativeId) throw new Error('cooperativeId required');
  const message = `Dear ${farmerName}, You bought ${quantity} units of ${productName} @ ${pricePerUnit}/unit. Total: ${totalCost}. Balance: ${newBalance}. ${cooperativeName || 'Cooperative'}`;
  return await queueSMS({
    to: farmerPhone,
    message,
    type: 'feed_purchase',
    cooperativeId,
    priority: SMS_PRIORITY.FEED_PURCHASE,
  });
};

module.exports = {
  queueSMS,
  claimJobs,
  markSent,
  markFailed,
  recoverStuckJobs,
  getJobStatus,
  sendSMS,
  sendMonthlyMilkSummary,
  sendFeedTransactionNotification,
};