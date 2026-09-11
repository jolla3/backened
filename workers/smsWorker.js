const pLimit = require('p-limit');
const CelcomSmsProvider = require('../providers/CelcomSmsProvider');
const smsService = require('../services/smsService');
const accountingService = require('../services/accountingService');
const { normalizePhone, isValidKenyanPhone } = require('../utils/phoneUtils');
const logger = require('../utils/logger');

const SMS_WORKER_CONFIG = {
  pollInterval: parseInt(process.env.SMS_POLL_INTERVAL_MS || '5000', 10),
  batchSize: parseInt(process.env.SMS_BATCH_SIZE || '50', 10),
  concurrency: parseInt(process.env.SMS_CONCURRENCY || '1', 10),
  rateLimitPerSecond: parseInt(process.env.SMS_RATE_LIMIT_PER_SECOND || '1', 10),
  requestTimeout: parseInt(process.env.SMS_REQUEST_TIMEOUT_MS || '15000', 10),
  creditBlockCooldownMs: parseInt(process.env.CREDIT_BLOCK_COOLDOWN_MS || '300000', 10),
};

const CREDIT_BLOCK_COOLDOWN_MS = SMS_WORKER_CONFIG.creditBlockCooldownMs;
const SMS_UNIT_COST = parseFloat(process.env.SMS_UNIT_COST || '0.80');

class SmsWorker {
  constructor() {
    this.provider = new CelcomSmsProvider({
      timeout: SMS_WORKER_CONFIG.requestTimeout,
    });
    this.config = SMS_WORKER_CONFIG;
    this.creditBlocked = false;
    this.creditBlockedUntil = null;
    this.creditProbeInProgress = false;
    this._cachedBalance = null;
    this._activeJobs = new Set();
    this._currentBatch = [];
    this._pollInProgress = false;

    this._rateLimiter = {
      tokens: this.config.rateLimitPerSecond,
      lastRefill: Date.now(),
      refillRate: this.config.rateLimitPerSecond,
      maxTokens: this.config.rateLimitPerSecond,
    };

    this.limiter = pLimit(this.config.concurrency);
    this._pollTimer = null;
    this._balanceTimer = null;
    this._shuttingDown = false;
  }

  async start() {
    if (this._pollTimer) return;
    logger.info('SMS Worker started', this.config);

    this._pollTimer = setInterval(() => {
      this._pollLoop().catch(err => logger.error('Poll loop error', { error: err.message }));
    }, this.config.pollInterval);

    this._balanceTimer = setInterval(() => {
      this._checkBalance().catch(err => logger.warn('Balance check error', { error: err.message }));
    }, this.config.pollInterval * 6);

    this._pollLoop().catch(err => logger.error('Initial poll error', { error: err.message }));
  }

  async stop() {
    this._shuttingDown = true;
    if (this._pollTimer) clearInterval(this._pollTimer);
    if (this._balanceTimer) clearInterval(this._balanceTimer);
    this._pollTimer = null;
    this._balanceTimer = null;
    logger.info('SMS Worker stopped');
  }

  getStatus() {
    return {
      creditBlocked: this.creditBlocked,
      creditBlockedUntil: this.creditBlockedUntil,
      activeJobs: this._activeJobs.size,
      currentBatchSize: this._currentBatch.length,
      cachedBalance: this._cachedBalance,
      pollInProgress: this._pollInProgress,
    };
  }

  // ─── Balance (informational only – never unblocks) ─────────

  async _checkBalance() {
    try {
      const health = await this.provider.healthCheck();
      const balance = Number(health.balance);

      if (!Number.isFinite(balance)) {
        logger.warn('Balance check returned non-numeric balance – skipping accounting update', {
          raw: health.balance,
        });
        return;
      }

      this._cachedBalance = balance;

      try {
        await accountingService.updateProviderBalance({
          provider: 'celcom',
          balance,
          source: 'health_check',
        });
      } catch (err) {
        logger.warn('Failed to update provider balance in accounting', { error: err.message });
      }

      logger.debug('Balance check completed', { balance });
      // Do NOT clear creditBlocked based on balance
    } catch (error) {
      logger.warn('Balance check failed', { error: error.message });
    }
  }

  // ─── Poll loop ─────────────────────────────────────────────

  async _pollLoop() {
    if (this._shuttingDown) return;

    if (this._pollInProgress) {
      logger.debug('SMS poll skipped: previous poll still running');
      return;
    }

    this._pollInProgress = true;

    try {
      await smsService.recoverStuckJobs();

      if (this.creditBlocked) {
        await this._handleCreditBlocked();
        return;
      }

      const jobs = await smsService.claimJobsForWorker(this.config.batchSize);
      if (jobs.length === 0) return;

      this._currentBatch = jobs;
      await this._processBatch(jobs);
    } catch (error) {
      logger.error('SMS poll failed', { error: error.message });
    } finally {
      this._currentBatch = [];
      this._pollInProgress = false;
    }
  }

