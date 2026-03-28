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

    // Sales data for last 30 days
    const salesData = await Transaction.aggregate([
      { $match: { type: 'feed', cooperativeId: cooperative._id, product_id: { $in: productIds }, timestamp_server: { $gte: thirtyDaysAgo } } },
      { $group: { _id: '$product_id', totalQty: { $sum: '$quantity' }, totalRevenue: { $sum: '$cost' } } }
    ]);
    const salesMap = new Map(salesData.map(s => [s._id.toString(), { qty: s.totalQty, revenue: s.totalRevenue }]));

    const lowStock = [];
    const stockoutRisk = [];
    const topRevenue = [];

    for (const product of products) {
      const sales = salesMap.get(product._id.toString()) || { qty: 0, revenue: 0 };
      const avgDailySales = sales.qty / 30;
      const daysUntilStockout = avgDailySales > 0 ? Math.floor(product.stock / avgDailySales) : Infinity;
      const thresholdRatio = product.threshold ? product.stock / product.threshold : 1;

      // Low stock
      if (product.stock <= product.threshold) {
        lowStock.push({
          _id: product._id,
          product: product.name,
          category: product.category,
          currentStock: product.stock,
          threshold: product.threshold,
          thresholdRatio: thresholdRatio.toFixed(2),
          avgDailySales: avgDailySales.toFixed(1),
          daysUntilStockout: daysUntilStockout === Infinity ? 'N/A' : daysUntilStockout,
          price: product.price,
          unit: product.unit
        });
      }

      // Stockout risk (≤7 days)
      if (daysUntilStockout !== Infinity && daysUntilStockout <= 7) {
        stockoutRisk.push({
          _id: product._id,
          product: product.name,
          category: product.category,
          currentStock: product.stock,
          avgDailySales: Math.round(avgDailySales),
          daysUntilStockout,
          restockBy: new Date(Date.now() + daysUntilStockout * 86400000).toISOString().split('T')[0]
        });
      }

      // Top revenue
      if (sales.revenue > 0) {
        topRevenue.push({
          _id: product._id,
          product: product.name,
          category: product.category,
          revenue: sales.revenue,
          quantity: sales.qty,
          price: product.price,
          unit: product.unit
        });
      }
    }

    // Sort lowStock by urgency (lowest threshold ratio first)
    lowStock.sort((a, b) => parseFloat(a.thresholdRatio) - parseFloat(b.thresholdRatio));
    // Sort stockoutRisk by days left (most urgent first)
    stockoutRisk.sort((a, b) => a.daysUntilStockout - b.daysUntilStockout);
    // Sort topRevenue descending
    topRevenue.sort((a, b) => b.revenue - a.revenue);

    return {
      lowStock,
      stockoutRisk,
      topRevenue: topRevenue.slice(0, 10),   // top 10 revenue items
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
  summary: { totalProducts: 0, lowStockCount: 0, stockoutRiskCount: 0 }
});

module.exports = { getInventory };