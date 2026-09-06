const pLimit = require('p-limit');
const CelcomSmsProvider = require('../providers/CelcomSmsProvider');
const smsService = require('../services/smsService');
const accountingService = require('../services/accountingService');
const { normalizePhone } = require('../utils/phoneUtils');
const logger = require('../utils/logger');
const { SMS_WORKER_CONFIG } = require('../constants/smsConstants');

const CREDIT_BLOCK_COOLDOWN_MS = 5 * 60 * 1000;      // 5 minutes
const BALANCE_CHECK_INTERVAL_MS = 60 * 1000;         // 1 minute

const SMS_UNIT_COST = parseFloat(process.env.SMS_UNIT_COST) || 0.80;

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

    // Circuit breaker / credit state
    this.creditBlocked = false;
    this.creditBlockedUntil = null;
    this._balanceCheckTimer = null;   // changed to setTimeout handle
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
      const balance = Number(health.balance);
      if (Number.isFinite(balance)) {
        this._cachedBalance = balance;
      }
      await accountingService.updateProviderBalance({
        provider: 'celcom',
        balance: balance,
        source: 'health_check',
      });
      logger.info('Celcom provider health check', {
        status: health.status,
        balance,
      });
    } catch (err) {
      logger.warn('Celcom health check failed at startup (will still try to send)', {
        error: err.message,
      });
    }

    this.isRunning = true;
    this._pollLoop();
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

  // ─── Balance check loop (recursive timeout, no overlap) ──
  _startBalanceCheckLoop() {
    const run = async () => {
      if (!this.isRunning) return;

      try {
        // If credit is blocked and cooldown hasn't expired, skip this check
        if (this.creditBlocked && this.creditBlockedUntil && Date.now() < this.creditBlockedUntil) {
          logger.debug('Credit block cooldown active – skipping balance check', {
            blockedUntil: this.creditBlockedUntil,
          });
          return;
        }

        const health = await this.provider.healthCheck();
        const balance = Number(health.balance);
        this._cachedBalance = balance;

        // Update provider state via accounting service
        await accountingService.updateProviderBalance({
          provider: 'celcom',
          balance: balance,
          source: 'health_check',
        });

        logger.debug('Balance check completed', { balance });

        // Decide credit block lifting based on actual balance
        if (this.creditBlocked) {
          if (Number.isFinite(balance) && balance > 0) {
            this.creditBlocked = false;
            this.creditBlockedUntil = null;
            logger.info('Credit block lifted – sufficient balance', { balance });
          } else {
            this.creditBlockedUntil = new Date(Date.now() + CREDIT_BLOCK_COOLDOWN_MS);
            logger.warn('Credits still unavailable – extending cooldown', {
              balance,
              nextCheckAt: this.creditBlockedUntil,
            });
          }
        }
      } catch (err) {
        logger.warn('Balance check failed', { error: err.message });
      } finally {
        // Schedule next check only after this one has fully completed
        if (this.isRunning) {
          this._balanceCheckTimer = setTimeout(run, BALANCE_CHECK_INTERVAL_MS);
        }
      }
    };

    // Start the first check immediately
    run();
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
    await smsService.recoverStuckJobs();

    if (this.creditBlocked) {
      logger.debug('Credit blocked – skipping job claim');
      return;
    }

    // Use numeric check for cached balance
    const cachedBalance = Number(this._cachedBalance);
    if (Number.isFinite(cachedBalance) && cachedBalance > 0) {
      const recovered = await smsService.recoverLowCreditJobs();
      if (recovered > 0) {
        logger.info('Low‑credit jobs recovered', { count: recovered });
      }
    } else {
      logger.debug('Skipping low‑credit recovery – no credits or unknown');
    }

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
        await smsService.markFailed(jobId, null, 'Credit temporarily blocked', {
          retryable: true,
          nextRetryAt: this.creditBlockedUntil || new Date(Date.now() + CREDIT_BLOCK_COOLDOWN_MS),
          providerResponse: { status: 'blocked' },
        });
        return { success: false, reason: 'credit_blocked' };
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

          try {
            await accountingService.recordSmsUsage({
              smsJobId: jobId,
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
          } catch (accountingErr) {
            logger.error('Failed to record SMS usage', {
              jobId,
              error: accountingErr.message,
            });
          }

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

      // Provider says outcome unknown
      if (result.status === 'unknown') {
        await smsService.markUnknown(jobId, {
          error: result.errorMessage || 'Provider outcome unknown',
          errorCode: result.errorCode,
          reason: 'provider_uncertain',
          providerResponse: result,
        });
        return { success: false, reason: 'unknown' };
      }

      // Provider rejected
      if (result.status === 'failed') {
        if (result.errorCode === 'insufficient_credits') {
          this.creditBlocked = true;
          this.creditBlockedUntil = new Date(Date.now() + CREDIT_BLOCK_COOLDOWN_MS);
          logger.warn('Credit blocked due to insufficient credits', {
            jobId,
            until: this.creditBlockedUntil,
          });
          const meta = {
            retryable: false,
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

      // Unexpected result status
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