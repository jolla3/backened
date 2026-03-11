const Inventory = require('../../models/inventory');
const Transaction = require('../../models/transaction');
const Cooperative = require('../../models/cooperative');
const logger = require('../../utils/logger');

const getInventory = async (adminId) => {
  try {
    const cooperative = await Cooperative.findById(adminId);
    if (!cooperative) throw new Error('Cooperative not found');

    const products = await Inventory.find({ category: 'feed', cooperativeId: cooperative._id });
    const lowStock = [];
    const stockoutRisk = [];

    for (const product of products) {
      const last30Days = await Transaction.aggregate([
        { $match: { type: 'feed', cooperativeId: cooperative._id, product_id: product._id, timestamp_server: { $gte: new Date(Date.now() - 30*24*60*60*1000) } } },
        { $group: { _id: null, totalQty: { $sum: '$quantity' } } }
      ]);

      const avgDailySales = last30Days[0]?.totalQty / 30 || 0;
      const daysUntilStockout = avgDailySales > 0 ? Math.floor(product.stock / avgDailySales) : null;

      if (product.stock <= product.threshold) {
        lowStock.push({
          product: product.name,
          currentStock: product.stock,
          threshold: product.threshold
        });
      }

      if (daysUntilStockout !== null && daysUntilStockout <= 14) {
        stockoutRisk.push({
          product: product.name,
          currentStock: product.stock,
          daysUntilStockout,
          restockDate: daysUntilStockout !== null ? new Date(Date.now() + daysUntilStockout * 86400000).toISOString().split('T')[0] : null
        });
      }
    }

    return { lowStock, stockoutRisk };
  } catch (error) {
    logger.warn('Inventory failed', { error: error.message });
    return getDefaultInventory();
  }
};

const getDefaultInventory = () => ({ lowStock: [], stockoutRisk: [] });

module.exports = { getInventory };