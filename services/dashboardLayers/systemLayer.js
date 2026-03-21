const Transaction = require('../../models/transaction');
const Farmer = require('../../models/farmer');
const Porter = require('../../models/porter');
const Inventory = require('../../models/inventory');
const Device = require('../../models/device');
const RateVersion = require('../../models/rateVersion');
const Cooperative = require('../../models/cooperative');
const logger = require('../../utils/logger');

const getSystemOverview = async (cooperativeId) => {  // ✅ FIXED
  try {
    const cooperative = await Cooperative.findById(cooperativeId);
    if (!cooperative) throw new Error('Cooperative not found');

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const [
      totalFarmers,
      totalPorters,
      totalProducts,
      totalRates,
      totalDevices,
      lowStockAlerts,
      todayMetrics
    ] = await Promise.all([
      Farmer.countDocuments({ cooperativeId: cooperative._id }),
      Porter.countDocuments({ cooperativeId: cooperative._id }),
      Inventory.countDocuments({ cooperativeId: cooperative._id }),
      RateVersion.countDocuments({ cooperativeId: cooperative._id }),
      Device.countDocuments({ cooperativeId: cooperative._id, revoked: false }),
      Inventory.aggregate([
        { $match: { cooperativeId: cooperative._id, $expr: { $lte: ['$stock', '$threshold'] } } },
        { $count: 'count' }
      ]),
      getTodayMetrics(cooperativeId)
    ]);

    const healthScore = calculateHealthScore({
      totalTransactions: todayMetrics.transactionsToday,
      lowStock: lowStockAlerts[0]?.count || 0,
      totalDevices,
      totalFarmers
    });

    return {
      systemHealth: {
        healthScore,
        status: healthScore >= 80 ? 'healthy' : healthScore >= 50 ? 'warning' : 'critical',
        totalTransactions: todayMetrics.transactionsToday,
        pendingTransactions: 0,  // Would need status field
        failedTransactions: 0,   // Would need error field
        totalFarmers,
        totalPorters,
        totalDevices,
        lowStockProducts: lowStockAlerts[0]?.count || 0,
        issues: getSystemIssues(lowStockAlerts[0]?.count || 0, totalDevices)
      },
      todayMetrics,
      totals: {
        totalFarmers,
        totalPorters,
        totalProducts,
        totalRates,
        totalDevices,
        lowStockAlerts: lowStockAlerts[0]?.count || 0
      }
    };
  } catch (error) {
    logger.error('System overview failed', { error: error.message, coopId });
    return getDefaultSystemOverview();
  }
};

const getTodayMetrics = async (cooperativeId) => {
  const cooperative = await Cooperative.findById(cooperativeId);
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const [
    transactionsToday,
    milkToday,
    feedToday,
    farmersToday,
    portersToday,
    devicesToday
  ] = await Promise.all([
    Transaction.countDocuments({ cooperativeId: cooperative._id, timestamp_server: { $gte: today } }),
    Transaction.aggregate([
      { $match: { type: 'milk', cooperativeId: cooperative._id, timestamp_server: { $gte: today } } },
      { $group: { _id: null, totalLitres: { $sum: { $ifNull: ['$litres', 0] } }, totalPayout: { $sum: { $ifNull: ['$payout', 0] } } } }
    ]),
    Transaction.aggregate([
      { $match: { type: 'feed', cooperativeId: cooperative._id, timestamp_server: { $gte: today } } },
      { $group: { _id: null, totalQuantity: { $sum: { $ifNull: ['$quantity', 0] } }, totalCost: { $sum: { $ifNull: ['$cost', 0] } } } }
    ]),
    Farmer.countDocuments({ cooperativeId: cooperative._id, createdAt: { $gte: today } }),
    Porter.countDocuments({ cooperativeId: cooperative._id, createdAt: { $gte: today } }),
    Device.countDocuments({ cooperativeId: cooperative._id, last_seen: { $gte: today } })
  ]);

  return {
    transactionsToday,
    milkToday: { 
      litres: milkToday[0]?.totalLitres || 0, 
      payout: milkToday[0]?.totalPayout || 0 
    },
    feedToday: { 
      quantity: feedToday[0]?.totalQuantity || 0, 
      cost: feedToday[0]?.totalCost || 0 
    },
    farmersToday,
    portersToday,
    devicesToday
  };
};

const calculateHealthScore = ({ totalTransactions, lowStock, totalDevices, totalFarmers }) => {
  let score = 100;
  
  if (lowStock > 3) score -= 25;
  if (totalTransactions === 0) score -= 20;
  if (totalDevices === 0) score -= 15;
  if (totalFarmers === 0) score -= 30;
  
  return Math.max(0, score);
};

const getSystemIssues = (lowStock, totalDevices) => {
  const issues = [];
  if (lowStock > 0) issues.push(`${lowStock} low stock items`);
  if (totalDevices === 0) issues.push('No devices registered');
  return issues;
};

const getDefaultSystemOverview = () => ({
  systemHealth: { 
    healthScore: 0, 
    status: 'unknown', 
    totalTransactions: 0, 
    pendingTransactions: 0, 
    failedTransactions: 0, 
    totalFarmers: 0, 
    totalPorters: 0, 
    totalDevices: 0, 
    lowStockProducts: 0,
    issues: []
  },
  todayMetrics: { 
    transactionsToday: 0, 
    milkToday: { litres: 0, payout: 0 }, 
    feedToday: { quantity: 0, cost: 0 },
    farmersToday: 0,
    portersToday: 0,
    devicesToday: 0
  },
  totals: { 
    totalFarmers: 0, 
    totalPorters: 0, 
    totalProducts: 0, 
    totalRates: 0, 
    totalDevices: 0, 
    lowStockAlerts: 0 
  }
});

module.exports = { getSystemOverview };