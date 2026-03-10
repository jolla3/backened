const Transaction = require('../../models/transaction');
const Farmer = require('../../models/farmer');
const Porter = require('../../models/porter');
const Inventory = require('../../models/inventory');
const Device = require('../../models/device');
const RateVersion = require('../../models/rateVersion');
const logger = require('../../utils/logger');

const getSystemOverview = async () => {
  try {
    const [
      totalFarmers,
      totalPorters,
      totalProducts,
      totalRates,
      totalDevices,
      lowStockAlerts,
      todayMetrics
    ] = await Promise.all([
      Farmer.countDocuments(),
      Porter.countDocuments(),
      Inventory.countDocuments(),
      RateVersion.countDocuments(),
      Device.countDocuments(),
      Inventory.aggregate([
        { $match: { $expr: { $lte: ['$stock', '$threshold'] } } },
        { $count: 'count' }
      ]),
      getTodayMetrics()
    ]);

    return {
      systemHealth: {
        healthScore: 100,
        status: 'healthy',
        totalTransactions: todayMetrics.transactionsToday,
        pendingTransactions: 0,
        failedTransactions: 0,
        totalFarmers,
        totalPorters,
        totalDevices,
        lowStockProducts: lowStockAlerts[0]?.count || 0,
        issues: []
      },
      todayMetrics: {
        transactionsToday: todayMetrics.transactionsToday,
        milkToday: { litres: todayMetrics.milkToday.litres, payout: todayMetrics.milkToday.payout },
        feedToday: { quantity: todayMetrics.feedToday.quantity, cost: todayMetrics.feedToday.cost },
        farmersToday: todayMetrics.farmersToday,
        portersToday: todayMetrics.portersToday,
        devicesToday: todayMetrics.devicesToday
      },
      totals: { // ✅ FIXED: Renamed from systemOverview to totals
        totalFarmers,
        totalPorters,
        totalProducts,
        totalRates,
        totalDevices,
        lowStockAlerts: lowStockAlerts[0]?.count || 0
      }
    };
  } catch (error) {
    logger.warn('System overview failed, returning defaults', { error: error.message });
    return getDefaultSystemOverview();
  }
};

const getTodayMetrics = async () => {
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
    Transaction.countDocuments({ timestamp_server: { $gte: today } }),
    Transaction.aggregate([
      { $match: { type: 'milk', timestamp_server: { $gte: today } } },
      { $group: { _id: null, totalLitres: { $sum: '$litres' }, totalPayout: { $sum: '$payout' } } }
    ]),
    Transaction.aggregate([
      { $match: { type: 'feed', timestamp_server: { $gte: today } } },
      { $group: { _id: null, totalQuantity: { $sum: '$quantity' }, totalCost: { $sum: '$cost' } } }
    ]),
    Farmer.countDocuments({ createdAt: { $gte: today } }),
    Porter.countDocuments({ createdAt: { $gte: today } }),
    Device.countDocuments({ last_seen: { $gte: today } })
  ]);

  return {
    transactionsToday,
    milkToday: { litres: milkToday[0]?.totalLitres || 0, payout: milkToday[0]?.totalPayout || 0 },
    feedToday: { quantity: feedToday[0]?.totalQuantity || 0, cost: feedToday[0]?.totalCost || 0 },
    farmersToday,
    portersToday,
    devicesToday
  };
};

const getDefaultSystemOverview = () => ({
  systemHealth: { healthScore: 0, status: 'unknown', totalTransactions: 0, issues: [] },
  todayMetrics: { transactionsToday: 0, milkToday: { litres: 0, payout: 0 }, feedToday: { quantity: 0, cost: 0 } },
  totals: { totalFarmers: 0, totalPorters: 0, totalProducts: 0, totalRates: 0, totalDevices: 0, lowStockAlerts: 0 }
});

module.exports = { getSystemOverview };