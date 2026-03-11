const Transaction = require('../../models/transaction');
const Farmer = require('../../models/farmer');
const Porter = require('../../models/porter');
const Inventory = require('../../models/inventory');
const Device = require('../../models/device');
const RateVersion = require('../../models/rateVersion');
const Cooperative = require('../../models/cooperative');
const logger = require('../../utils/logger');

const getSystemOverview = async (adminId) => {
  try {
    const cooperative = await Cooperative.findById(adminId);
    if (!cooperative) throw new Error('Cooperative not found');

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
      Device.countDocuments({ cooperativeId: cooperative._id }),
      Inventory.aggregate([
        { $match: { cooperativeId: cooperative._id, $expr: { $lte: ['$stock', '$threshold'] } } },
        { $count: 'count' }
      ]),
      getTodayMetrics(adminId)
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
    logger.warn('System overview failed, returning defaults', { error: error.message });
    return getDefaultSystemOverview();
  }
};

const getTodayMetrics = async (adminId) => {
  const cooperative = await Cooperative.findById(adminId);
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
      { $group: { _id: null, totalLitres: { $sum: '$litres' }, totalPayout: { $sum: '$payout' } } }
    ]),
    Transaction.aggregate([
      { $match: { type: 'feed', cooperativeId: cooperative._id, timestamp_server: { $gte: today } } },
      { $group: { _id: null, totalQuantity: { $sum: '$quantity' }, totalCost: { $sum: '$cost' } } }
    ]),
    Farmer.countDocuments({ cooperativeId: cooperative._id, createdAt: { $gte: today } }),
    Porter.countDocuments({ cooperativeId: cooperative._id, createdAt: { $gte: today } }),
    Device.countDocuments({ cooperativeId: cooperative._id, last_seen: { $gte: today } })
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