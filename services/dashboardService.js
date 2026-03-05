const Farmer = require('../models/farmer');
const Porter = require('../models/porter');
const Inventory = require('../models/inventory');
const Transaction = require('../models/transaction');
const RateVersion = require('../models/rateVersion');

const getTotals = async () => {
  const [
    farmers,
    porters,
    products,
    milkStats,
    feedStats,
    lowStock,
    balances
  ] = await Promise.all([
    Farmer.countDocuments(),
    Porter.countDocuments(),
    Inventory.countDocuments(),
    Transaction.aggregate([
      { $match: { type: 'milk' } },
      { $group: { _id: null, totalLitres: { $sum: '$litres' }, totalPayout: { $sum: '$payout' } } }
    ]),
    Transaction.aggregate([
      { $match: { type: 'feed' } },
      { $group: { _id: null, totalQuantity: { $sum: '$quantity' }, totalCost: { $sum: '$cost' } } }
    ]),
    Inventory.find({ stock: { $lte: '$threshold' } }).countDocuments(),
    Farmer.aggregate([
      { $group: { _id: null, totalBalance: { $sum: '$balance' } } }
    ])
  ]);

  return {
    totalFarmers: farmers,
    totalPorters: porters,
    totalProducts: products,
    totalMilkCollected: milkStats[0]?.totalLitres || 0,
    totalPayouts: milkStats[0]?.totalPayout || 0,
    totalFeedSales: feedStats[0]?.totalQuantity || 0,
    totalFeedCost: feedStats[0]?.totalCost || 0,
    lowStockAlerts: lowStock,
    totalBalances: balances[0]?.totalBalance || 0
  };
};

const getOverview = async (period = 'daily') => {
  const now = new Date();
  const startDate = period === 'daily' ? new Date(now.setHours(0, 0, 0, 0)) : new Date(now.setMonth(0, 1));

  const transactions = await Transaction.aggregate([
    { $match: { timestamp_server: { $gte: startDate } } },
    { $group: {
      _id: { $dateToString: { format: '%Y-%m-%d', date: '$timestamp_server' } },
      totalLitres: { $sum: '$litres' },
      totalPayout: { $sum: '$payout' }
    }},
    { $sort: { _id: 1 } }
  ]);

  return { period, data: transactions };
};

module.exports = { getTotals, getOverview };