  async _processBatch(jobs) {
    logger.info(`Processing batch of ${jobs.length} SMS jobs`);
    const tasks = jobs.map(job => this.limiter(() => this._processJob(job)));
    await Promise.all(tasks);
  }

  // ─── Job processing ────────────────────────────────────────

  async _processJob(job) {
    const jobId = job._id.toString();
    this._activeJobs.add(jobId);

    try {
      // Stop rest of batch after first 1004/402
      if (this.creditBlocked) {
        await smsService.markFailed(jobId, null, 'SMS worker blocked due to insufficient credits', {
          retryable: false,
          errorCode: 'insufficient_credits',
          nextRetryAt: this.creditBlockedUntil,
        });
        return { success: false, reason: 'credit_blocked' };
      }

      const phone = normalizePhone(job.phone);
      if (!isValidKenyanPhone(phone)) {
        await smsService.markFailed(jobId, null, 'Invalid Kenyan phone number', {
          retryable: false,
          errorCode: 'invalid_phone',
        });
        return { success: false, reason: 'invalid_phone' };
      }

      await this._waitForRateLimit();

      const result = await this.provider.send(phone, job.message, job.idempotencyKey);

      if (result.status === 'accepted') {
        await smsService.markSent(jobId, null, result);
        await this._recordSmsUsage(job, result);
        return { success: true };
      }

      if (result.status === 'failed') {
        if (result.errorCode === 'insufficient_credits') {
          this.creditBlocked = true;
          this.creditBlockedUntil = new Date(Date.now() + CREDIT_BLOCK_COOLDOWN_MS);
          await smsService.markFailed(jobId, null, result.errorMessage, {
            retryable: false,
            errorCode: 'insufficient_credits',
            providerResponse: result,
            nextRetryAt: this.creditBlockedUntil,
          });
          logger.warn('Credit blocked due to insufficient credits', {
            jobId,
            responseCode: result.responseCode,
            until: this.creditBlockedUntil,
          });
          return { success: false, reason: 'insufficient_credits' };
        }

        await smsService.markFailed(jobId, null, result.errorMessage, {
          retryable: result.retryable,
          errorCode: result.errorCode,
          providerResponse: result,
        });
        return { success: false, reason: 'failed' };
      }

      if (result.status === 'unknown') {
        await smsService.markUnknown(jobId, {
          errorCode: result.errorCode,
          providerMessageId: result.providerMessageId,
          reason: 'provider_uncertain',
        });
        return { success: false, reason: 'unknown' };
      }

      await smsService.markUnknown(jobId, { error: 'Unexpected provider result' });
      return { success: false, reason: 'unexpected' };
    } catch (error) {
      logger.error('Unexpected error in _processJob', { jobId, error: error.message });
      try {
        await smsService.markUnknown(jobId, {
          error: error.message,
          errorCode: 'worker_internal_error',
        });
      } catch (markErr) {
        logger.error('Failed to mark job unknown after internal error', {
          jobId,
          error: markErr.message,
        });
      }
      return { success: false, reason: 'internal_error' };
    } finally {
      this._activeJobs.delete(jobId);
    }
  }

  // ─── Controlled recovery after credit block ────────────────

