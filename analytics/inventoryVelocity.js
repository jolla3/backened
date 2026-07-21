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
      cooperativeId: cooperative._id,
      deleted: { $ne: true }
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
      
      let urgency = 'LOW';
      if (avgDailySales > 0) {
        if (daysUntilStockout <= 3) urgency = 'CRITICAL';
        else if (daysUntilStockout <= 7) urgency = 'URGENT';
        else if (daysUntilStockout <= 14) urgency = 'MEDIUM';
        else urgency = 'LOW';
      }

      velocity.push({
        _id: product._id,
        product: product.name,
        currentStock: product.stock,
        threshold: product.threshold,
        soldPerWeek: Math.round(avgDailySales * 7),
        avgDailySales: Math.round(avgDailySales),
        daysUntilStockout: daysUntilStockout === Infinity ? 'N/A' : daysUntilStockout,
        urgency, // ✅ renamed from velocity
        restockBy: daysUntilStockout <= 14 ? 
          new Date(Date.now() + daysUntilStockout * 86400000).toISOString().split('T')[0] : 
          null,
        trend: avgDailySales > 0 ? 'STABLE' : 'NONE',
        percentChange: '0%' // placeholder
      });
    }

    return velocity.sort((a, b) => {
      const aDays = a.daysUntilStockout === 'N/A' ? Infinity : parseInt(a.daysUntilStockout);
      const bDays = b.daysUntilStockout === 'N/A' ? Infinity : parseInt(b.daysUntilStockout);
      return aDays - bDays;
    });
  } catch (error) {
    logger.error('InventoryVelocity failed', { error: error.message, coopId });
    return [];
  }
};

module.exports = { getInventoryVelocity };