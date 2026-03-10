const Transaction = require('../models/transaction');
const Farmer = require('../models/farmer');
const Porter = require('../models/porter');
const Inventory = require('../models/inventory');
const Device = require('../models/device');
const logger = require('../utils/logger');

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

const getSystemHealth = async () => {
  const totalTransactions = await Transaction.countDocuments();
  const pendingTransactions = await Transaction.countDocuments({ status: 'pending' });
  const failedTransactions = await Transaction.countDocuments({ status: 'failed' });
  const totalFarmers = await Farmer.countDocuments();
  const totalPorters = await Porter.countDocuments();
  const totalDevices = await Device.countDocuments();
  
  // ✅ FIXED: Use $count in aggregation instead of countDocuments()
  const lowStockProducts = await Inventory.aggregate([
    { $match: { $expr: { $lte: ['$stock', '$threshold'] } } },
    { $count: 'count' }
  ]);

  const healthScore = 100;
  let issues = [];

  if (pendingTransactions > 10) { healthScore -= 10; issues.push('High pending transactions'); }
  if (failedTransactions > 5) { healthScore -= 15; issues.push('High failed transactions'); }
  if (lowStockProducts[0]?.count > 3) { healthScore -= 10; issues.push('Low stock alerts'); }

  return {
    healthScore,
    status: healthScore >= 80 ? 'healthy' : healthScore >= 60 ? 'warning' : 'critical',
    totalTransactions,
    pendingTransactions,
    failedTransactions,
    totalFarmers,
    totalPorters,
    totalDevices,
    lowStockProducts: lowStockProducts[0]?.count || 0,
    issues
  };
};

module.exports = { getTodayMetrics, getSystemHealth };