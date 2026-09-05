const pLimit = require('p-limit');
const CelcomSmsProvider = require('../providers/CelcomSmsProvider');
const smsService = require('../services/smsService');
const { normalizePhone } = require('../utils/phoneUtils');
const logger = require('../utils/logger');
const { SMS_WORKER_CONFIG } = require('../constants/smsConstants');

// Cooldown durations (milliseconds)
const CREDIT_BLOCK_COOLDOWN_MS = 5 * 60 * 1000;      // 5 minutes
const BALANCE_CHECK_INTERVAL_MS = 60 * 1000;         // 1 minute

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

    // ── Circuit breaker / credit state ──────────────────────
    this.creditBlocked = false;
    this.creditBlockedUntil = null;
    this._balanceCheckTimer = null;
    this._lastBalanceCheck = 0;
    this._cachedBalance = null;
  }

  async start() {
    if (this.isRunning) {
      logger.warn('SMS Worker is already running');
      return;
    }

    this.provider = new CelcomSmsProvider({
      timeout: this.config.requestTimeout,
    });

    // Initial health check (only once at startup)
    try {
      const health = await this.provider.healthCheck();
      this._cachedBalance = health.balance;
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
    // Start periodic balance checks (separate from main poll)
    this._startBalanceCheckLoop();
    logger.info('SMS Worker started', { config: this.config });
  }

  async stop() {
    logger.info('SMS Worker stopping...');
    this.isRunning = false;

    if (this._pollTimer) {
      clearTimeout(this._pollTimer);
      this._pollTimer = null;
    }
    if (this._balanceCheckTimer) {
      clearTimeout(this._balanceCheckTimer);
      this._balanceCheckTimer = null;
    }

    if (this._currentBatch) {
      await Promise.race([
        this._currentBatch,
        new Promise((r) => setTimeout(r, 30000)),
      ]);
    }

    logger.info('SMS Worker stopped');
  }

  // ─── Balance check loop (every 60 seconds) ────────────────
  _startBalanceCheckLoop() {
    this._balanceCheckTimer = setInterval(async () => {
      if (!this.isRunning) return;
      try {
        const health = await this.provider.healthCheck();
        this._cachedBalance = health.balance;
        logger.debug('Balance check', { balance: health.balance });
        // If we have balance and credit was blocked, maybe unblock after cooldown
        if (this.creditBlocked && this.creditBlockedUntil) {
          if (Date.now() > this.creditBlockedUntil) {
            // Cooldown expired – we can unblock
            this.creditBlocked = false;
            this.creditBlockedUntil = null;
            logger.info('Credit block lifted (cooldown expired)');
          }
        }
      } catch (err) {
        logger.warn('Balance check failed', { error: err.message });
      }
    }, BALANCE_CHECK_INTERVAL_MS);
  }

  // ─── Main poll loop ────────────────────────────────────────
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
    // 1. Recover stuck jobs (but safely – see updated recoverStuckJobs)
    await smsService.recoverStuckJobs();

    // 2. If credit is blocked, do not claim jobs – wait for cooldown
    if (this.creditBlocked) {
      logger.debug('Credit blocked – skipping job claim');
      return;
    }

    // 3. Recover low‑credit jobs (only if they are due) – but only if we have credits
    //    We rely on the cached balance check (which runs separately)
    if (this._cachedBalance && Number(this._cachedBalance) > 0) {
      const recovered = await smsService.recoverLowCreditJobs();
      if (recovered > 0) {
        logger.info('Low‑credit jobs recovered', { count: recovered });
      }
    } else {
      logger.debug('Skipping low‑credit recovery – no credits or unknown');
    }

    // 4. Claim and process jobs
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

      // ── Circuit breaker: if credit blocked, defer job ──────
      if (this.creditBlocked) {
        logger.info('Credit blocked – deferring job', { jobId });
        // Mark as failed with retryable=true and set nextRetryAt to cooldown expiry
        await smsService.markFailed(jobId, null, 'Credit temporarily blocked', {
          retryable: true,
          nextRetryAt: this.creditBlockedUntil || new Date(Date.now() + CREDIT_BLOCK_COOLDOWN_MS),
          providerResponse: { status: 'blocked' },
        });
        return { success: false, reason: 'credit_blocked' };
      }

      await this._waitForRateLimit();
      crossedProviderBoundary = true;

      // Mark on the job that we have crossed provider boundary
      // (We'll update the job in DB later, but we keep a flag in memory)
      // We'll set a flag in the job object for recovery purposes.
      // Since we are about to call the provider, we can store this flag in the job document
      // by updating the job with a temporary field. To avoid extra writes, we can
      // rely on the fact that crossedProviderBoundary is true after this point
      // and use that in the catch block.

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

      // ─── CORRECTED CLASSIFICATION ──────────────────────────

      // 1. Provider explicitly says the outcome is unknown (e.g., timeout, 5xx after POST)
      if (result.status === 'unknown') {
        await smsService.markUnknown(jobId, {
          error: result.errorMessage || 'Provider outcome unknown',
          errorCode: result.errorCode,
          reason: 'provider_uncertain',
          providerResponse: result,
        });
        return { success: false, reason: 'unknown' };
      }

      // 2. Provider explicitly rejected the SMS (e.g., 1004, invalid phone, etc.)
      if (result.status === 'failed') {
        // If it's insufficient_credits, set the circuit breaker
        if (result.errorCode === 'insufficient_credits') {
          this.creditBlocked = true;
          this.creditBlockedUntil = new Date(Date.now() + CREDIT_BLOCK_COOLDOWN_MS);
          logger.warn('Credit blocked due to insufficient credits', {
            jobId,
            until: this.creditBlockedUntil,
          });
          // Also set nextRetryAt in meta so markFailed schedules a retry after cooldown
          const meta = {
            retryable: false, // we'll handle recovery separately via the circuit breaker
            providerResponse: result,
            errorCode: result.errorCode,
            nextRetryAt: this.creditBlockedUntil,
          };
          await smsService.markFailed(jobId, null, result.errorMessage, meta);
        } else {
          await smsService.markFailed(
            jobId,
            null,
            result.errorMessage || 'Provider rejected SMS',
            {
              retryable: result.retryable === true,
              providerResponse: result,
              errorCode: result.errorCode,
            }
          );
        }
        return { success: false, reason: 'failed' };
      }

      // 3. Defensive fallback – unexpected result.status
      logger.warn('Unexpected provider result status', {
        jobId,
        status: result.status,
        result,
      });
      await smsService.markUnknown(jobId, {
        error: result.errorMessage || 'Unexpected provider response',
        errorCode: result.errorCode,
        reason: 'unexpected_provider_response',
        providerResponse: result,
      });
      return { success: false, reason: 'unknown' };

    } catch (err) {
      logger.error('SMS job unexpected error', {
        jobId,
        error: err.message,
        crossedProviderBoundary,
      });

      if (crossedProviderBoundary) {
        // We have crossed the boundary; we do not know if Celcom accepted the SMS.
        // Mark as UNKNOWN – never retry automatically.
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

      // Error before provider boundary – safe to mark failed (no chance of double‑send)
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
      creditBlocked: this.creditBlocked,
      creditBlockedUntil: this.creditBlockedUntil,
      cachedBalance: this._cachedBalance,
    };
  }
}

let workerInstance = null;
const getInstance = () => {
  if (!workerInstance) workerInstance = new SmsWorker();
  return workerInstance;
};

module.exports = { SmsWorker, getInstance };