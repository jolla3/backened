const milkService = require('../services/milkService');
const logger = require('../utils/logger');

const getDailyTotal = async (req, res) => {
  try {
    const cooperativeId = req.user.cooperativeId;  // ✅ From JWT
    const total = await milkService.getDailyTotal(cooperativeId);
    res.json(total);
  } catch (error) {
    logger.error('Daily total failed', { error: error.message, coopId: req.user.cooperativeId });
    res.status(400).json({ error: error.message });
  }
};

const getMonthlySummary = async (req, res) => {
  try {
    const cooperativeId = req.user.cooperativeId;  // ✅ From JWT
    const summary = await milkService.getMonthlySummary(
      parseInt(req.query.year), 
      parseInt(req.query.month), 
      cooperativeId
    );
    res.json(summary);
  } catch (error) {
    logger.error('Monthly summary failed', { error: error.message, coopId: req.user.cooperativeId });
    res.status(400).json({ error: error.message });
  }
};

module.exports = { getDailyTotal, getMonthlySummary };