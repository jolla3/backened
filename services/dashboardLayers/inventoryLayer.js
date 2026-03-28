const Inventory = require('../../models/inventory');
const Cooperative = require('../../models/cooperative');
const logger = require('../../utils/logger');
const feedAnalytics = require('../../analytics/feedAnalytics');
const inventoryVelocity = require('../../analytics/inventoryVelocity');

const getInventory = async (cooperativeId) => {
  try {
    const cooperative = await Cooperative.findById(cooperativeId);
    if (!cooperative) throw new Error('Cooperative not found');

    // Get all products (excluding deleted) – used for total count
    const products = await Inventory.find({ cooperativeId: cooperative._id, stock: { $gt: -1 } }).lean();

    // 1. Top revenue products (last 30 days)
    const topRevenueProducts = await feedAnalytics.getTopFeedProducts(10, cooperativeId);

    // 2. Stock risk (low stock & stockout risk)
    const stockRisk = await feedAnalytics.getFeedStockRisk(cooperativeId);

    // 3. Inventory velocity (for future use)
    const velocity = await inventoryVelocity.getInventoryVelocity(cooperativeId);

    // Map stock risk to lowStock array (products below threshold)
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
        unit: 'units', // optional; can be fetched from Inventory if needed
      }));

    // Map stock risk to stockoutRisk (days ≤ 7)
    const stockoutRisk = stockRisk
      .filter(item => item.daysUntilStockout <= 7 && item.daysUntilStockout > 0)
      .map(item => ({
        _id: item.productId,
        product: item.productName,
        currentStock: item.currentStock,
        avgDailySales: item.avgDailySales,
        daysUntilStockout: item.daysUntilStockout,
        restockBy: new Date(Date.now() + item.daysUntilStockout * 86400000).toISOString().split('T')[0],
      }));

    // Map top revenue products
    const topRevenue = topRevenueProducts.map(prod => ({
      _id: prod.productId,
      product: prod.productName,
      category: prod.category,
      revenue: prod.totalCost,
      quantity: prod.totalQuantity,
      price: prod.avgCostPerUnit,
      unit: 'units',
    }));

    return {
      lowStock,
      stockoutRisk,
      topRevenue,
      velocity,
      summary: {
        totalProducts: products.length,
        lowStockCount: lowStock.length,
        stockoutRiskCount: stockoutRisk.length,
      },
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
  summary: { totalProducts: 0, lowStockCount: 0, stockoutRiskCount: 0 },
});

module.exports = { getInventory };