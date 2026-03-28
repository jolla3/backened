const Transaction = require('../models/transaction');
const Inventory = require('../models/inventory');
const logger = require('../utils/logger');

/**
 * Get top feed products by revenue in the last 30 days.
 * @param {number} limit - number of products to return
 * @param {string} cooperativeId - ObjectId of the cooperative
 */
const getTopFeedProducts = async (limit = 5, cooperativeId) => {
  const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000);

  const topProducts = await Transaction.aggregate([
    {
      $match: {
        type: 'feed',
        cooperativeId: new mongoose.Types.ObjectId(cooperativeId),
        timestamp_server: { $gte: thirtyDaysAgo },
        product_id: { $exists: true, $ne: null },
      },
    },
    {
      $group: {
        _id: '$product_id',
        totalQuantity: { $sum: '$quantity' },
        totalCost: { $sum: '$cost' },
        transactionCount: { $sum: 1 },
      },
    },
    {
      $lookup: {
        from: 'inventories',
        localField: '_id',
        foreignField: '_id',
        as: 'product',
      },
    },
    { $unwind: '$product' },
    {
      $project: {
        productId: '$_id',
        productName: '$product.name',
        category: '$product.category',
        totalQuantity: 1,
        totalCost: 1,
        transactionCount: 1,
        avgCostPerUnit: { $round: [{ $divide: ['$totalCost', '$totalQuantity'] }, 2] },
      },
    },
    { $sort: { totalCost: -1 } },
    { $limit: limit },
  ]);

  return topProducts;
};

/**
 * Get feed stock risk analysis (feed only) for all feed products.
 * @param {string} cooperativeId - ObjectId of the cooperative
 */
const getFeedStockRisk = async (cooperativeId) => {
  const products = await Inventory.find({
    category: 'feed',
    cooperativeId: new mongoose.Types.ObjectId(cooperativeId),
  }).lean();

  const riskAnalysis = [];
  const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000);

  for (const product of products) {
    const sales = await Transaction.aggregate([
      {
        $match: {
          type: 'feed',
          cooperativeId: new mongoose.Types.ObjectId(cooperativeId),
          product_id: product._id,
          timestamp_server: { $gte: thirtyDaysAgo },
        },
      },
      { $group: { _id: null, totalQuantity: { $sum: '$quantity' } } },
    ]);

    const totalQuantity = sales[0]?.totalQuantity || 0;
    const avgDailySales = totalQuantity / 30;
    const daysUntilStockout = avgDailySales > 0 ? Math.floor(product.stock / avgDailySales) : Infinity;

    let riskLevel = 'low';
    if (daysUntilStockout <= 7) riskLevel = 'critical';
    else if (daysUntilStockout <= 14) riskLevel = 'high';
    else if (daysUntilStockout <= 30) riskLevel = 'medium';

    riskAnalysis.push({
      productId: product._id,
      productName: product.name,
      currentStock: product.stock,
      threshold: product.threshold,
      avgDailySales: parseFloat(avgDailySales.toFixed(2)),
      daysUntilStockout: daysUntilStockout === Infinity ? 999 : daysUntilStockout,
      riskLevel,
    });
  }

  return riskAnalysis.sort((a, b) => a.daysUntilStockout - b.daysUntilStockout);
};

/**
 * Get feed sales trends (daily/weekly/monthly)
 * @param {string} period - 'daily', 'weekly', or 'monthly'
 * @param {string} cooperativeId - ObjectId of the cooperative
 */
const getFeedSalesTrends = async (period = 'daily', cooperativeId) => {
  const now = new Date();
  let startDate;

  if (period === 'daily') {
    startDate = new Date(now.setHours(0, 0, 0, 0));
  } else if (period === 'weekly') {
    startDate = new Date(now.setDate(now.getDate() - 7));
  } else if (period === 'monthly') {
    startDate = new Date(now.setMonth(now.getMonth() - 1));
  } else {
    throw new Error('Invalid period. Use daily, weekly, or monthly.');
  }

  const trends = await Transaction.aggregate([
    {
      $match: {
        type: 'feed',
        cooperativeId: new mongoose.Types.ObjectId(cooperativeId),
        timestamp_server: { $gte: startDate },
      },
    },
    {
      $group: {
        _id: { $dateToString: { format: '%Y-%m-%d', date: '$timestamp_server' } },
        totalQuantity: { $sum: '$quantity' },
        totalCost: { $sum: '$cost' },
        transactionCount: { $sum: 1 },
      },
    },
    { $sort: { _id: 1 } },
  ]);

  return trends;
};

module.exports = {
  getTopFeedProducts,
  getFeedStockRisk,
  getFeedSalesTrends,
};