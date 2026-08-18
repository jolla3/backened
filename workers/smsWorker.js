const pLimit = require('p-limit');
const CelcomSmsProvider = require('../providers/CelcomSmsProvider');
const smsService = require('../services/smsService');
const { normalizePhone } = require('../utils/phoneUtils');
const logger = require('../utils/logger');
const { SMS_WORKER_CONFIG } = require('../constants/smsConstants');

class SmsWorker {
  constructor(config = {}) {
    this.config = {
      pollInterval: config.pollInterval ?? SMS_WORKER_CONFIG.POLL_INTERVAL_MS,
      batchSize: config.batchSize ?? SMS_WORKER_CONFIG.BATCH_SIZE,
      concurrency: config.concurrency ?? SMS_WORKER_CONFIG.CONCURRENCY,
      requestTimeout: config.requestTimeout ?? SMS_WORKER_CONFIG.REQUEST_TIMEOUT_MS,
      rateLimitPerSecond: config.rateLimitPerSecond ?? SMS_WORKER_CONFIG.RATE_LIMIT_PER_SECOND,
    };

    this.isRunning = false;
    this.provider = null;
    this.limiter = pLimit(this.config.concurrency);
    this._lastSendTimestamps = [];
    this._rateChain = Promise.resolve();
    this._pollTimer = null;
    this._activeJobs = new Set();
    this._currentBatch = null;
  }

  async start() {
    if (this.isRunning) {
      logger.warn('SMS Worker is already running');
      return;
    }

    this.provider = new CelcomSmsProvider({
      timeout: this.config.requestTimeout,
    });

    try {
      const health = await this.provider.healthCheck();
      logger.info('Celcom provider health check', {
        status: health.status,
        balance: health.balance,
      });
    } catch (err) {
      logger.warn('Celcom health check failed at startup (will still try to send)', {
        error: err.message,
      });
    }

    this.isRunning = true;
    this._pollLoop();
    logger.info('SMS Worker started', { config: this.config });
  }

  async stop() {
    logger.info('SMS Worker stopping...');
    this.isRunning = false;

    if (this._pollTimer) {
      clearTimeout(this._pollTimer);
      this._pollTimer = null;
    }

    if (this._currentBatch) {
      await Promise.race([
        this._currentBatch,
        new Promise((r) => setTimeout(r, 30000)),
      ]);
    }

    logger.info('SMS Worker stopped');
  }

  _pollLoop() {
    if (!this.isRunning) return;

    this._currentBatch = this._processBatch();

    this._currentBatch
      .catch((err) => {
        logger.error('SMS Worker batch error', { error: err.message });
      })
      .finally(() => {
        this._currentBatch = null;
        if (this.isRunning) {
          this._pollTimer = setTimeout(
            () => this._pollLoop(),
            this.config.pollInterval
          );
        }
      });
  }

  async _processBatch() {
    await smsService.recoverStuckJobs();

    const jobs = await smsService.claimJobsForWorker(this.config.batchSize);
    if (jobs.length === 0) return;

    logger.info(`Processing ${jobs.length} SMS jobs`);

    await Promise.all(
      jobs.map((job) => this.limiter(() => this._processJob(job)))
    );
  }

  _waitForRateLimit() {
    this._rateChain = this._rateChain.then(async () => {
      const windowMs = 1000;
      const max = this.config.rateLimitPerSecond;

      for (;;) {
        const now = Date.now();
        this._lastSendTimestamps = this._lastSendTimestamps.filter(
          (t) => now - t < windowMs
        );

        if (this._lastSendTimestamps.length < max) {
          this._lastSendTimestamps.push(Date.now());
          return;
        }

        const oldest = this._lastSendTimestamps[0];
        const waitMs = windowMs - (now - oldest) + 5;
        await new Promise((r) => setTimeout(r, Math.max(waitMs, 10)));
      }
    });

    return this._rateChain;
  }

