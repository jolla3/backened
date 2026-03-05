const milkService = require('../services/milkService');

const getDailyTotal = async (req, res) => {
  try {
    const total = await milkService.getDailyTotal(req.query.date);
    res.json(total);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

const getMonthlySummary = async (req, res) => {
  try {
    const summary = await milkService.getMonthlySummary(req.query.year, req.query.month);
    res.json(summary);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

module.exports = { getDailyTotal, getMonthlySummary };