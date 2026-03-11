const Transaction = require('../../models/transaction');
const Farmer = require('../../models/farmer');
const Cooperative = require('../../models/cooperative');
const logger = require('../../utils/logger');

const getFinancial = async (adminId) => {
  try {
    const cooperative = await Cooperative.findById(adminId);
    if (!cooperative) throw new Error('Cooperative not found');

    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    const [milkStats, feedStats, debtStats, todayStats] = await Promise.all([
      Transaction.aggregate([
        { $match: { type: 'milk', cooperativeId: cooperative._id, timestamp_server: { $gte: startOfMonth } } },
        { $group: { _id: null, totalPayout: { $sum: '$payout' }, totalLitres: { $sum: '$litres' } } }
      ]),
      Transaction.aggregate([
        { $match: { type: 'feed', cooperativeId: cooperative._id, timestamp_server: { $gte: startOfMonth } } },
        { $group: { _id: null, totalRevenue: { $sum: '$cost' }, totalQty: { $sum: '$quantity' } } }
      ]),
      Farmer.aggregate([
        { $match: { cooperativeId: cooperative._id, balance: { $lt: 0 } } },
        { $group: { _id: null, totalDebt: { $sum: '$balance' } } }
      ]),
      Transaction.aggregate([
        { $match: { type: 'milk', cooperativeId: cooperative._id, timestamp_server: { $gte: startOfToday } } },
        { $group: { _id: null, totalPayout: { $sum: '$payout' }, totalLitres: { $sum: '$litres' } } }
      ])
    ]);

    const milkPayout = milkStats[0]?.totalPayout || 0;
    const feedRevenue = feedStats[0]?.totalRevenue || 0;
    const totalDebt = debtStats[0]?.totalDebt || 0;
    const todayMilkPayout = todayStats[0]?.totalPayout || 0;
    const todayMilkLitres = todayStats[0]?.totalLitres || 0;

    const grossProfit = feedRevenue - milkPayout;
    const profitMargin = feedRevenue > 0 ? (grossProfit / feedRevenue) * 100 : 0;
    const hasRealData = feedRevenue > 0 && milkPayout > 0;

    return {
      milkRevenue: milkPayout,
      feedRevenue,
      farmerDebtTotal: Math.abs(totalDebt),
      expectedMilkPayout: milkPayout,
      netCashFlow: grossProfit,
      profitMargin: hasRealData ? parseFloat(profitMargin.toFixed(2)) : null,
      todayMilkPayout,
      todayMilkLitres,
      hasRealData
    };
  } catch (error) {
    logger.warn('Financial failed', { error: error.message });
    return getDefaultFinancial();
  }
};

const getDefaultFinancial = () => ({
  milkRevenue: 0,
  feedRevenue: 0,
  farmerDebtTotal: 0,
  expectedMilkPayout: 0,
  netCashFlow: 0,
  profitMargin: null,
  todayMilkPayout: 0,
  todayMilkLitres: 0,
  hasRealData: false
});

module.exports = { getFinancial };