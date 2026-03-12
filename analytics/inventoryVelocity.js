const Inventory = require('../models/inventory');
const Transaction = require('../models/transaction');

const getInventoryVelocity = async (adminId) => {
  const cooperative = await require('../models/cooperative').findById(adminId);
  if (!cooperative) throw new Error('Cooperative not found');

  const products = await Inventory.find({ category: 'feed', cooperativeId: cooperative._id });
  const velocity = [];

  for (const product of products) {
    const last30Days = await Transaction.aggregate([
      { $match: { type: 'feed', cooperativeId: cooperative._id, product_id: product._id, timestamp_server: { $gte: new Date(Date.now() - 30*24*60*60*1000) } } },
      { $group: { _id: null, totalQty: { $sum: '$quantity' } } }
    ]);

    const avgDailySales = last30Days[0]?.totalQty / 30 || 0;
    const daysUntilStockout = avgDailySales > 0 ? Math.floor(product.stock / avgDailySales) : null;
    const restockDate = daysUntilStockout !== null ? new Date(Date.now() + daysUntilStockout * 86400000) : null;

    let velocityLevel = 'NONE';
    if (avgDailySales > 0) {
      if (daysUntilStockout !== null && daysUntilStockout <= 7) velocityLevel = 'HIGH';
      else if (daysUntilStockout !== null && daysUntilStockout <= 14) velocityLevel = 'MEDIUM';
      else velocityLevel = 'LOW';
    }

    velocity.push({
      product: product.name,
      currentStock: product.stock,
      soldPerWeek: avgDailySales * 7,
      turnoverDays: daysUntilStockout,
      restockDate: restockDate ? restockDate.toISOString().split('T')[0] : null,
      velocity: velocityLevel
    });
  }

  return velocity.sort((a, b) => (a.turnoverDays || Infinity) - (b.turnoverDays || Infinity));
};

module.exports = { getInventoryVelocity };