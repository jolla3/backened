const Transaction = require('../../models/transaction');
const Farmer = require('../../models/farmer');
const Porter = require('../../models/porter');
const Inventory = require('../../models/inventory');
const Device = require('../../models/device');
const RateVersion = require('../../models/rateVersion');
const Cooperative = require('../../models/cooperative');
const logger = require('../../utils/logger');

const getSystemOverview = async (cooperativeId) => {
  try {
    const cooperative = await Cooperative.findById(cooperativeId);
    if (!cooperative) throw new Error('Cooperative not found');

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    const lastWeek = new Date(today);
    lastWeek.setDate(lastWeek.getDate() - 7);

    // Get totals
    const [totalFarmers, totalPorters, totalProducts, totalRates, totalDevices] = await Promise.all([
      Farmer.countDocuments({ cooperativeId: cooperative._id }),
      Porter.countDocuments({ cooperativeId: cooperative._id }),
      Inventory.countDocuments({ cooperativeId: cooperative._id }),
      RateVersion.countDocuments({ cooperativeId: cooperative._id }),
      Device.countDocuments({ cooperativeId: cooperative._id, revoked: false })
    ]);

    // Low stock alerts
    const lowStockAlerts = await Inventory.countDocuments({
      cooperativeId: cooperative._id,
      $expr: { $lte: ['$stock', '$threshold'] }
    });

    // Today's metrics
    const todayMetrics = await getTodayMetrics(cooperative, today);
    
    // Yesterday's metrics for comparison
    const yesterdayMetrics = await getTodayMetrics(cooperative, yesterday);
    
    // Device online status (seen in last 24h)
    const devicesOnline = await Device.countDocuments({
      cooperativeId: cooperative._id,
      last_seen: { $gte: new Date(Date.now() - 24 * 3600000) }
    });
    
    // Transaction success rate (based on status field, if exists; otherwise assume all completed)
    // We'll check if there's a status field with 'failed'. If not, we assume all succeeded.
    const failedTransactionsToday = await Transaction.countDocuments({
      cooperativeId: cooperative._id,
      timestamp_server: { $gte: today },
      status: 'failed'
    });
    const successRate = todayMetrics.transactionsToday > 0
      ? ((todayMetrics.transactionsToday - failedTransactionsToday) / todayMetrics.transactionsToday) * 100
      : 100;

    // Milk quality: assumed from any 'rejected' flag; if not present, we can skip or use zero.
    // For now, we'll query if there's a 'quality' field or assume all accepted.
    // Could also use a separate rejection collection.
    const rejectedMilk = await Transaction.aggregate([
      { $match: { type: 'milk', cooperativeId: cooperative._id, timestamp_server: { $gte: today }, status: 'rejected' } },
      { $group: { _id: null, totalLitres: { $sum: '$litres' } } }
    ]);
    const rejectedLitres = rejectedMilk[0]?.totalLitres || 0;
    const milkQuality = todayMetrics.milkToday.litres > 0
      ? (rejectedLitres / todayMetrics.milkToday.litres) * 100
      : 0;

    // Health score calculation
    const healthScore = calculateHealthScore({
      totalTransactions: todayMetrics.transactionsToday,
      lowStock: lowStockAlerts,
      totalDevices,
      totalFarmers,
      successRate,
      devicesOnline,
      milkQuality,
      yesterdayTransactions: yesterdayMetrics.transactionsToday
    });

    // System issues
    const issues = getSystemIssues({
      lowStock: lowStockAlerts,
      totalDevices,
      devicesOnline,
      successRate,
      milkQuality,
      todayTransactions: todayMetrics.transactionsToday,
      yesterdayTransactions: yesterdayMetrics.transactionsToday
    });

    return {
      systemHealth: {
        healthScore,
        status: healthScore >= 80 ? 'healthy' : healthScore >= 60 ? 'warning' : 'critical',
        totalTransactions: todayMetrics.transactionsToday,
        pendingTransactions: 0, // would need status field
        failedTransactions: failedTransactionsToday,
        totalFarmers,
        totalPorters,
        totalDevices,
        lowStockProducts: lowStockAlerts,
        issues
      },
      todayMetrics,
      totals: {
        totalFarmers,
        totalPorters,
        totalProducts,
        totalRates,
        totalDevices,
        lowStockAlerts
      }
    };
  } catch (error) {
    logger.error('System overview failed', { error: error.message, coopId });
    return getDefaultSystemOverview();
  }
};

