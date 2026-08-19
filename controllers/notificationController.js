const logger = require('../utils/logger');
const notificationService = require('../services/notificationService');
const Farmer = require('../models/farmer');
const smsService = require('../services/smsService');

/**
 * Send a single SMS (existing endpoint)
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

    return res.status(400).json({
      success: false,
      error: error.message,
    });
  }
};

/**
 * Broadcast SMS to all (or selected) farmers in the cooperative.
 * Expects { message, farmerIds? } in request body.
 * If farmerIds is omitted, sends to all active farmers with phone numbers.
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

    // Build query for farmers
    const query = {
      cooperativeId,
      isActive: true,
      phone: { $ne: null, $ne: '' },
    };
    if (farmerIds && Array.isArray(farmerIds) && farmerIds.length > 0) {
      query._id = { $in: farmerIds };
    }

    const farmers = await Farmer.find(query).select('_id phone name').lean();
    if (farmers.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'No active farmers with phone numbers found',
      });
    }

    // Queue SMS for each farmer
    const results = [];
    let queued = 0;
    let failed = 0;

    for (const farmer of farmers) {
      try {
        const result = await smsService.queueSMS({
          to: farmer.phone,
          message,
          type: type || 'broadcast',
          cooperativeId,
          farmerId: farmer._id,
          metadata: {
            ...metadata,
            broadcast: true,
            adminId: userId,
          },
        });
        results.push({ farmerId: farmer._id, jobId: result.jobId, queued: result.queued });
        if (result.queued) queued++;
        else failed++;
      } catch (err) {
        logger.error('Broadcast: failed to queue for farmer', {
          farmerId: farmer._id,
          error: err.message,
        });
        failed++;
        results.push({ farmerId: farmer._id, error: err.message });
      }
    }

    logger.info('Broadcast SMS completed', {
      cooperativeId,
      adminId: userId,
      total: farmers.length,
      queued,
      failed,
    });

    return res.json({
      success: true,
      total: farmers.length,
      queued,
      failed,
      details: results,
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

module.exports = { triggerSMS, broadcastSMS };