const Inventory = require('../models/inventory');
const Transaction = require('../models/transaction');
const Cooperative = require('../models/cooperative');
const logger = require('../utils/logger');

const getInventoryVelocity = async (cooperativeId) => {
  try {
    const cooperative = await Cooperative.findById(cooperativeId);
    if (!cooperative) throw new Error('Cooperative not found');

    const products = await Inventory.find({ 
      category: 'feed', 
      cooperativeId: cooperative._id 
    }).sort({ name: 1 });

    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const velocity = [];

    for (const product of products) {
      const last30DaysSales = await Transaction.aggregate([
        { 
          $match: { 
            type: 'feed', 
            cooperativeId: cooperative._id, 
            product_id: product._id, 
            timestamp_server: { $gte: thirtyDaysAgo } 
          } 
        },
        { $group: { _id: null, totalQty: { $sum: { $ifNull: ['$quantity', 0] } } } }
      ]);

      const avgDailySales = last30DaysSales[0]?.totalQty / 30 || 0;
      const daysUntilStockout = avgDailySales > 0 ? Math.floor(product.stock / avgDailySales) : Infinity;
      
      let velocityLevel = 'NONE';
      if (avgDailySales > 0) {
        if (daysUntilStockout <= 7) velocityLevel = 'HIGH';
        else if (daysUntilStockout <= 14) velocityLevel = 'MEDIUM';
        else velocityLevel = 'LOW';
      }

      velocity.push({
        _id: product._id,
        product: product.name,
        currentStock: product.stock,
        threshold: product.threshold,
        soldPerWeek: Math.round(avgDailySales * 7),
        avgDailySales: Math.round(avgDailySales),
        turnoverDays: daysUntilStockout === Infinity ? 'N/A' : daysUntilStockout,
        restockBy: daysUntilStockout <= 14 ? 
          new Date(Date.now() + daysUntilStockout * 86400000).toISOString().split('T')[0] : 
          null,
        velocity: velocityLevel
      });
    }

    return velocity.sort((a, b) => {
      const aDays = a.turnoverDays === 'N/A' ? Infinity : parseInt(a.turnoverDays);
      const bDays = b.turnoverDays === 'N/A' ? Infinity : parseInt(b.turnoverDays);
      return aDays - bDays;
    });
  } catch (error) {
    logger.error('InventoryVelocity failed', { error: error.message, coopId });
    return [];
  }
};

module.exports = { getInventoryVelocity };