const getTodayMetrics = async (cooperative, date) => {
  const start = new Date(date);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);

  const [
    transactionsToday,
    milkToday,
    feedToday,
    farmersToday,
    portersToday,
    devicesToday
  ] = await Promise.all([
    Transaction.countDocuments({
      cooperativeId: cooperative._id,
      timestamp_server: { $gte: start, $lt: end }
    }),
    Transaction.aggregate([
      { $match: { type: 'milk', cooperativeId: cooperative._id, timestamp_server: { $gte: start, $lt: end } } },
      { $group: { _id: null, totalLitres: { $sum: { $ifNull: ['$litres', 0] } }, totalPayout: { $sum: { $ifNull: ['$payout', 0] } } } }
    ]),
    Transaction.aggregate([
      { $match: { type: 'feed', cooperativeId: cooperative._id, timestamp_server: { $gte: start, $lt: end } } },
      { $group: { _id: null, totalQuantity: { $sum: { $ifNull: ['$quantity', 0] } }, totalCost: { $sum: { $ifNull: ['$cost', 0] } } } }
    ]),
    Farmer.countDocuments({ cooperativeId: cooperative._id, createdAt: { $gte: start, $lt: end } }),
    Porter.countDocuments({ cooperativeId: cooperative._id, createdAt: { $gte: start, $lt: end } }),
    Device.countDocuments({ cooperativeId: cooperative._id, last_seen: { $gte: start, $lt: end } })
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

const calculateHealthScore = ({
  totalTransactions,
  lowStock,
  totalDevices,
  totalFarmers,
  successRate,
  devicesOnline,
  milkQuality,
  yesterdayTransactions
}) => {
  let score = 100;

  // Activity weight: 30% (if zero transactions today, heavy penalty)
  if (totalTransactions === 0) score -= 30;
  else if (totalTransactions < 10) score -= 10;
  else if (totalTransactions < 50) score -= 5;

  // Transaction success rate: 20%
  if (successRate < 80) score -= 20;
  else if (successRate < 95) score -= 10;

  // Low stock: 15%
  if (lowStock > 5) score -= 15;
  else if (lowStock > 0) score -= Math.min(15, lowStock * 2);

  // Device coverage: 15% (if no devices, heavy penalty)
  if (totalDevices === 0) score -= 15;
  else if (devicesOnline === 0) score -= 10;
  else if (devicesOnline / totalDevices < 0.5) score -= 5;

  // Farmer base: 10% (if no farmers, heavy penalty)
  if (totalFarmers === 0) score -= 10;
  else if (totalFarmers < 5) score -= 5;

  // Milk quality: 10% (if rejection rate > 5%, penalty)
  if (milkQuality > 10) score -= 10;
  else if (milkQuality > 5) score -= 5;

  // Trend: if today's transactions are significantly lower than yesterday, penalty
  if (yesterdayTransactions > 0 && totalTransactions < yesterdayTransactions * 0.5) {
    score -= 10;
  }

  return Math.max(0, Math.min(100, score));
};

const getSystemIssues = ({
  lowStock,
  totalDevices,
  devicesOnline,
  successRate,
  milkQuality,
  todayTransactions,
  yesterdayTransactions
}) => {
  const issues = [];

  if (lowStock > 0) {
    issues.push(`${lowStock} product(s) below threshold`);
  }

  if (totalDevices === 0) {
    issues.push('No devices registered');
  } else if (devicesOnline === 0) {
    issues.push('No devices online in the last 24 hours');
  } else if (devicesOnline < totalDevices * 0.5) {
    issues.push(`${Math.round((devicesOnline/totalDevices)*100)}% of devices are online`);
  }

  if (successRate < 95) {
    issues.push(`Transaction success rate is ${successRate.toFixed(1)}%`);
  }

  if (milkQuality > 5) {
    issues.push(`Milk rejection rate is ${milkQuality.toFixed(1)}%`);
  }

  if (todayTransactions === 0 && yesterdayTransactions > 0) {
    issues.push('No transactions today compared to yesterday');
  }

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