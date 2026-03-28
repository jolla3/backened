const Inventory = require('../../models/inventory');
const Transaction = require('../../models/transaction');
const Cooperative = require('../../models/cooperative');
const logger = require('../../utils/logger');
const feedAnalytics = require('../../analytics/feedAnalytics'); // the module with getTopFeedProducts, etc.
const inventoryVelocity = require('../../analytics/inventoryVelocity'); // for velocity

const getInventory = async (cooperativeId) => {
  try {
    const cooperative = await Cooperative.findById(cooperativeId);
    if (!cooperative) throw new Error('Cooperative not found');

    // Get all products (excluding deleted)
    const products = await Inventory.find({ cooperativeId: cooperative._id, stock: { $gt: -1 } }).lean();

    // Get top revenue products using feedAnalytics
    const topRevenueProducts = await feedAnalytics.getTopFeedProducts(10, cooperativeId);

    // Get stock risk using feedAnalytics (low stock)
    const stockRisk = await feedAnalytics.getFeedStockRisk(cooperativeId);
    // Filter those with riskLevel 'critical' or 'high' for stockout risk, and low stock separately
    const lowStock = stockRisk
      .filter(item => item.currentStock <= item.threshold)
      .map(item => ({
        _id: item.productId,
        product: item.productName,
        category: 'Feed',
        currentStock: item.currentStock,
        threshold: item.threshold,
        avgDailySales: item.avgDailySales,
        daysUntilStockout: item.daysUntilStockout,
        unit: 'units' // could get from Inventory
      }));

    const stockoutRisk = stockRisk
      .filter(item => item.daysUntilStockout <= 7 && item.daysUntilStockout > 0)
      .map(item => ({
        _id: item.productId,
        product: item.productName,
        currentStock: item.currentStock,
        avgDailySales: item.avgDailySales,
        daysUntilStockout: item.daysUntilStockout,
        restockBy: new Date(Date.now() + item.daysUntilStockout * 86400000).toISOString().split('T')[0]
      }));

    // Get inventory velocity
    const velocity = await inventoryVelocity.getInventoryVelocity(cooperativeId);

    // Combine top revenue products with inventory details (price, unit)
    const topRevenue = topRevenueProducts.map(prod => ({
      _id: prod.productId,
      product: prod.productName,
      category: prod.category,
      revenue: prod.totalCost,
      quantity: prod.totalQuantity,
      price: prod.avgCostPerUnit,
      unit: 'units' // you might get from inventory if needed
    }));

    return {
      lowStock,
      stockoutRisk,
      topRevenue,
      velocity,
      summary: {
        totalProducts: products.length,
        lowStockCount: lowStock.length,
        stockoutRiskCount: stockoutRisk.length
      }
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
  velocity: [],
  summary: { totalProducts: 0, lowStockCount: 0, stockoutRiskCount: 0 }
});

module.exports = { getInventory };