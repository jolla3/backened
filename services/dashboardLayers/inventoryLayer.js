const mongoose = require('mongoose');  // ✅ Added
const Inventory = require('../../models/inventory');
const Cooperative = require('../../models/cooperative');
const logger = require('../../utils/logger');
const feedAnalytics = require('../../analytics/feedAnalytics');
const inventoryVelocity = require('../../analytics/inventoryVelocity');

const getInventory = async (cooperativeId) => {
  try {
    const cooperative = await Cooperative.findById(cooperativeId);
    if (!cooperative) throw new Error('Cooperative not found');

    // Get all active products (all categories)
    const allProducts = await Inventory.find({ cooperativeId: cooperative._id, stock: { $gt: -1 } }).lean();

    // 1. Low stock: all products with stock <= threshold (any category)
    const lowStock = allProducts
      .filter(p => p.stock <= p.threshold)
      .map(p => ({
        _id: p._id,
        product: p.name,
        category: p.category,
        currentStock: p.stock,
        threshold: p.threshold,
        unit: p.unit,
      }));

    // 2. Stockout risk: only feed products with high velocity (≤7 days)
    const stockoutRisk = await feedAnalytics.getFeedStockRisk(cooperativeId);
    // stockoutRisk already contains feed products with daysUntilStockout <= 30, but we want only ≤7 days
    const filteredStockoutRisk = (stockoutRisk || [])
      .filter(item => item.daysUntilStockout <= 7 && item.daysUntilStockout > 0)
      .map(item => ({
        _id: item.productId,
        product: item.productName,
        currentStock: item.currentStock,
        avgDailySales: item.avgDailySales,
        daysUntilStockout: item.daysUntilStockout,
        restockBy: new Date(Date.now() + item.daysUntilStockout * 86400000).toISOString().split('T')[0],
      }));

    // 3. Top revenue products (last 30 days, feed only)
    const topRevenueProducts = await feedAnalytics.getTopFeedProducts(10, cooperativeId);
    const topRevenue = topRevenueProducts.map(prod => ({
      _id: prod.productId,
      product: prod.productName,
      category: prod.category,
      revenue: prod.totalCost,
      quantity: prod.totalQuantity,
      price: prod.avgCostPerUnit,
      unit: 'units',
    }));

    // 4. Inventory velocity (for future use)
    const velocity = await inventoryVelocity.getInventoryVelocity(cooperativeId);

    return {
      lowStock,
      stockoutRisk: filteredStockoutRisk,
      topRevenue,
      velocity,
      summary: {
        totalProducts: allProducts.length,
        lowStockCount: lowStock.length,
        stockoutRiskCount: filteredStockoutRisk.length,
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