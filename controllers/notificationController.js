const notificationService = require('../services/notificationService');
const logger = require('../utils/logger');

/**
 * Trigger a custom SMS notification (admin-initiated).
 * Expects { phone, message } in request body.
 * Uses the same queue as milk receipts.
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

    // Queue the SMS via the unified notification service
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

module.exports = { triggerSMS };