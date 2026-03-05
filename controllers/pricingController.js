const pricingService = require('../services/pricingService');

const updateRate = async (req, res) => {
  try {
    const { type, rate, effective_date } = req.body;
    const rateVersion = await pricingService.updateRate(type, rate, effective_date, req.user.id);
    res.json(rateVersion);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

const getHistory = async (req, res) => {
  try {
    const history = await pricingService.getHistory(req.params.type);
    res.json(history);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

module.exports = { updateRate, getHistory };