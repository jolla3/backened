const mongoose = require('mongoose');
const OutboundSms = require('../models/OutboundSms');
const SmsGateway = require('../models/SmsGateway');
const smsConfig = require('../config/smsConfig');
const { normalizePhone } = require('../utils/phoneUtils');
const logger = require('../utils/logger');
const SMS_PRIORITY = require('../constants/smsPriorities');

/**
 * Queue an SMS job (used by controllers)
 */
const queueSMS = async ({
  to,
  message,
  from,
  type = 'general',
  priority = SMS_PRIORITY.GENERAL,
  cooperativeId,
  farmerId,
  maxRetries = smsConfig.MAX_RETRIES || 3,
  metadata = {},
  expiresAt = null,
  idempotencyKey = null,
}) => {
  // ── Basic validation ──────────────────────────────────
  if (!to || !message) {
    throw new Error('Phone number and message are required');
  }
  if (!cooperativeId) {
    throw new Error('cooperativeId is required');
  }

  // ── Idempotency check ──────────────────────────────────
  if (idempotencyKey) {
    const existing = await OutboundSms.findOne({ idempotencyKey });
    if (existing) {
      logger.info('Duplicate SMS prevented', { idempotencyKey });
      return { jobId: existing._id, queued: true, duplicate: true };
    }
  }

  const normalizedPhone = normalizePhone(to);

  // ── Build job document ─────────────────────────────────
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

/**
 * Claim pending jobs for a gateway (atomic using findOneAndUpdate loop).
 */
const claimJobs = async (gatewayId, limit = 10) => {
  const gateway = await SmsGateway.findOne({ gatewayId });
  if (!gateway) throw new Error('Gateway not found');

  const now = new Date();
  const queuedJobs = await OutboundSms.find({
    status: 'queued',
    cooperativeId: gateway.cooperativeId,
    $or: [
      { nextRetryAt: { $exists: false } },
      { nextRetryAt: { $lte: now } },
    ],
    $or: [
      { expiresAt: { $exists: false } },
      { expiresAt: { $gt: now } },
    ],
  })
    .sort({ priority: -1, createdAt: 1 })
    .limit(limit);

  const claimed = [];
  for (const job of queuedJobs) {
    const updated = await OutboundSms.findOneAndUpdate(
      { _id: job._id, status: 'queued' },
      {
        $set: {
          status: 'processing',
          gatewayId: gateway._id,
          processingStartedAt: now,
          updatedAt: now,
        },
      },
      { returnDocument: 'after' }
    );
    if (updated) claimed.push(updated);
  }

  if (claimed.length > 0) {
    logger.info(`Claimed ${claimed.length} jobs`, { gatewayId, claimed: claimed.map(j => j._id) });
  }
  return claimed;
};

/**
 * Mark a job as sent (successful).
 */
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

/**
 * Mark a job as failed.
 * Schedule retry using configurable delays.
 */
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

/**
 * Recover stuck processing jobs (run by scheduler).
 */
const recoverStuckJobs = async (olderThanMinutes = 5) => {
  const cutoff = new Date(Date.now() - olderThanMinutes * 60 * 1000);
  const result = await OutboundSms.updateMany(
    {
      status: 'processing',
      processingStartedAt: { $lte: cutoff },
    },
    {
      $set: {
        status: 'queued',
        updatedAt: new Date(),
      },
    }
  );
  if (result.modifiedCount > 0) {
    logger.info(`Recovered ${result.modifiedCount} stuck processing jobs`);
  }
  return result;
};

/**
 * Get job status (for admin).
 */
const getJobStatus = async (jobId) => {
  const job = await OutboundSms.findById(jobId);
  if (!job) throw new Error('Job not found');
  return job;
};

// ── Wrapper functions ──────────────────────────────────
const sendSMS = async ({ to, message, from, type = 'general', cooperativeId, farmerId, priority = SMS_PRIORITY.GENERAL }) => {
  if (!cooperativeId) {
    throw new Error('cooperativeId is required for SMS');
  }
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