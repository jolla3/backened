const Transaction = require('../models/transaction');
const Farmer = require('../models/farmer');
const Cooperative = require('../models/cooperative');
const logger = require('../utils/logger');

const getOperationalKPIs = async (cooperativeId) => {
  try {
    const cooperative = await Cooperative.findById(cooperativeId);
    if (!cooperative) throw new Error('Cooperative not found');

    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const yesterdayStart = new Date(todayStart);
    yesterdayStart.setDate(yesterdayStart.getDate() - 1);
    const lastWeekStart = new Date(todayStart);
    lastWeekStart.setDate(lastWeekStart.getDate() - 7);
    const lastMonthStart = new Date(todayStart);
    lastMonthStart.setMonth(lastMonthStart.getMonth() - 1);

    // Get today's milk data
    const todayMilk = await Transaction.aggregate([
      { $match: { type: 'milk', cooperativeId: cooperative._id, timestamp_server: { $gte: todayStart } } },
      { $group: { _id: null, totalLitres: { $sum: '$litres' }, farmers: { $addToSet: '$farmer_id' }, transactions: { $sum: 1 } } }
    ]);
    const todayLitres = todayMilk[0]?.totalLitres || 0;
    const todayFarmers = todayMilk[0]?.farmers?.length || 0;
    const todayTx = todayMilk[0]?.transactions || 0;

    // Yesterday
    const yesterdayMilk = await Transaction.aggregate([
      { $match: { type: 'milk', cooperativeId: cooperative._id, timestamp_server: { $gte: yesterdayStart, $lt: todayStart } } },
      { $group: { _id: null, totalLitres: { $sum: '$litres' }, farmers: { $addToSet: '$farmer_id' } } }
    ]);
    const yesterdayLitres = yesterdayMilk[0]?.totalLitres || 0;
    const yesterdayFarmers = yesterdayMilk[0]?.farmers?.length || 0;

    // Last 7 days
    const weekMilk = await Transaction.aggregate([
      { $match: { type: 'milk', cooperativeId: cooperative._id, timestamp_server: { $gte: lastWeekStart, $lt: todayStart } } },
      { $group: { _id: null, totalLitres: { $sum: '$litres' }, farmers: { $addToSet: '$farmer_id' }, avgPerDay: { $avg: '$litres' } } }
    ]);
    const weekLitres = weekMilk[0]?.totalLitres || 0;
    const weekAvgPerDay = weekMilk[0]?.avgPerDay || 0;
    const weekFarmers = weekMilk[0]?.farmers?.length || 0;

    // Last 30 days
    const monthMilk = await Transaction.aggregate([
      { $match: { type: 'milk', cooperativeId: cooperative._id, timestamp_server: { $gte: lastMonthStart, $lt: todayStart } } },
      { $group: { _id: null, totalLitres: { $sum: '$litres' }, farmers: { $addToSet: '$farmer_id' } } }
    ]);
    const monthLitres = monthMilk[0]?.totalLitres || 0;
    const monthFarmers = monthMilk[0]?.farmers?.length || 0;

    // Peak hour today
    const peakHour = await Transaction.aggregate([
      { $match: { type: 'milk', cooperativeId: cooperative._id, timestamp_server: { $gte: todayStart } } },
      { $group: { _id: { $hour: '$timestamp_server' }, count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 1 }
    ]);
    const peakHourStr = peakHour[0] ? `${peakHour[0]._id}:00-${(peakHour[0]._id + 1) % 24}:00` : null;

    // Growth percentages
    const growthVsYesterday = yesterdayLitres ? ((todayLitres - yesterdayLitres) / yesterdayLitres) * 100 : (todayLitres ? 100 : 0);
    const growthVsLastWeek = weekLitres ? ((todayLitres - (weekAvgPerDay * 7)) / (weekAvgPerDay * 7)) * 100 : 0;
    const growthVsLastMonth = monthLitres ? ((todayLitres - (monthLitres / 30)) / (monthLitres / 30)) * 100 : 0;

    // Farmer retention: farmers who delivered in last 30 days vs all active farmers
    const activeFarmersCount = await Farmer.countDocuments({ cooperativeId: cooperative._id, isActive: true });
    const retentionRate = activeFarmersCount ? (monthFarmers / activeFarmersCount) * 100 : 0;

    // Average litres per transaction
    const avgLitresPerTx = todayTx ? todayLitres / todayTx : 0;

    return {
      avgMilkPerFarmerToday: todayFarmers ? Math.round(todayLitres / todayFarmers) : 0,
      avgMilkPerFarmerWeek: weekFarmers ? Math.round(weekLitres / weekFarmers) : 0,
      avgMilkPerFarmerMonth: monthFarmers ? Math.round(monthLitres / monthFarmers) : 0,
      growthVsYesterday: growthVsYesterday.toFixed(1) + '%',
      growthVsLastWeek: growthVsLastWeek.toFixed(1) + '%',
      growthVsLastMonth: growthVsLastMonth.toFixed(1) + '%',
      peakCollectionHour: peakHourStr,
      totalLitresToday: Math.round(todayLitres),
      activeFarmersToday: todayFarmers,
      totalTransactionsToday: todayTx,
      avgLitresPerTransaction: avgLitresPerTx.toFixed(1),
      retentionRate: retentionRate.toFixed(1) + '%',
      weekTrend: {
        totalLitres: Math.round(weekLitres),
        avgPerDay: Math.round(weekAvgPerDay),
        activeFarmers: weekFarmers
      },
      monthTrend: {
        totalLitres: Math.round(monthLitres),
        activeFarmers: monthFarmers
      }
    };
  } catch (error) {
    logger.error('OperationalKPIs failed', { error: error.message, coopId });
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