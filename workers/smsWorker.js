const pLimit = require('p-limit');
const CelcomSmsProvider = require('../providers/CelcomSmsProvider');
const smsService = require('../services/smsService');
const accountingService = require('../services/accountingService');
const { normalizePhone, isValidKenyanPhone } = require('../utils/phoneUtils');
const logger = require('../utils/logger');

// Configuration constants (overridable via env)
const SMS_WORKER_CONFIG = {
  pollInterval: parseInt(process.env.SMS_POLL_INTERVAL_MS || '5000', 10),
  batchSize: parseInt(process.env.SMS_BATCH_SIZE || '50', 10),
  concurrency: parseInt(process.env.SMS_CONCURRENCY || '1', 10),   // default 1 for now
  rateLimitPerSecond: parseInt(process.env.SMS_RATE_LIMIT_PER_SECOND || '1', 10),
  requestTimeout: parseInt(process.env.SMS_REQUEST_TIMEOUT_MS || '15000', 10),
  creditBlockCooldownMs: parseInt(process.env.CREDIT_BLOCK_COOLDOWN_MS || '300000', 10), // 5 min
};

const CREDIT_BLOCK_COOLDOWN_MS = SMS_WORKER_CONFIG.creditBlockCooldownMs;

// SMS unit cost for accounting (must be defined; override via env)
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
    this._activeJobs = new Set();      // track in‑flight job IDs
    this._currentBatch = [];           // current batch being processed
    this._pollInProgress = false;      // prevent overlapping poll loops

    // Rate limiter (token bucket)
    this._rateLimiter = {
      tokens: this.config.rateLimitPerSecond,
      lastRefill: Date.now(),
      refillRate: this.config.rateLimitPerSecond, // tokens per second
      maxTokens: this.config.rateLimitPerSecond,
    };

    // Concurrency limiter
    this.limiter = pLimit(this.config.concurrency);

    this._pollTimer = null;
    this._balanceTimer = null;
    this._shuttingDown = false;
  }

  // ─── Public API ─────────────────────────────────────────────

  async start() {
    if (this._pollTimer) return;
    logger.info('SMS Worker started', this.config);

    // Main poll loop
    this._pollTimer = setInterval(() => {
      this._pollLoop().catch(err => logger.error('Poll loop error', { error: err.message }));
    }, this.config.pollInterval);

    // Balance check loop (informational only, does not unblock)
    this._balanceTimer = setInterval(() => {
      this._checkBalance().catch(err => logger.warn('Balance check error', { error: err.message }));
    }, this.config.pollInterval * 6); // e.g. every 30s

    // Immediately run a poll
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

  // ─── Balance Check (informational) ──────────────────────────

  async _checkBalance() {
    try {
      const health = await this.provider.healthCheck();
      const balance = Number(health.balance);
      if (Number.isFinite(balance)) {
        this._cachedBalance = balance;
      }

      // Update accounting (if service exists)
      try {
        await accountingService.updateProviderBalance({
          provider: 'celcom',
          balance: Number.isFinite(balance) ? balance : null,
          source: 'health_check',
        });
      } catch (err) {
        logger.warn('Failed to update provider balance in accounting', { error: err.message });
      }

      logger.debug('Balance check completed', { balance });
      // NOTE: Do NOT clear creditBlocked based on balance
    } catch (error) {
      logger.warn('Balance check failed', { error: error.message });
    }
  }

  // ─── Main Poll Loop ─────────────────────────────────────────

  async _pollLoop() {
    if (this._shuttingDown) return;

    // Prevent overlapping executions of the poll loop
    if (this._pollInProgress) {
      logger.debug('SMS poll skipped: previous poll still running');
      return;
    }

    this._pollInProgress = true;

    try {
      // Recover stuck jobs (process that timed out)
      await smsService.recoverStuckJobs();

      // If credit is blocked, handle controlled recovery
      if (this.creditBlocked) {
        await this._handleCreditBlocked();
        return; // do not process normal queue while blocked
      }

      // Normal processing: claim a batch of jobs (batchSize)
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

  // ─── Batch Processing ───────────────────────────────────────

  async _processBatch(jobs) {
    logger.info(`Processing batch of ${jobs.length} SMS jobs`);
    const tasks = jobs.map(job => this.limiter(() => this._processJob(job)));
    await Promise.all(tasks);
  }

  // ─── Job Processing ─────────────────────────────────────────

  async _processJob(job) {
    const jobId = job._id.toString();
    this._activeJobs.add(jobId);

    try {
      // Guard: if credit was blocked by an earlier job in this same batch
      // (or by a concurrent path), do NOT call Celcom again.
      // Mark the already-claimed job as deferred low-credit so it can be
      // recovered later via recoverLowCreditJobs / nextRetryAt.
      if (this.creditBlocked) {
        await smsService.markFailed(jobId, null, 'SMS worker blocked due to insufficient credits', {
          retryable: false,
          errorCode: 'insufficient_credits',
          nextRetryAt: this.creditBlockedUntil,
        });
        return { success: false, reason: 'credit_blocked' };
      }

      // 1. Normalize and validate phone INSIDE try/catch
      //    so a throw cannot leave the job stuck in processing
      const phone = normalizePhone(job.phone);
      if (!isValidKenyanPhone(phone)) {
        await smsService.markFailed(jobId, null, 'Invalid Kenyan phone number', {
          retryable: false,
          errorCode: 'invalid_phone',
        });
        return { success: false, reason: 'invalid_phone' };
      }

      // 2. Rate limit wait
      await this._waitForRateLimit();

      // 3. Send via provider
      const result = await this.provider.send(phone, job.message, job.idempotencyKey);

      // 4. Handle result
      if (result.status === 'accepted') {
        // Definitive success → mark sent and record usage
        await smsService.markSent(jobId, null, result);
        await this._recordSmsUsage(job, result);
        return { success: true };
      }

      if (result.status === 'failed') {
        if (result.errorCode === 'insufficient_credits') {
          // Credit block: set state and mark job as low-credit failed
          this.creditBlocked = true;
          this.creditBlockedUntil = new Date(Date.now() + CREDIT_BLOCK_COOLDOWN_MS);
          await smsService.markFailed(jobId, null, result.errorMessage, {
            retryable: false,
            errorCode: result.errorCode,
            providerResponse: result,
            nextRetryAt: this.creditBlockedUntil,
          });
          logger.warn('Credit blocked due to insufficient credits', {
            jobId,
            until: this.creditBlockedUntil,
          });
          return { success: false, reason: 'insufficient_credits' };
        } else {
          // Other deterministic failure → mark failed, don't touch credit state
          await smsService.markFailed(jobId, null, result.errorMessage, {
            retryable: result.retryable,
            errorCode: result.errorCode,
            providerResponse: result,
          });
          return { success: false, reason: 'failed' };
        }
      }

      if (result.status === 'unknown') {
        // Provider outcome uncertain → mark unknown, do NOT retry automatically
        await smsService.markUnknown(jobId, {
          errorCode: result.errorCode,
          providerMessageId: result.providerMessageId,
          reason: 'provider_uncertain',
        });
        return { success: false, reason: 'unknown' };
      }

      // Fallback unknown
      await smsService.markUnknown(jobId, { error: 'Unexpected provider result' });
      return { success: false, reason: 'unexpected' };
    } catch (error) {
      // Any unexpected error inside processing → mark unknown to avoid stuck
      logger.error('Unexpected error in _processJob', { jobId, error: error.message });
      try {
        await smsService.markUnknown(jobId, {
          error: error.message,
          errorCode: 'worker_internal_error',
        });
      } catch (markErr) {
        logger.error('Failed to mark job unknown after internal error', { jobId, error: markErr.message });
      }
      return { success: false, reason: 'internal_error' };
    } finally {
      this._activeJobs.delete(jobId);
    }
  }

  // ─── Controlled Recovery after Credit Block ─────────────────

  async _handleCreditBlocked() {
    if (this.creditProbeInProgress) return;
    if (!this.creditBlockedUntil || Date.now() < this.creditBlockedUntil.getTime()) {
      // Still in cooldown
      return;
    }

    // Cooldown expired: attempt one recovery probe
    this.creditProbeInProgress = true;
    let jobId = null;

    try {
      const jobs = await smsService.claimJobsForWorker(1); // claim exactly one real queued job
      if (jobs.length === 0) {
        // No jobs to probe; keep block but don't extend if queue empty
        return;
      }

      const job = jobs[0];
      jobId = job._id.toString();
      this._activeJobs.add(jobId);

      logger.info('Credit recovery probe: sending one job', { jobId });

      // Normalize + validate INSIDE the protected path (same safety as _processJob)
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
        // Do not clear block; extend to avoid tight loop
        this.creditBlockedUntil = new Date(Date.now() + CREDIT_BLOCK_COOLDOWN_MS);
        return;
      }

      await this._waitForRateLimit();
      const result = await this.provider.send(phone, job.message, job.idempotencyKey);

      if (result.status === 'accepted') {
        // Probe succeeded: clear block, mark job sent, record usage
        // Protect markSent + accounting so a Mongo transient does not leave
        // a Celcom-accepted job stuck in processing and re-block the worker.
        try {
          await smsService.markSent(jobId, null, result);
          await this._recordSmsUsage(job, result);
          this.creditBlocked = false;
          this.creditBlockedUntil = null;
          logger.info('Credit block cleared via successful probe');
        } catch (persistErr) {
          // Celcom already accepted. Mark unknown so we never resend.
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
          // Keep block conservative; next probe will use a different job
          this.creditBlocked = true;
          this.creditBlockedUntil = new Date(Date.now() + CREDIT_BLOCK_COOLDOWN_MS);
        }
      } else if (result.errorCode === 'insufficient_credits') {
        // Probe still rejected: keep block, extend cooldown, mark job low-credit failed
        this.creditBlocked = true;
        this.creditBlockedUntil = new Date(Date.now() + CREDIT_BLOCK_COOLDOWN_MS);
        await smsService.markFailed(jobId, null, result.errorMessage, {
          retryable: false,
          errorCode: result.errorCode,
          providerResponse: result,
          nextRetryAt: this.creditBlockedUntil,
        });
        logger.warn('Credit recovery probe rejected again, extending block');
      } else if (result.status === 'unknown') {
        // Uncertain outcome: mark unknown, keep block conservative
        await smsService.markUnknown(jobId, {
          errorCode: result.errorCode,
          providerMessageId: result.providerMessageId,
          reason: 'probe_unknown',
        });
        this.creditBlocked = true;
        this.creditBlockedUntil = new Date(Date.now() + CREDIT_BLOCK_COOLDOWN_MS);
        logger.warn('Credit recovery probe unknown, keeping block');
      } else {
        // Other definitive failure: mark failed normally, keep block
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
      // If we claimed a job, ensure it is not left in processing
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
      // Keep block and extend cooldown on unexpected error
      this.creditBlocked = true;
      this.creditBlockedUntil = new Date(Date.now() + CREDIT_BLOCK_COOLDOWN_MS);
    } finally {
      this.creditProbeInProgress = false;
      if (jobId) {
        this._activeJobs.delete(jobId);
      }
    }
  }

  // ─── Rate Limiter ───────────────────────────────────────────

  async _waitForRateLimit() {
    const now = Date.now();
    const elapsed = (now - this._rateLimiter.lastRefill) / 1000;

    // Refill tokens
    this._rateLimiter.tokens = Math.min(
      this._rateLimiter.maxTokens,
      this._rateLimiter.tokens + elapsed * this._rateLimiter.refillRate
    );
    this._rateLimiter.lastRefill = now;

    if (this._rateLimiter.tokens >= 1) {
      this._rateLimiter.tokens -= 1;
      return;
    }

    // Need to wait for next token
    const waitMs = Math.ceil((1 - this._rateLimiter.tokens) / this._rateLimiter.refillRate * 1000);
    await new Promise(resolve => setTimeout(resolve, waitMs));

    // After waiting, consume token (we can assume enough time has passed)
    this._rateLimiter.tokens = 0;
    this._rateLimiter.lastRefill = Date.now();
  }

  // ─── SMS Usage Accounting ───────────────────────────────────

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
      // Accounting failure must never cause SMS resend.
      // Log and continue; make recordSmsUsage idempotent on smsJobId / providerMessageId long-term.
      logger.error('Failed to record SMS usage', { jobId: job._id, error: error.message });
    }
  }

  // ─── Stuck Jobs Recovery (delegated to smsService) ──────────

  async _recoverStuckJobs() {
    await smsService.recoverStuckJobs();
  }

  // ─── Low Credit Jobs Recovery (delegated to smsService) ─────
  // Note: We do NOT automatically call this unless we have a successful probe.
  // It may be called manually or via a separate admin endpoint.

  async _recoverLowCreditJobs() {
    await smsService.recoverLowCreditJobs();
  }
}


// ─── Singleton ──────────────────────────────────────────────
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

