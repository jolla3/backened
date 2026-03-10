const Transaction = require('../../models/transaction');
const Farmer = require('../../models/farmer');
const Porter = require('../../models/porter');
const Device = require('../../models/device');
const logger = require('../../utils/logger');

const getSummary = async () => {
  try {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    const lastWeek = new Date(today);
    lastWeek.setDate(lastWeek.getDate() - 7);
    const lastMonth = new Date(today);
    lastMonth.setMonth(lastMonth.getMonth() - 1);

    // ✅ FIXED: Most important metric - Daily Milk Trend
    const [todayMilk, yesterdayMilk, weekMilk, monthMilk] = await Promise.all([
      Transaction.aggregate([
        { $match: { type: 'milk', timestamp_server: { $gte: today } } },
        { $group: { _id: null, totalLitres: { $sum: '$litres' } } }
      ]),
      Transaction.aggregate([
        { $match: { type: 'milk', timestamp_server: { $gte: yesterday, $lt: today } } },
        { $group: { _id: null, totalLitres: { $sum: '$litres' } } }
      ]),
      Transaction.aggregate([
        { $match: { type: 'milk', timestamp_server: { $gte: lastWeek, $lt: today } } },
        { $group: { _id: null, totalLitres: { $sum: '$litres' } } }
      ]),
      Transaction.aggregate([
        { $match: { type: 'milk', timestamp_server: { $gte: lastMonth, $lt: today } } },
        { $group: { _id: null, totalLitres: { $sum: '$litres' } } }
      ])
    ]);

    const todayLitres = todayMilk[0]?.totalLitres || 0;
    const yesterdayLitres = yesterdayMilk[0]?.totalLitres || 0;
    const weekLitres = weekMilk[0]?.totalLitres || 0;
    const monthLitres = monthMilk[0]?.totalLitres || 0;

    const milkChange = yesterdayLitres > 0 ? ((todayLitres - yesterdayLitres) / yesterdayLitres) * 100 : 0;

    // ✅ FIXED: Single source of truth - no duplicates
    const [totalFarmers, totalPorters, totalDevices, farmersToday, transactionsToday] = await Promise.all([
      Farmer.countDocuments(),
      Porter.countDocuments(),
      Device.countDocuments(),
      Farmer.countDocuments({ createdAt: { $gte: today } }),
      Transaction.countDocuments({ timestamp_server: { $gte: today } })
    ]);

    return {
      // ✅ FIXED: Most important metric first
      milkToday: todayLitres,
      milkYesterday: yesterdayLitres,
      milkThisWeek: weekLitres,
      milkThisMonth: monthLitres,
      milkChange: milkChange,
      
      // ✅ FIXED: Single source of truth
      farmersToday,
      transactionsToday,
      totalFarmers,
      totalPorters,
      totalDevices
    };
  } catch (error) {
    logger.warn('Summary failed', { error: error.message });
    return getDefaultSummary();
  }
};

const getDefaultSummary = () => ({
  milkToday: 0,
  milkYesterday: 0,
  milkThisWeek: 0,
  milkThisMonth: 0,
  milkChange: 0,
  farmersToday: 0,
  transactionsToday: 0,
  totalFarmers: 0,
  totalPorters: 0,
  totalDevices: 0
});

module.exports = { getSummary };