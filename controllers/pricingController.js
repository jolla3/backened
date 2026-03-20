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
    const { itemId } = req.params;  // ✅ /inventory/:itemId
    const { price } = req.body;
    const adminId = req.user.id;
    const cooperativeId = req.user.cooperativeId;
    
    const result = await pricingService.updateInventoryCategory(
      itemId, price, adminId, cooperativeId
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

const getCurrentPrices = async (cooperativeId) => {
  const cooperative = await Cooperative.findById(cooperativeId);
  if (!cooperative) throw new Error('Cooperative not found');
  
  // ✅ FIX 1: Get LATEST milk rate (most recent effective_date)
  const milkRate = await RateVersion.findOne({ 
    type: 'milk', 
    cooperativeId: cooperative._id 
  })
  .sort({ effective_date: -1 })  // Latest first
  .lean();
  
  // ✅ FIX 2: FULL categories data (for frontend table)
  const categories = await Inventory.aggregate([
    { $match: { cooperativeId: cooperative._id } },
    {
      $group: {
        _id: '$category',
        items: {
          $push: {
            _id: '$_id',
            name: '$name',
            price: '$price',
            stock: '$stock',
            unit: '$unit',
            threshold: '$threshold'
          }
        },
        itemCount: { $sum: 1 },
        avgPrice: { $avg: '$price' }
      }
    },
    { $sort: { _id: 1 } }
  ]);
  
  return { 
    milkRate, 
    categories,
    totalItems: categories.reduce((sum, cat) => sum + cat.itemCount, 0)
  };
};
module.exports = { 
  updateMilkRate, 
  updateInventoryCategory, 
  getMilkHistory, 
  getInventoryCategories, 
  getCurrentPrices 
};