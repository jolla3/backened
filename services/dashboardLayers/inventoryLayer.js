const Inventory = require('../../models/inventory');
const Transaction = require('../../models/transaction');
const Cooperative = require('../../models/cooperative');
const logger = require('../../utils/logger');

const getInventory = async (cooperativeId) => {
  try {
    const cooperative = await Cooperative.findById(cooperativeId);
    if (!cooperative) throw new Error('Cooperative not found');

    // Get all products (excluding deleted)
    const products = await Inventory.find({ cooperativeId: cooperative._id, stock: { $gt: -1 } }).lean();

    const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000);
    const productIds = products.map(p => p._id);

// ... inside getInventory function

const salesData = await Transaction.aggregate([
  { $match: { type: 'feed', cooperativeId: cooperative._id, timestamp_server: { $gte: thirtyDaysAgo } } },
  { $group: { _id: { $ifNull: ['$product_id', null] }, totalQty: { $sum: '$quantity' }, totalRevenue: { $sum: '$cost' } } }
]);

const topRevenue = [];
for (const sale of salesData) {
  if (sale._id === null) {
    // Unknown product
    topRevenue.push({
      _id: null,
      product: 'Other feed sales (no product ID)',
      category: 'Feed',
      revenue: sale.totalRevenue,
      quantity: sale.totalQty,
      price: sale.totalRevenue / sale.totalQty,
      unit: 'units'
    });
  } else {
    const product = products.find(p => p._id.toString() === sale._id.toString());
    if (product) {
      topRevenue.push({
        _id: product._id,
        product: product.name,
        category: product.category,
        revenue: sale.totalRevenue,
        quantity: sale.totalQty,
        price: product.price,
        unit: product.unit
      });
    }
  }
}

// Sort topRevenue by revenue descending
topRevenue.sort((a, b) => b.revenue - a.revenue);

// Return top 10, but if the first entry is "Other", you may still want to see it
return {
  lowStock,
  stockoutRisk,
  topRevenue: topRevenue.slice(0, 10),
  summary: { totalProducts: products.length, lowStockCount: lowStock.length, stockoutRiskCount: stockoutRisk.length }
};

  } catch (error) {
    logger.error('Inventory layer failed', { error: error.message, coopId: cooperativeId });
    return getDefaultInventory();
  }
};

const getDefaultInventory = () => ({
  lowStock: [],
  stockoutRisk: [],
  topRevenue: [],
  summary: { totalProducts: 0, lowStockCount: 0, stockoutRiskCount: 0 }
});

module.exports = { getInventory };