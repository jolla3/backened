const dashboardService = require('../services/dashboardService');

const getTotals = async (req, res) => {
  try {
    const totals = await dashboardService.getTotals();
    res.json(totals);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

const getOverview = async (req, res) => {
  try {
    const overview = await dashboardService.getOverview(req.query.period);
    res.json(overview);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

module.exports = { getTotals, getOverview };