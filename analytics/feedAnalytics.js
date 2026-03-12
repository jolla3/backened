const Transaction = require('../models/transaction');
const Inventory = require('../models/inventory');
const logger = require('../utils/logger');

// ✅ FIXED: Added adminId, filtered by cooperative
const getTopFeedProducts = async (limit = 5, adminId) => {
  const cooperative = await require('../models/cooperative').findById(adminId);
  if (!cooperative) throw new Error('Cooperative not found');

  const topProducts = await Transaction.aggregate([
    { $match: { type: 'feed', cooperativeId: cooperative._id } },
    { $group: {
      _id: '$product_id',
      totalQuantity: { $sum: '$quantity' },
      totalCost: { $sum: '$cost' },
      transactionCount: { $sum: 1 }
    }},
    { $lookup: {
      from: 'inventories',
      localField: '_id',
      foreignField: '_id',
      as: 'product'
    }},
    { $unwind: '$product' },
    { $project: {
      productId: '$_id',
      productName: '$product.name',
      category: '$product.category',
      totalQuantity: 1,
      totalCost: 1,
      transactionCount: 1,
      avgCostPerUnit: { $round: [{ $divide: ['$totalCost', '$totalQuantity'] }, 2] }
    }},
    { $sort: { totalQuantity: -1 } },
    { $limit: limit }
  ]);

  return topProducts;
};

// ✅ FIXED: Added adminId, filtered by cooperative
const getFeedStockRisk = async (adminId) => {
  const cooperative = await require('../models/cooperative').findById(adminId);
  if (!cooperative) throw new Error('Cooperative not found');

  const products = await Inventory.find({ 
    category: 'feed', 
    cooperativeId: cooperative._id 
  });
  
  const riskAnalysis = [];
  
  for (const product of products) {
    const last30Days = await Transaction.aggregate([
      { $match: {
        type: 'feed',
        cooperativeId: cooperative._id,
        product_id: product._id,
        timestamp_server: {
          $gte: new Date(new Date().setDate(new Date().getDate() - 30))
        }
      }},
      { $group: {
        _id: null,
        totalQuantity: { $sum: '$quantity' }
      }}
    ]);

    const avgDailySales = last30Days[0]?.totalQuantity / 30 || 0;
    const daysUntilStockout = avgDailySales > 0 ? Math.floor(product.stock / avgDailySales) : 999;
    
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
      daysUntilStockout,
      riskLevel
    });
  }

  return riskAnalysis.sort((a, b) => a.daysUntilStockout - b.daysUntilStockout);
};

// ✅ FIXED: Added adminId, filtered by cooperative
const getFeedSalesTrends = async (period = 'daily', adminId) => {
  const cooperative = await require('../models/cooperative').findById(adminId);
  if (!cooperative) throw new Error('Cooperative not found');

  const now = new Date();
  let startDate;
  
  if (period === 'daily') startDate = new Date(now.setHours(0, 0, 0));
  else if (period === 'weekly') startDate = new Date(now.setDate(now.getDate() - 7));
  else if (period === 'monthly') startDate = new Date(now.setMonth(now.getMonth() - 1));

  const trends = await Transaction.aggregate([
    { $match: { type: 'feed', cooperativeId: cooperative._id, timestamp_server: { $gte: startDate } } },
    { $group: {
      _id: { $dateToString: { format: '%Y-%m-%d', date: '$timestamp_server' } },
      totalQuantity: { $sum: '$quantity' },
      totalCost: { $sum: '$cost' },
      transactionCount: { $sum: 1 }
    }},
    { $sort: { _id: 1 } }
  ]);

  return trends;
};

module.exports = {
  getTopFeedProducts,
  getFeedStockRisk,
  getFeedSalesTrends
};