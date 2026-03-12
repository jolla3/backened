const pricingService = require('../services/pricingService');
const logger = require('../utils/logger');

const updateRate = async (req, res) => {
  try {
    const adminId = req.user.id;
    const { type, rate, effective_date } = req.body;
    const rateVersion = await pricingService.updateRate(type, rate, effective_date, adminId);
    res.json(rateVersion);
  } catch (error) {
    logger.error('Update rate failed', { error: error.message, adminId: req.user.id });
    res.status(400).json({ error: error.message });
  }
};

const getHistory = async (req, res) => {
  try {
    const adminId = req.user.id;
    const history = await pricingService.getHistory(req.params.type, adminId);
    res.json(history);
  } catch (error) {
    logger.error('Get rate history failed', { error: error.message, adminId: req.user.id });
    res.status(400).json({ error: error.message });
  }
};

module.exports = { updateRate, getHistory };