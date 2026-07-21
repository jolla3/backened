// analytics/operationalKPIs.js
const mongoose = require('mongoose');
const Transaction = require('../models/transaction');
const Farmer = require('../models/farmer');
const Cooperative = require('../models/cooperative');
const logger = require('../utils/logger');

const getOperationalKPIs = async (cooperativeId) => {
  try {
    const coopId = new mongoose.Types.ObjectId(cooperativeId);
    const cooperative = await Cooperative.findById(coopId);
    if (!cooperative) throw new Error('Cooperative not found');

    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const yesterdayStart = new Date(todayStart);
    yesterdayStart.setDate(yesterdayStart.getDate() - 1);
    const lastWeekStart = new Date(todayStart);
    lastWeekStart.setDate(lastWeekStart.getDate() - 7);
    const lastMonthStart = new Date(todayStart);
    lastMonthStart.setMonth(lastMonthStart.getMonth() - 1);

    // Today's milk
    const todayMilk = await Transaction.aggregate([
      { $match: { type: 'milk', cooperativeId: coopId, timestamp_server: { $gte: todayStart } } },
      { $group: { _id: null, totalLitres: { $sum: '$litres' }, farmers: { $addToSet: '$farmer_id' }, transactions: { $sum: 1 } } }
    ]);
    const todayLitres = todayMilk[0]?.totalLitres || 0;
    const todayFarmers = todayMilk[0]?.farmers?.length || 0;
    const todayTx = todayMilk[0]?.transactions || 0;
    const avgLitresPerTransaction = todayTx > 0 ? todayLitres / todayTx : 0;

    // Yesterday
    const yesterdayMilk = await Transaction.aggregate([
      { $match: { type: 'milk', cooperativeId: coopId, timestamp_server: { $gte: yesterdayStart, $lt: todayStart } } },
      { $group: { _id: null, totalLitres: { $sum: '$litres' } } }
    ]);
    const yesterdayLitres = yesterdayMilk[0]?.totalLitres || 0;

    // Last 7 days (excluding today)
    const weekMilk = await Transaction.aggregate([
      { $match: { type: 'milk', cooperativeId: coopId, timestamp_server: { $gte: lastWeekStart, $lt: todayStart } } },
      { $group: { _id: null, totalLitres: { $sum: '$litres' }, countDays: { $addToSet: { $dateToString: { format: '%Y-%m-%d', date: '$timestamp_server' } } } } }
    ]);
    const weekLitres = weekMilk[0]?.totalLitres || 0;
    const weekDays = weekMilk[0]?.countDays?.length || 1;
    const avgWeekDay = weekLitres / weekDays;

    // Week farmers – for avgMilkPerFarmerWeek
    const weekFarmersAgg = await Transaction.aggregate([
      { $match: { type: 'milk', cooperativeId: coopId, timestamp_server: { $gte: lastWeekStart, $lt: todayStart } } },
      { $group: { _id: null, farmers: { $addToSet: '$farmer_id' } } }
    ]);
    const weekFarmers = weekFarmersAgg[0]?.farmers?.length || 0;
    const avgMilkPerFarmerWeek = weekFarmers > 0 ? Math.round(weekLitres / weekFarmers) : 0;

    // Last 30 days (excluding today)
    const monthMilk = await Transaction.aggregate([
      { $match: { type: 'milk', cooperativeId: coopId, timestamp_server: { $gte: lastMonthStart, $lt: todayStart } } },
      { $group: { _id: null, totalLitres: { $sum: '$litres' }, countDays: { $addToSet: { $dateToString: { format: '%Y-%m-%d', date: '$timestamp_server' } } } } }
    ]);
    const monthLitres = monthMilk[0]?.totalLitres || 0;
    const monthDays = monthMilk[0]?.countDays?.length || 1;
    const avgMonthDay = monthLitres / monthDays;

    // Month farmers – for avgMilkPerFarmerMonth
    const monthFarmersAgg = await Transaction.aggregate([
      { $match: { type: 'milk', cooperativeId: coopId, timestamp_server: { $gte: lastMonthStart, $lt: todayStart } } },
      { $group: { _id: null, farmers: { $addToSet: '$farmer_id' } } }
    ]);
    const monthFarmers = monthFarmersAgg[0]?.farmers?.length || 0;
    const avgMilkPerFarmerMonth = monthFarmers > 0 ? Math.round(monthLitres / monthFarmers) : 0;

    // Growth calculations
    const growthVsYesterday = yesterdayLitres > 0 ? ((todayLitres - yesterdayLitres) / yesterdayLitres) * 100 : (todayLitres > 0 ? 100 : 0);
    const growthVsLastWeek = avgWeekDay > 0 ? ((todayLitres - avgWeekDay) / avgWeekDay) * 100 : (todayLitres > 0 ? 100 : 0);
    const growthVsLastMonth = avgMonthDay > 0 ? ((todayLitres - avgMonthDay) / avgMonthDay) * 100 : (todayLitres > 0 ? 100 : 0);

    // Retention
    const activeFarmersCount = await Farmer.countDocuments({ cooperativeId: coopId, isActive: true });
    const monthFarmerCount = await Transaction.distinct('farmer_id', {
      type: 'milk',
      cooperativeId: coopId,
      timestamp_server: { $gte: lastMonthStart, $lt: todayStart }
    });
    const retentionRate = activeFarmersCount > 0 ? (monthFarmerCount.length / activeFarmersCount) * 100 : 0;

    // Peak hour
    const peakHour = await Transaction.aggregate([
      { $match: { type: 'milk', cooperativeId: coopId, timestamp_server: { $gte: todayStart } } },
      { $group: { _id: { $hour: '$timestamp_server' }, count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 1 }
    ]);
    const peakHourStr = peakHour[0] ? `${peakHour[0]._id}:00-${(peakHour[0]._id + 1) % 24}:00` : null;

    const weekTrend = { totalLitres: Math.round(weekLitres), avgPerDay: Math.round(avgWeekDay), activeFarmers: 0 };
    const monthTrend = { totalLitres: Math.round(monthLitres), activeFarmers: monthFarmerCount.length };

    return {
      avgMilkPerFarmerToday: todayFarmers > 0 ? Math.round(todayLitres / todayFarmers) : 0,
      avgMilkPerFarmerWeek: avgMilkPerFarmerWeek,
      avgMilkPerFarmerMonth: avgMilkPerFarmerMonth,
      growthVsYesterday: growthVsYesterday.toFixed(1) + '%',
      growthVsLastWeek: growthVsLastWeek.toFixed(1) + '%',
      growthVsLastMonth: growthVsLastMonth.toFixed(1) + '%',
      peakCollectionHour: peakHourStr,
      totalLitresToday: Math.round(todayLitres),
      activeFarmersToday: todayFarmers,
      totalTransactionsToday: todayTx,
      avgLitresPerTransaction: avgLitresPerTransaction.toFixed(1),
      retentionRate: retentionRate.toFixed(1) + '%',
      weekTrend,
      monthTrend
    };
  } catch (error) {
    logger.error('OperationalKPIs failed', { error: error.message, cooperativeId });
    return getDefaultKPIs();
  }
};

const getDefaultKPIs = () => ({
  avgMilkPerFarmerToday: 0,
  avgMilkPerFarmerWeek: 0,
  avgMilkPerFarmerMonth: 0,
  growthVsYesterday: '0%',
  growthVsLastWeek: '0%',
  growthVsLastMonth: '0%',
  peakCollectionHour: null,
  totalLitresToday: 0,
  activeFarmersToday: 0,
  totalTransactionsToday: 0,
  avgLitresPerTransaction: '0',
  retentionRate: '0%',
  weekTrend: { totalLitres: 0, avgPerDay: 0, activeFarmers: 0 },
  monthTrend: { totalLitres: 0, activeFarmers: 0 }
});

module.exports = { getOperationalKPIs };