const pricingService = require('../services/pricingService');
const logger = require('../utils/logger');

const updateMilkRate = async (req, res) => {
  try {
    const adminId = req.user.id;
    const { rate, effectiveDate, notes } = req.body;
    
    const rateVersion = await pricingService.updateMilkRate(
      Number(rate), 
      effectiveDate, 
      adminId
    );
    
    res.json(rateVersion);
  } catch (error) {
    logger.error('Update milk rate failed', { error: error.message });
    res.status(400).json({ error: error.message });
  }
};

const updateInventoryCategory = async (req, res) => {
  try {
    const adminId = req.user.id;
    const { category, price } = req.body;
    
    const result = await pricingService.updateInventoryCategoryPrice(
      category, 
      Number(price), 
      adminId
    );
    
    res.json(result);
  } catch (error) {
    logger.error('Update inventory category failed', { error: error.message });
    res.status(400).json({ error: error.message });
  }
};

const getMilkHistory = async (req, res) => {
  try {
    const history = await pricingService.getMilkHistory(req.user.id);
    res.json(history);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

const getInventoryCategories = async (req, res) => {
  try {
    const categories = await pricingService.getInventoryCategories(req.user.id);
    res.json(categories);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

const getCurrentPrices = async (req, res) => {
  try {
    const prices = await pricingService.getCurrentPrices(req.user.id);
    res.json(prices);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

module.exports = { 
  updateMilkRate, 
  updateInventoryCategory, 
  getMilkHistory, 
  getInventoryCategories, 
  getCurrentPrices 
};