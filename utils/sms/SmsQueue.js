// sms/SmsQueue.js
const smsConfig = require('../../config/smsConfig');
const SmsLog = require('../../models/SmsLog');
const logger = require('../../utils/logger');

// ── Queue state ────────────────────────────────────────────
let queue = [];
let isProcessing = false;

// Lazy load the provider (cached)
let providerCache = null;
const getProvider = () => {
  if (providerCache) return providerCache;
  const providerName = smsConfig.provider || 'africastalking';
  try {
    if (providerName === 'android') {
      providerCache = require('./providers/androidGatewayProvider');
    } else {
      providerCache = require('./providers/africasTalkingProvider');
    }
  } catch (err) {
    logger.error(`Failed to load SMS provider "${providerName}":`, err);
    providerCache = require('./providers/africasTalkingProvider');
  }
  return providerCache;
};

// ── Process queue (one by one) ──────────────────────────
const processQueue = async () => {
  if (isProcessing || queue.length === 0) return;
  isProcessing = true;
  const provider = getProvider();

  while (queue.length > 0) {
    const entry = queue.shift();
    const { logId, to, message, from } = entry;

    try {
      // Update status to 'processing'
      await SmsLog.findByIdAndUpdate(logId, { status: 'processing' });

      const result = await provider.sendSMS({ to, message, from });
      if (result.success) {
        await SmsLog.findByIdAndUpdate(logId, {
          status: 'sent',
          providerResponse: result.data,
          sentAt: new Date(),
        });
        logger.info('SMS sent', { logId, to });
      } else {
        throw new Error(result.error);
      }
    } catch (err) {
      await SmsLog.findByIdAndUpdate(logId, {
        status: 'failed',
        error: err.message,
        retryCount: (entry.retryCount || 0) + 1,
      });
      logger.error('SMS failed permanently', { logId, to, error: err.message });
    }
  }
  isProcessing = false;
};

// ── Queue an SMS (fire-and-forget) ──────────────────────
const queueSMS = async ({ to, message, from }) => {
  const providerName = smsConfig.provider || 'africastalking';

  // Check queue size limit
  if (queue.length >= smsConfig.queueMaxSize) {
    logger.warn('SMS queue full, rejecting', { to });
    throw new Error(`SMS queue is full (max ${smsConfig.queueMaxSize})`);
  }

  // Create log entry
  const log = new SmsLog({
    to,
    message,
    from: from || smsConfig.defaultSender,
    provider: providerName,
    status: 'queued',
  });
  await log.save();

  // Push to queue
  queue.push({
    logId: log._id,
    to,
    message,
    from: from || smsConfig.defaultSender,
    retryCount: 0,
  });

  // Trigger processing
  setImmediate(() => processQueue());

  return { queued: true, logId: log._id };
};

// ── Restore pending SMS from DB (on startup) ────────────
const restoreQueue = async () => {
  const pending = await SmsLog.find({ status: 'queued' }).limit(1000);
  for (const log of pending) {
    queue.push({
      logId: log._id,
      to: log.to,
      message: log.message,
      from: log.from,
      retryCount: 0,
    });
  }
  if (pending.length > 0) {
    logger.info(`Restored ${pending.length} pending SMS from DB`);
  }
  // Start processing after restoration
  setImmediate(() => processQueue());
};

// ── Admin: get queue length ──────────────────────────────
const getQueueLength = () => queue.length;

module.exports = {
  queueSMS,
  restoreQueue,
  getQueueLength,
};