  async _handleCreditBlocked() {
    if (this.creditProbeInProgress) return;
    if (!this.creditBlockedUntil || Date.now() < this.creditBlockedUntil.getTime()) {
      return;
    }

    this.creditProbeInProgress = true;
    let jobId = null;

    try {
      const jobs = await smsService.claimJobsForWorker(1);
      if (jobs.length === 0) return;

      const job = jobs[0];
      jobId = job._id.toString();
      this._activeJobs.add(jobId);

      logger.info('Credit recovery probe: sending one job', { jobId });

      let phone;
      try {
        phone = normalizePhone(job.phone);
      } catch (normErr) {
        await smsService.markFailed(jobId, null, `Phone normalization failed: ${normErr.message}`, {
          retryable: false,
          errorCode: 'invalid_phone',
        });
        this.creditBlockedUntil = new Date(Date.now() + CREDIT_BLOCK_COOLDOWN_MS);
        return;
      }

      if (!isValidKenyanPhone(phone)) {
        await smsService.markFailed(jobId, null, 'Invalid Kenyan phone number', {
          retryable: false,
          errorCode: 'invalid_phone',
        });
        this.creditBlockedUntil = new Date(Date.now() + CREDIT_BLOCK_COOLDOWN_MS);
        return;
      }

      await this._waitForRateLimit();
      const result = await this.provider.send(phone, job.message, job.idempotencyKey);

      if (result.status === 'accepted') {
        try {
          await smsService.markSent(jobId, null, result);
          await this._recordSmsUsage(job, result);
          this.creditBlocked = false;
          this.creditBlockedUntil = null;
          logger.info('Credit block cleared via successful probe');

          // Re-queue other low-credit failures now that Celcom accepts again
          try {
            const recovered = await smsService.recoverLowCreditJobs();
            if (recovered > 0) {
              logger.info('Recovered low-credit SMS jobs after successful probe', { recovered });
            }
          } catch (recErr) {
            logger.warn('recoverLowCreditJobs failed after probe', { error: recErr.message });
          }
        } catch (persistErr) {
          logger.error('Probe accepted by Celcom but failed to persist', {
            jobId,
            error: persistErr.message,
          });
          try {
            await smsService.markUnknown(jobId, {
              error: persistErr.message,
              errorCode: 'persist_after_accept',
              providerMessageId: result.providerMessageId,
              reason: 'accepted_but_persist_failed',
            });
          } catch (markErr) {
            logger.error('Failed to mark probe job unknown after persist failure', {
              jobId,
              error: markErr.message,
            });
          }
          this.creditBlocked = true;
          this.creditBlockedUntil = new Date(Date.now() + CREDIT_BLOCK_COOLDOWN_MS);
        }
      } else if (result.errorCode === 'insufficient_credits') {
        this.creditBlocked = true;
        this.creditBlockedUntil = new Date(Date.now() + CREDIT_BLOCK_COOLDOWN_MS);
        await smsService.markFailed(jobId, null, result.errorMessage, {
          retryable: false,
          errorCode: 'insufficient_credits',
          providerResponse: result,
          nextRetryAt: this.creditBlockedUntil,
        });
        logger.warn('Credit recovery probe rejected again, extending block');
      } else if (result.status === 'unknown') {
        await smsService.markUnknown(jobId, {
          errorCode: result.errorCode,
          providerMessageId: result.providerMessageId,
          reason: 'probe_unknown',
        });
        this.creditBlocked = true;
        this.creditBlockedUntil = new Date(Date.now() + CREDIT_BLOCK_COOLDOWN_MS);
        logger.warn('Credit recovery probe unknown, keeping block');
      } else {
        await smsService.markFailed(jobId, null, result.errorMessage, {
          retryable: result.retryable,
          errorCode: result.errorCode,
          providerResponse: result,
        });
        this.creditBlocked = true;
        this.creditBlockedUntil = new Date(Date.now() + CREDIT_BLOCK_COOLDOWN_MS);
        logger.warn('Credit recovery probe definitive failure, keeping block');
      }
    } catch (error) {
      logger.error('Credit recovery probe error', { error: error.message, jobId });
      if (jobId) {
        try {
          await smsService.markUnknown(jobId, {
            error: error.message,
            errorCode: 'probe_internal_error',
            reason: 'probe_exception',
          });
        } catch (markErr) {
          logger.error('Failed to mark probe job unknown after exception', {
            jobId,
            error: markErr.message,
          });
        }
      }
      this.creditBlocked = true;
      this.creditBlockedUntil = new Date(Date.now() + CREDIT_BLOCK_COOLDOWN_MS);
    } finally {
      this.creditProbeInProgress = false;
      if (jobId) this._activeJobs.delete(jobId);
    }
  }

  // ─── Rate limiter ──────────────────────────────────────────

  async _waitForRateLimit() {
    const now = Date.now();
    const elapsed = (now - this._rateLimiter.lastRefill) / 1000;

    this._rateLimiter.tokens = Math.min(
      this._rateLimiter.maxTokens,
      this._rateLimiter.tokens + elapsed * this._rateLimiter.refillRate
    );
    this._rateLimiter.lastRefill = now;

    if (this._rateLimiter.tokens >= 1) {
      this._rateLimiter.tokens -= 1;
      return;
    }

    const waitMs = Math.ceil(
      ((1 - this._rateLimiter.tokens) / this._rateLimiter.refillRate) * 1000
    );
    await new Promise(resolve => setTimeout(resolve, waitMs));
    this._rateLimiter.tokens = 0;
    this._rateLimiter.lastRefill = Date.now();
  }

  // ─── Accounting ────────────────────────────────────────────

  async _recordSmsUsage(job, result) {
    try {
      await accountingService.recordSmsUsage({
        smsJobId: job._id,
        cooperativeId: job.cooperativeId,
        farmerId: job.farmerId || null,
        provider: 'celcom',
        type: job.type,
        message: job.message,
        providerMessageId: result.providerMessageId,
        unitCost: SMS_UNIT_COST,
        metadata: {
          status: 'sent',
          responseCode: result.responseCode,
        },
      });
    } catch (error) {
      logger.error('Failed to record SMS usage', { jobId: job._id, error: error.message });
    }
  }

  async _recoverStuckJobs() {
    await smsService.recoverStuckJobs();
  }

  async _recoverLowCreditJobs() {
    await smsService.recoverLowCreditJobs();
  }
}

// ─── Singleton (required by smsWorkerScheduler) ──────────────
let instance = null;

function getInstance() {
  if (!instance) {
    instance = new SmsWorker();
  }
  return instance;
}

module.exports = {
  SmsWorker,
  getInstance,
};