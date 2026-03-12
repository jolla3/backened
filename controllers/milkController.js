const milkService = require('../services/milkService');
const logger = require('../utils/logger');

const getDailyTotal = async (req, res) => {
  try {
    const adminId = req.user.id;
    const total = await milkService.getDailyTotal(req.query.date, adminId);
    res.json(total);
  } catch (error) {
    logger.error('Daily total failed', { error: error.message, adminId: req.user.id });
    res.status(400).json({ error: error.message });
  }
};

const getMonthlySummary = async (req, res) => {
  try {
    const adminId = req.user.id;
    const summary = await milkService.getMonthlySummary(req.query.year, req.query.month, adminId);
    res.json(summary);
  } catch (error) {
    logger.error('Monthly summary failed', { error: error.message, adminId: req.user.id });
    res.status(400).json({ error: error.message });
  }
};

module.exports = { getDailyTotal, getMonthlySummary };