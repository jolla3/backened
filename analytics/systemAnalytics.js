const Transaction = require('../models/transaction');
const Farmer = require('../models/farmer');
const Porter = require('../models/porter');
const Inventory = require('../models/inventory');
const Device = require('../models/device');
const logger = require('../utils/logger');

const getTodayMetrics = async (adminId) => {
  const cooperative = await require('../models/cooperative').findById(adminId);
  if (!cooperative) throw new Error('Cooperative not found');

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

const getSystemHealth = async (adminId) => {
  const cooperative = await require('../models/cooperative').findById(adminId);
  if (!cooperative) throw new Error('Cooperative not found');

  const totalTransactions = await Transaction.countDocuments({ cooperativeId: cooperative._id });
  const pendingTransactions = await Transaction.countDocuments({ cooperativeId: cooperative._id, status: 'pending' });
  const failedTransactions = await Transaction.countDocuments({ cooperativeId: cooperative._id, status: 'failed' });
  const totalFarmers = await Farmer.countDocuments({ cooperativeId: cooperative._id });
  const totalPorters = await Porter.countDocuments({ cooperativeId: cooperative._id });
  const totalDevices = await Device.countDocuments({ cooperativeId: cooperative._id });
  
  const lowStockProducts = await Inventory.aggregate([
    { $match: { cooperativeId: cooperative._id, $expr: { $lte: ['$stock', '$threshold'] } } },
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