  async _processJob(job) {
    const jobId = job._id.toString();
    this._activeJobs.add(jobId);
    let crossedProviderBoundary = false;

    try {
      // Already accepted → never resend
      if (job.providerMessageId) {
        logger.info('SMS already has providerMessageId – skipping resend', {
          jobId,
          providerMessageId: job.providerMessageId,
        });
        await smsService.markSent(jobId, null, {
          providerMessageId: job.providerMessageId,
          status: 'accepted',
          note: 'skipped_resend_existing_id',
        });
        return { success: true };
      }

      if (!job.phone || !job.message) {
        await smsService.markFailed(jobId, null, 'Missing phone or message', {
          retryable: false,
        });
        return { success: false };
      }

      const phone = normalizePhone(job.phone);
      if (!phone) {
        await smsService.markFailed(jobId, null, 'Invalid phone number', {
          retryable: false,
        });
        return { success: false };
      }

      await this._waitForRateLimit();
      crossedProviderBoundary = true;

      logger.info('Sending SMS via Celcom', {
        jobId,
        phone: this._maskPhone(phone),
        type: job.type,
      });

      const result = await this.provider.send(
        phone,
        job.message,
        job.idempotencyKey
      );

      if (result.success) {
        try {
          await smsService.markSent(jobId, null, {
            providerMessageId: result.providerMessageId,
            status: result.status,
            responseCode: result.responseCode,
            raw: result.raw,
          });
          logger.info('Celcom SMS accepted', {
            jobId,
            providerMessageId: result.providerMessageId,
          });
          return { success: true };
        } catch (markErr) {
          logger.error('markSent failed after provider accept', {
            jobId,
            providerMessageId: result.providerMessageId,
            error: markErr.message,
          });
          await smsService.markUnknown(jobId, {
            providerMessageId: result.providerMessageId,
            error: markErr.message,
            reason: 'mark_sent_failed_after_accept',
          });
          return { success: false, reason: 'unknown' };
        }
      }

      // Provider reported unknown / non-retryable uncertainty
      if (result.status === 'unknown' || result.retryable === false) {
        const isClientReject =
          result.errorCode && String(result.errorCode).startsWith('http_4');

        if (isClientReject) {
          await smsService.markFailed(jobId, null, result.errorMessage, {
            retryable: false,
            providerResponse: result,
          });
        } else {
          await smsService.markUnknown(jobId, {
            error: result.errorMessage,
            errorCode: result.errorCode,
            reason: result.status || 'provider_uncertain',
          });
        }
        return { success: false, reason: result.status || 'unknown' };
      }

      // Explicitly safe to retry only when provider says so
      await smsService.markFailed(jobId, null, result.errorMessage || 'Provider error', {
        retryable: result.retryable === true,
        providerResponse: result,
      });
      return { success: false };
    } catch (err) {
      logger.error('SMS job unexpected error', {
        jobId,
        error: err.message,
        crossedProviderBoundary,
      });

      if (crossedProviderBoundary) {
        // NEVER markFailed({ retryable: true }) after provider boundary
        try {
          await smsService.markUnknown(jobId, {
            error: err.message,
            reason: 'unexpected_after_provider_boundary',
          });
        } catch (persistErr) {
          logger.error('CRITICAL: unable to persist UNKNOWN SMS state', {
            jobId,
            originalError: err.message,
            persistenceError: persistErr.message,
          });
        }
        return { success: false, reason: 'unknown' };
      }

      try {
        await smsService.markFailed(jobId, null, err.message, {
          retryable: false,
        });
      } catch (_) { /* ignore */ }
      return { success: false };
    } finally {
      this._activeJobs.delete(jobId);
    }
  }

  _maskPhone(phone) {
    if (!phone || phone.length < 6) return phone;
    return `${phone.substring(0, 7)}****${phone.substring(phone.length - 2)}`;
  }

  getStatus() {
    return {
      isRunning: this.isRunning,
      activeJobs: this._activeJobs.size,
      config: this.config,
    };
  }
}

let workerInstance = null;
const getInstance = () => {
  if (!workerInstance) workerInstance = new SmsWorker();
  return workerInstance;
};

module.exports = { SmsWorker, getInstance };