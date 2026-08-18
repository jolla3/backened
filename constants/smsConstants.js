const SMS_TYPES = {
  MILK_RECEIPT: 'milk_receipt',
  FEED_PURCHASE: 'feed_purchase',
  MONTHLY_SUMMARY: 'monthly_summary',
  GENERAL: 'general',
  SYSTEM: 'system',
};

const SMS_STATUS = {
  QUEUED: 'queued',
  PROCESSING: 'processing',
  SENT: 'sent',
  FAILED: 'failed',
  CANCELLED: 'cancelled',
  EXPIRED: 'expired',
  DELIVERED: 'delivered',
  UNDELIVERED: 'undelivered',
};

const SMS_PRIORITY = {
  OTP: 100,
  PASSWORD_RESET: 90,
  MILK_RECEIPT: 80,
  FEED_PURCHASE: 70,
  MONTHLY_SUMMARY: 60,
  GENERAL: 50,
  SYSTEM: 40,
};

const SMS_WORKER_CONFIG = {
  POLL_INTERVAL_MS: parseInt(process.env.SMS_WORKER_POLL_INTERVAL_MS || '5000', 10),
  BATCH_SIZE: parseInt(process.env.SMS_BATCH_SIZE || '50', 10),
  CONCURRENCY: parseInt(process.env.SMS_WORKER_CONCURRENCY || '5', 10),
  REQUEST_TIMEOUT_MS: parseInt(process.env.SMS_REQUEST_TIMEOUT_MS || '15000', 10),
  MAX_RETRIES: parseInt(process.env.SMS_MAX_RETRIES || '3', 10),
  PROCESSING_TIMEOUT_MINUTES: 5,
  RATE_LIMIT_PER_SECOND: parseFloat(process.env.SMS_RATE_LIMIT_PER_SECOND || '5'),
};

const IDEMPOTENCY_KEY_PREFIX = {
  MILK_RECEIPT: 'milk_receipt',
  FEED_PURCHASE: 'feed_purchase',
  MONTHLY_SUMMARY: 'monthly_summary',
  FALLBACK: 'fallback',
};

module.exports = {
  SMS_TYPES,
  SMS_STATUS,
  SMS_PRIORITY,
  SMS_WORKER_CONFIG,
  IDEMPOTENCY_KEY_PREFIX,
};