const pricingService = require('../services/pricingService');
const logger = require('../utils/logger');


const updateMilkRate = async (req, res) => {
  try {
    const { rate, effectiveDate, notes } = req.body;
    const adminId = req.user.id;  // For audit trail
    const cooperativeId = req.user.cooperativeId;  // ✅ FROM JWT
    
    const rateVersion = await pricingService.updateMilkRate(
      Number(rate), effectiveDate, adminId, cooperativeId
    );
    
    res.json(rateVersion);
  } catch (error) {
    logger.error('Update milk rate failed', { 
      error: error.message, 
      userId: req.user.id, 
      coopId: req.user.cooperativeId 
    });
    res.status(400).json({ error: error.message });
  }
};

const updateInventoryCategory = async (req, res) => {
  try {
    const { itemId } = req.params;
    const updates = req.body; // ✅ Now {price?, stock?, unit?, threshold?}
    const adminId = req.user.id;
    const cooperativeId = req.user.cooperativeId;
    
    const result = await pricingService.updateInventoryCategory(
      itemId, updates, adminId, cooperativeId
    );
    
    res.json(result);
  } catch (error) {
    logger.error('Update inventory item failed', { 
      error: error.message, 
      userId: req.user.id, 
      coopId: req.user.cooperativeId 
    });
    res.status(400).json({ error: error.message });
  }
};
const getMilkHistory = async (req, res) => {
  try {
    const cooperativeId = req.user.cooperativeId;  // ✅ FROM JWT
    const history = await pricingService.getMilkHistory(cooperativeId);
    res.json(history);
  } catch (error) {
    logger.error('Get milk history failed', { 
      error: error.message, 
      userId: req.user.id, 
      coopId: req.user.cooperativeId 
    });
    res.status(400).json({ error: error.message });
  }
};

const getInventoryCategories = async (req, res) => {
  try {
    const cooperativeId = req.user.cooperativeId;
    const categories = await pricingService.getInventoryCategories(cooperativeId);
    res.json(categories); // Now returns [{ _id: 'Feed', items: [...], itemCount: 5, avgPrice: 2500 }, ...]
  } catch (error) {
    logger.error('Get inventory categories failed', { 
      error: error.message, 
      userId: req.user.id, 
      coopId: req.user.cooperativeId 
    });
    res.status(400).json({ error: error.message });
  }
};

// ✅ CONTROLLER - Just wrapper
const getCurrentPrices = async (req, res) => {
  try {
    const cooperativeId = req.user.cooperativeId;
    const data = await pricingService.getCurrentPrices(cooperativeId);
    res.json(data);
  } catch (error) {
    logger.error('Get current prices failed', { 
      error: error.message, 
      userId: req.user.id 
    });
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