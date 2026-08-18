// services/smsService.js
const mongoose = require('mongoose');
const crypto = require('crypto');
const OutboundSms = require('../models/OutboundSms');
const SmsGateway = require('../models/SmsGateway');
const smsConfig = require('../config/smsConfig');
const { normalizePhone } = require('../utils/phoneUtils');
const logger = require('../utils/logger');
const SMS_PRIORITY = require('../constants/smsPriorities');

const PROCESSING_TIMEOUT_MINUTES = 5;

function generateFallbackIdempotencyKey() {
  return `fallback_${Date.now()}_${crypto.randomBytes(8).toString('hex')}`;
}

function maskPhone(phone) {
  if (!phone || phone.length < 6) return phone;
  return `${phone.substring(0, 7)}****${phone.substring(phone.length - 2)}`;
}

// ─── Queue SMS ──────────────────────────────────────────────
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
  if (!to || !message) throw new Error('Phone number and message are required');
  if (!cooperativeId) throw new Error('cooperativeId is required');

  if (!idempotencyKey) {
    idempotencyKey = generateFallbackIdempotencyKey();
  }

  try {
    const existing = await OutboundSms.findOne({ idempotencyKey });
    if (existing) {
      logger.info('Duplicate SMS prevented', { idempotencyKey, jobId: existing._id });
      return { jobId: existing._id, queued: true, duplicate: true };
    }

    const normalizedPhone = normalizePhone(to);
    const job = new OutboundSms({
  phone: normalizedPhone,
  message,
  from: from || process.env.CELCOM_SENDER_ID || process.env.SMS_SENDER || 'JOMUGITAGRI',
  type,
  priority,
  cooperativeId,
  farmerId,
  maxRetries,
  metadata,
  expiresAt,
  idempotencyKey,
  status: 'queued',
  deliveryRoute: 'celcom', // direct Celcom worker only
});

    await job.save();
    logger.info('SMS job queued', {
      jobId: job._id,
      phone: maskPhone(normalizedPhone),
      type,
      idempotencyKey,
    });
    return { jobId: job._id, queued: true, duplicate: false };
  } catch (error) {
    if (error.code === 11000) {
      const existing = await OutboundSms.findOne({ idempotencyKey });
      if (existing) {
        logger.info('Duplicate SMS prevented (race condition)', { idempotencyKey });
        return { jobId: existing._id, queued: true, duplicate: true };
      }
    }
    throw error;
  }
};

// ─── Claim jobs (device gateway path) ───────────────────────
const claimJobs = async (gatewayId, limit = 10) => {
  if (process.env.SMS_GATEWAY_ENABLED !== 'true') {
    throw new Error('SMS gateway is disabled');
  }

  const gateway = await SmsGateway
    .findOne({ gatewayId })
    .select('_id cooperativeId')
    .lean();

  if (!gateway) throw new Error('Gateway not found');

  const claimed = [];
  const now = new Date();

  while (claimed.length < limit) {
    const filter = {
      cooperativeId: gateway.cooperativeId,
      status: 'queued',
      deliveryRoute: 'gateway',
      $and: [
        {
          $or: [
            { nextRetryAt: null },
            { nextRetryAt: { $exists: false } },
            { nextRetryAt: { $lte: now } },
          ],
        },
        {
          $or: [
            { expiresAt: null },
            { expiresAt: { $exists: false } },
            { expiresAt: { $gt: now } },
          ],
        },
      ],
    };

    const job = await OutboundSms.findOneAndUpdate(
      filter,
      {
        $set: {
          status: 'processing',
          gatewayId: gateway._id,
          processingStartedAt: now,
          updatedAt: now,
        },
      },
      {
        sort: { priority: -1, createdAt: 1 },
        returnDocument: 'after',
      }
    );

    if (!job) break;
    claimed.push(job);
  }

  return claimed;
};

/**
 * Claim for direct Celcom worker.
 * ONLY status: 'queued'. Never claims unknown.
 * Stuck processing is handled by recoverStuckJobs first.
 */
