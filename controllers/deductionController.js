const { createManualDeduction } = require('../services/farmerDeductionService');
const logger = require('../utils/logger');

const createDeduction = async (req, res) => {
  try {
    const { farmerId } = req.params;
    const { reason, amount, items, description } = req.body;

    const cooperativeId = req.user.cooperativeId;
    const adminId = req.user.id;

    if (!cooperativeId) {
      return res.status(400).json({ success: false, error: 'Cooperative context missing' });
    }

    const result = await createManualDeduction({
      farmerId,
      reason,
      amount,
      items,
      description,
      cooperativeId,
      adminId,
    });

    return res.status(201).json(result);
  } catch (error) {
    logger.error('Deduction controller error', {
      error: error.message,
      farmerId: req.params.farmerId,
      userId: req.user?.id,
    });

    const status =
      error.message.includes('not found') ||
      error.message.includes('Invalid') ||
      error.message.includes('required') ||
      error.message.includes('Insufficient')
        ? 400
        : 500;

    return res.status(status).json({
      success: false,
      error: error.message || 'Failed to process deduction',
    });
  }
};

module.exports = { createDeduction };