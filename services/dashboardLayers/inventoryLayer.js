const Inventory = require('../../models/inventory');
const Transaction = require('../../models/transaction');
const Cooperative = require('../../models/cooperative');
const logger = require('../../utils/logger');

const getInventory = async (cooperativeId) => {  // ✅ FIXED
  try {
    const cooperative = await Cooperative.findById(cooperativeId);
    if (!cooperative) throw new Error('Cooperative not found');

    const products = await Inventory.find({ 
      cooperativeId: cooperative._id,
      category: 'feed' 
    }).sort({ name: 1 });

    const lowStock = [];
    const stockoutRisk = [];
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

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

      if (product.stock <= product.threshold) {
        lowStock.push({
          _id: product._id,
          product: product.name,
          currentStock: product.stock,
          threshold: product.threshold,
          category: product.category
        });
      }

      if (daysUntilStockout <= 7 && daysUntilStockout > 0) {
        stockoutRisk.push({
          _id: product._id,
          product: product.name,
          currentStock: product.stock,
          avgDailySales: Math.round(avgDailySales),
          daysUntilStockout,
          restockBy: new Date(Date.now() + daysUntilStockout * 86400000).toISOString().split('T')[0]
        });
      }
    }

    return { 
      lowStock: lowStock.sort((a, b) => a.currentStock - b.currentStock),
      stockoutRisk: stockoutRisk.sort((a, b) => a.daysUntilStockout - b.daysUntilStockout)
    };
  } catch (error) {
    logger.warn('Inventory failed', { error: error.message, coopId });
    return getDefaultInventory();
  }
};

const getDefaultInventory = () => ({ lowStock: [], stockoutRisk: [] });

module.exports = { getInventory };