const claimJobsForWorker = async (limit = 50) => {
  const claimed = [];
  const now = new Date();

  while (claimed.length < limit) {
    const filter = {
      status: 'queued',
      $or: [
        { deliveryRoute: 'celcom' },
        { deliveryRoute: { $exists: false } }, // legacy rows
        { deliveryRoute: null },
      ],
      $and: [
        {
          $or: [
            { nextRetryAt: null },
            { nextRetryAt: { $exists: false } },
            { nextRetryAt: { $lte: now } },
          ],
        },
        {
          $or: [
            { expiresAt: null },
            { expiresAt: { $exists: false } },
            { expiresAt: { $gt: now } },
          ],
        },
      ],
    };

    const job = await OutboundSms.findOneAndUpdate(
      filter,
      {
        $set: {
          status: 'processing',
          processingStartedAt: now,
          updatedAt: now,
        },
      },
      {
        sort: { priority: -1, createdAt: 1 },
        returnDocument: 'after',
      }
    );

    if (!job) break;
    claimed.push(job);
  }

  if (claimed.length > 0) {
    logger.info(`Worker claimed ${claimed.length} jobs`, {
      jobIds: claimed.map((j) => j._id.toString()).slice(0, 5),
    });
  }

  return claimed;
};

// ─── Mark sent (conditional) ────────────────────────────────
const markSent = async (jobId, gatewayId, providerResponse = {}) => {
  const filter = {
    _id: jobId,
    status: 'processing',
    $or: [
      { providerMessageId: null },
      { providerMessageId: { $exists: false } },
    ],
  };
  if (gatewayId) filter.gatewayId = gatewayId;

  const update = {
    status: 'sent',
    sentAt: new Date(),
    providerResponse,
    updatedAt: new Date(),
  };

  if (providerResponse && providerResponse.providerMessageId) {
    update.providerMessageId = String(providerResponse.providerMessageId);
  }

  const job = await OutboundSms.findOneAndUpdate(
    filter,
    { $set: update },
    { returnDocument: 'after' }
  );

  if (!job) {
    logger.warn('markSent skipped – not processing or already has providerMessageId', {
      jobId,
    });
    return null;
  }

  logger.info('SMS job marked sent', {
    jobId,
    providerMessageId: job.providerMessageId,
  });
  return job;
};

// ─── Mark unknown (conditional) ─────────────────────────────
const markUnknown = async (jobId, details = {}) => {
  const update = {
    status: 'unknown',
    updatedAt: new Date(),
    error: details.error || 'Provider outcome unknown',
  };
  if (details.providerMessageId) {
    update.providerMessageId = String(details.providerMessageId);
  }
  if (details.errorCode) {
    update.errorCode = details.errorCode;
  }

  const job = await OutboundSms.findOneAndUpdate(
    {
      _id: jobId,
      status: { $in: ['processing', 'queued'] },
    },
    { $set: update },
    { returnDocument: 'after' }
  );

  if (job) {
    logger.warn('SMS job marked unknown', {
      jobId,
      providerMessageId: details.providerMessageId,
      reason: details.reason || details.errorCode,
    });
  }
  return job;
};

// ─── Mark failed (retry OPT-IN only) ────────────────────────
const markFailed = async (jobId, gatewayId, error, meta = {}) => {
  const filter = gatewayId
    ? { _id: jobId, gatewayId, status: { $in: ['processing', 'queued'] } }
    : { _id: jobId, status: { $in: ['processing', 'queued'] } };

  // OPT-IN: only retry when explicitly true
  const retryable = meta.retryable === true;

  const job = await OutboundSms.findOneAndUpdate(
    filter,
    {
      $inc: { retryCount: 1 },
      $set: {
        error: typeof error === 'string' ? error : (error?.message || String(error)),
        providerResponse: meta.providerResponse || null,
        updatedAt: new Date(),
      },
    },
    { returnDocument: 'after' }
  );

  if (!job) {
    logger.warn('markFailed skipped – job not in processing/queued', { jobId });
    return null;
  }

  const canRetry = retryable && job.retryCount < job.maxRetries;
  const update = { updatedAt: new Date() };

  if (canRetry) {
    const delaySeconds =
      (smsConfig.RETRY_DELAYS && smsConfig.RETRY_DELAYS[job.retryCount - 1]) || 300;
    update.status = 'queued';
    update.nextRetryAt = new Date(Date.now() + delaySeconds * 1000);
    logger.info('SMS retry scheduled', {
      jobId,
      retryCount: job.retryCount,
      nextRetryAt: update.nextRetryAt,
    });
  } else {
    update.status = 'failed';
    update.failedAt = new Date();
    logger.warn('SMS permanently failed', {
      jobId,
      retryCount: job.retryCount,
      error: job.error,
    });
  }

  return OutboundSms.findOneAndUpdate(
    { _id: job._id, status: { $in: ['processing', 'queued'] } },
    { $set: update },
    { returnDocument: 'after' }
  );
};

