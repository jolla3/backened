/**
 * SMS admin / test endpoints
 * All sending goes through smsService → OutboundSms → worker → Celcom
 */
const smsService = require('../services/smsService');
const CelcomSmsProvider = require('../providers/CelcomSmsProvider');
const logger = require('../utils/logger');

/**
 * POST /api/sms/test
 * Body: { phone, message }
 * Requires authenticated admin (middleware upstream).
 */
const testSms = async (req, res, next) => {
  try {
    const { phone, message } = req.body;
    if (!phone || !message) {
      return res.status(400).json({ error: 'phone and message are required' });
    }

    // Resolve cooperative from authenticated user / request context
    const cooperativeId = req.user?.cooperativeId || req.cooperativeId;
    if (!cooperativeId) {
      return res.status(400).json({ error: 'cooperativeId could not be resolved' });
    }

    const result = await smsService.sendSMS({
      to: phone,
      message,
      type: 'general',
      cooperativeId,
      priority: 100, // high for test
      idempotencyKey: `test_sms:${cooperativeId}:${phone}:${Date.now()}`,
      metadata: { source: 'admin_test', userId: req.user?._id },
    });

    logger.info('Test SMS queued', { jobId: result.jobId, phone });

    return res.status(202).json({
      success: true,
      jobId: result.jobId,
      queued: result.queued,
      duplicate: !!result.duplicate,
      message: 'SMS queued. Worker will deliver via Celcom.',
    });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/sms/jobs/:jobId
 */
const getJob = async (req, res, next) => {
  try {
    const status = await smsService.getJobStatus(req.params.jobId);
    return res.json(status);
  } catch (err) {
    if (err.message === 'Job not found') {
      return res.status(404).json({ error: 'Job not found' });
    }
    next(err);
  }
};

/**
 * GET /api/sms/balance
 * Returns Celcom account balance (no secrets exposed)
 */
const getBalance = async (req, res, next) => {
  try {
    const provider = new CelcomSmsProvider();
    const balance = await provider.checkBalance();
    return res.json({
      balance: balance.balance,
      currency: balance.currency || 'KES',
    });
  } catch (err) {
    logger.error('Balance check failed', { error: err.message });
    return res.status(502).json({ error: 'Unable to fetch balance from provider' });
  }
};

module.exports = {
  testSms,
  getJob,
  getBalance,
};