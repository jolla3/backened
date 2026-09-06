const logger = require('../utils/logger');
const notificationService = require('../services/notificationService');

/**
 * Send a single SMS (manual / custom).
 */
const triggerSMS = async (req, res) => {
  try {
    const userId = req.user?.id;
    const cooperativeId = req.user?.cooperativeId;

    if (!userId) {
      return res.status(401).json({ success: false, error: 'Unauthorized' });
    }
    if (!cooperativeId) {
      return res.status(400).json({
        success: false,
        error: 'User is not associated with a cooperative',
      });
    }

    const { phone, message, type, metadata } = req.body;

    if (!phone || !message) {
      return res.status(400).json({
        success: false,
        error: 'Phone and message are required',
      });
    }

    const result = await notificationService.queueSMS({
      phone,
      message,
      adminId: userId,
      cooperativeId,
      options: {
        type: type || 'custom',
        metadata: metadata || {},
        notificationType: 'manual',
      },
    });

    return res.json({
      success: true,
      jobId: result.jobId,
      queued: result.queued,
      duplicate: result.duplicate || false,
    });
  } catch (error) {
    logger.error('SMS trigger failed', {
      error: error.message,
      userId: req.user?.id,
      cooperativeId: req.user?.cooperativeId,
    });
    return res.status(400).json({ success: false, error: error.message });
  }
};

/**
 * Broadcast SMS to all (or selected) farmers.
 */
const broadcastSMS = async (req, res) => {
  try {
    const userId = req.user?.id;
    const cooperativeId = req.user?.cooperativeId;

    if (!userId) {
      return res.status(401).json({ success: false, error: 'Unauthorized' });
    }
    if (!cooperativeId) {
      return res.status(400).json({
        success: false,
        error: 'User is not associated with a cooperative',
      });
    }

    const { message, farmerIds, type, metadata } = req.body;

    if (!message) {
      return res.status(400).json({
        success: false,
        error: 'Message is required',
      });
    }

    const result = await notificationService.sendBroadcast({
      message,
      cooperativeId,
      farmerIds: farmerIds || null,
      adminId: userId,
      type: type || 'broadcast',
      metadata: metadata || {},
    });

    return res.json({
      success: true,
      total: result.total,
      queued: result.queued,
      failed: result.failed,
      details: result.details,
    });
  } catch (error) {
    logger.error('Broadcast SMS failed', {
      error: error.message,
      userId: req.user?.id,
      cooperativeId: req.user?.cooperativeId,
    });
    return res.status(500).json({
      success: false,
      error: error.message,
    });
  }
};

/**
 * Send monthly milk summary – controller only passes data to service.
 * All validation is in notificationService.
 */
const sendMonthlySummary = async (req, res) => {
  try {
    const userId = req.user?.id;
    const cooperativeId = req.user?.cooperativeId;

    if (!userId) {
      return res.status(401).json({ success: false, error: 'Unauthorized' });
    }
    if (!cooperativeId) {
      return res.status(400).json({
        success: false,
        error: 'User is not associated with a cooperative',
      });
    }

    const result = await notificationService.sendMonthlyMilkSummary({
      ...req.body,
      cooperativeId,
      adminId: userId,
    });

    return res.json({
      success: true,
      jobId: result.jobId,
      queued: result.queued,
      duplicate: result.duplicate || false,
    });
  } catch (error) {
    logger.error('Monthly summary notification failed', {
      error: error.message,
      userId: req.user?.id,
      cooperativeId: req.user?.cooperativeId,
    });
    return res.status(400).json({ success: false, error: error.message });
  }
};

/**
 * Send feed transaction notification – controller only passes data to service.
 * All validation is in notificationService.
 */
const sendFeedNotification = async (req, res) => {
  try {
    const userId = req.user?.id;
    const cooperativeId = req.user?.cooperativeId;

    if (!userId) {
      return res.status(401).json({ success: false, error: 'Unauthorized' });
    }
    if (!cooperativeId) {
      return res.status(400).json({
        success: false,
        error: 'User is not associated with a cooperative',
      });
    }

    const result = await notificationService.sendFeedTransactionNotification({
      ...req.body,
      cooperativeId,
      adminId: userId,
    });

    return res.json({
      success: true,
      jobId: result.jobId,
      queued: result.queued,
      duplicate: result.duplicate || false,
    });
  } catch (error) {
    logger.error('Feed transaction notification failed', {
      error: error.message,
      userId: req.user?.id,
      cooperativeId: req.user?.cooperativeId,
    });
    return res.status(400).json({ success: false, error: error.message });
  }
};

module.exports = {
  triggerSMS,
  broadcastSMS,
  sendMonthlySummary,
  sendFeedNotification,
};