// ─── Recover stuck jobs ─────────────────────────────────────
const recoverStuckJobs = async (olderThanMinutes = PROCESSING_TIMEOUT_MINUTES) => {
  const cutoff = new Date(Date.now() - olderThanMinutes * 60 * 1000);

  // Safe: no providerMessageId → may never have reached Celcom
  const safe = await OutboundSms.updateMany(
    {
      status: 'processing',
      processingStartedAt: { $lte: cutoff },
      $or: [
        { providerMessageId: null },
        { providerMessageId: { $exists: false } },
      ],
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

  // Unsafe: has providerMessageId → never auto-resend
  const unsafe = await OutboundSms.updateMany(
    {
      status: 'processing',
      processingStartedAt: { $lte: cutoff },
      providerMessageId: { $exists: true, $ne: null },
    },
    {
      $set: {
        status: 'unknown',
        updatedAt: new Date(),
        error: 'Stuck processing with providerMessageId – needs reconciliation',
      },
    }
  );

  if (safe.modifiedCount || unsafe.modifiedCount) {
    logger.info('Stuck job recovery', {
      requeued: safe.modifiedCount,
      markedUnknown: unsafe.modifiedCount,
    });
  }

  return {
    requeued: safe.modifiedCount,
    markedUnknown: unsafe.modifiedCount,
  };
};

// ─── Get job status ─────────────────────────────────────────
const getJobStatus = async (jobId) => {
  const job = await OutboundSms.findById(jobId).select(
    '-providerResponse.raw -metadata'
  );
  if (!job) throw new Error('Job not found');
  return {
    jobId: job._id,
    status: job.status,
    phone: job.phone,
    type: job.type,
    retryCount: job.retryCount,
    maxRetries: job.maxRetries,
    providerMessageId: job.providerMessageId || null,
    error: job.error || null,
    createdAt: job.createdAt,
    sentAt: job.sentAt || null,
    failedAt: job.failedAt || null,
    nextRetryAt: job.nextRetryAt || null,
  };
};

// ─── Public API ─────────────────────────────────────────────
const sendSMS = async ({
  to,
  message,
  from,
  type = 'general',
  cooperativeId,
  farmerId,
  priority = SMS_PRIORITY.GENERAL,
  idempotencyKey = null,
  metadata = {},
}) => {
  if (!cooperativeId) throw new Error('cooperativeId required');
  return queueSMS({
    to,
    message,
    from,
    type,
    cooperativeId,
    farmerId,
    priority,
    idempotencyKey,
    metadata,
  });
};

const sendMonthlyMilkSummary = async (
  farmerPhone,
  farmerName,
  litresDelivered,
  totalPayout,
  totalDeductions,
  cooperativeId
) => {
  if (!cooperativeId) throw new Error('cooperativeId required');
  const netPayout = totalPayout - totalDeductions;
  const message = `Dear ${farmerName}, Monthly: ${litresDelivered}L, Payout:${totalPayout}, Deduct:${totalDeductions}, Net:${netPayout}`;
  return queueSMS({
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
  return queueSMS({
    to: farmerPhone,
    message,
    type: 'feed_purchase',
    cooperativeId,
    priority: SMS_PRIORITY.FEED_PURCHASE,
  });
};


const recoverLowCreditJobs = async () => {
  const result = await OutboundSms.updateMany(
    {
      status: 'unknown',
      providerMessageId: { $exists: false },
      error: /Low credit|insufficient.?credit|1004/i,
    },
    {
      $set: {
        status: 'queued',
        deliveryRoute: 'celcom',
        retryCount: 0,
        nextRetryAt: null,
        gatewayId: null,
        processingStartedAt: null,
        error: null,
        updatedAt: new Date(),
      },
      $unset: {
        providerResponse: '',
      },
    }
  );

  logger.info('Recovered low-credit SMS jobs', {
    count: result.modifiedCount,
  });

  return result.modifiedCount;
};

module.exports = {
  queueSMS,
  claimJobs,
  claimJobsForWorker,
  recoverLowCreditJobs,
  markSent,
  markUnknown,
  markFailed,
  recoverStuckJobs,
  getJobStatus,
  sendSMS,
  sendMonthlyMilkSummary,
  sendFeedTransactionNotification,
};