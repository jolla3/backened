const Transaction = require('../../models/transaction');
const Farmer = require('../../models/farmer');
const Porter = require('../../models/porter');
const Inventory = require('../../models/inventory');
const Device = require('../../models/device');
const RateVersion = require('../../models/rateVersion');
const Cooperative = require('../../models/cooperative');
const logger = require('../../utils/logger');
const { getKenyaDateString, isValidDateString } = require('../../utils/dateUtils');

/**
 * Get system overview dashboard data.
 * Uses collectionDate for business date (when milk/feed was actually collected/purchased).
 * Uses timestamp_server for system audit events (device online, failures).
 */
const getSystemOverview = async (cooperativeId) => {
  try {
    const cooperative = await Cooperative.findById(cooperativeId);
    if (!cooperative) throw new Error('Cooperative not found');

    // ── Business date (Kenya time) ──────────────────────────
    const todayStr = getKenyaDateString();
    const yesterdayStr = getKenyaDateString(new Date(Date.now() - 86400000));
    const lastWeekDate = new Date();
    lastWeekDate.setDate(lastWeekDate.getDate() - 7);
    const lastWeekStr = getKenyaDateString(lastWeekDate);

    // ── Totals ────────────────────────────────────────────────
    const [totalFarmers, totalPorters, totalProducts, totalRates, totalDevices] = await Promise.all([
      Farmer.countDocuments({ cooperativeId: cooperative._id }),
      Porter.countDocuments({ cooperativeId: cooperative._id }),
      Inventory.countDocuments({ cooperativeId: cooperative._id }),
      RateVersion.countDocuments({ cooperativeId: cooperative._id }),
      Device.countDocuments({ cooperativeId: cooperative._id, revoked: false })
    ]);

    // ── Low stock alerts ──────────────────────────────────────
    const lowStockAlerts = await Inventory.countDocuments({
      cooperativeId: cooperative._id,
      $expr: { $lte: ['$stock', '$threshold'] }
    });

    // ── Today's metrics (business date) ──────────────────────
    const todayMetrics = await getTodayMetrics(cooperative._id, todayStr);

    // ── Yesterday's metrics for comparison ──────────────────
    const yesterdayMetrics = await getTodayMetrics(cooperative._id, yesterdayStr);

    // ── Device online status (system time) ──────────────────
    const devicesOnline = await Device.countDocuments({
      cooperativeId: cooperative._id,
      last_seen: { $gte: new Date(Date.now() - 24 * 3600000) }
    });

    // ── Failed transactions today (system time) ─────────────
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const failedTransactionsToday = await Transaction.countDocuments({
      cooperativeId: cooperative._id,
      timestamp_server: { $gte: startOfDay },
      status: 'failed'
    });

    const successRate = todayMetrics.transactionsToday > 0
      ? ((todayMetrics.transactionsToday - failedTransactionsToday) / todayMetrics.transactionsToday) * 100
      : 100;

    // ── Milk quality (rejection rate for today's business date) ──
    const rejectedMilk = await Transaction.aggregate([
      {
        $match: {
          type: 'milk',
          cooperativeId: cooperative._id,
          collectionDate: todayStr,
          status: 'rejected'
        }
      },
      { $group: { _id: null, totalLitres: { $sum: '$litres' } } }
    ]);
    const rejectedLitres = rejectedMilk[0]?.totalLitres || 0;
    const milkQuality = todayMetrics.milkToday.litres > 0
      ? (rejectedLitres / todayMetrics.milkToday.litres) * 100
      : 0;

    // ── Health score ──────────────────────────────────────────
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

    // ── System issues ────────────────────────────────────────
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
        pendingTransactions: 0,
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

/**
 * Get metrics for a specific business date (YYYY-MM-DD).
 * Uses collectionDate for milk and feed transactions.
 */
const getTodayMetrics = async (cooperativeId, dateStr) => {
  if (!isValidDateString(dateStr)) {
    throw new Error(`Invalid date string: ${dateStr}`);
  }

  const [
    transactionsToday,
    milkToday,
    feedToday,
    farmersToday,
    portersToday,
    devicesToday
  ] = await Promise.all([
    // Total transactions on this business date (milk + feed)
    Transaction.countDocuments({
      cooperativeId,
      collectionDate: dateStr
    }),
    // Milk aggregation
    Transaction.aggregate([
      {
        $match: {
          type: 'milk',
          cooperativeId,
          collectionDate: dateStr
        }
      },
      {
        $group: {
          _id: null,
          totalLitres: { $sum: { $ifNull: ['$litres', 0] } },
          totalPayout: { $sum: { $ifNull: ['$payout', 0] } }
        }
      }
    ]),
    // Feed aggregation
    Transaction.aggregate([
      {
        $match: {
          type: 'feed',
          cooperativeId,
          collectionDate: dateStr
        }
      },
      {
        $group: {
          _id: null,
          totalQuantity: { $sum: { $ifNull: ['$quantity', 0] } },
          totalCost: { $sum: { $ifNull: ['$cost', 0] } }
        }
      }
    ]),
    // New farmers registered on that business date (using createdAt for registration)
    Farmer.countDocuments({
      cooperativeId,
      createdAt: {
        $gte: new Date(`${dateStr}T00:00:00+03:00`),
        $lt: new Date(`${dateStr}T23:59:59+03:00`)
      }
    }),
    // New porters registered on that business date
    Porter.countDocuments({
      cooperativeId,
      createdAt: {
        $gte: new Date(`${dateStr}T00:00:00+03:00`),
        $lt: new Date(`${dateStr}T23:59:59+03:00`)
      }
    }),
    // Devices active on that business date (using last_seen)
    Device.countDocuments({
      cooperativeId,
      last_seen: {
        $gte: new Date(`${dateStr}T00:00:00+03:00`),
        $lt: new Date(`${dateStr}T23:59:59+03:00`)
      }
    })
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

// ─── Health score calculation ────────────────────────────────
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

  if (totalTransactions === 0) score -= 30;
  else if (totalTransactions < 10) score -= 10;
  else if (totalTransactions < 50) score -= 5;

  if (successRate < 80) score -= 20;
  else if (successRate < 95) score -= 10;

  if (lowStock > 5) score -= 15;
  else if (lowStock > 0) score -= Math.min(15, lowStock * 2);

  if (totalDevices === 0) score -= 15;
  else if (devicesOnline === 0) score -= 10;
  else if (devicesOnline / totalDevices < 0.5) score -= 5;

  if (totalFarmers === 0) score -= 10;
  else if (totalFarmers < 5) score -= 5;

  if (milkQuality > 10) score -= 10;
  else if (milkQuality > 5) score -= 5;

  if (yesterdayTransactions > 0 && totalTransactions < yesterdayTransactions * 0.5) {
    score -= 10;
  }

  return Math.max(0, Math.min(100, score));
};

// ─── System issues ────────────────────────────────────────────
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

// ─── Default fallback ─────────────────────────────────────────
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