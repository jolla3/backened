const Transaction = require('../models/transaction');
const Farmer = require('../models/farmer');
const Cooperative = require('../models/cooperative');
const logger = require('../utils/logger');

const getOperationalKPIs = async (cooperativeId) => {
  try {
    const cooperative = await Cooperative.findById(cooperativeId);
    if (!cooperative) throw new Error('Cooperative not found');

    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    const lastWeek = new Date(today);
    lastWeek.setDate(lastWeek.getDate() - 7);

    const [todayMilk, yesterdayMilk, lastWeekMilk, peakHour] = await Promise.all([
      Transaction.aggregate([
        { $match: { type: 'milk', cooperativeId: cooperative._id, timestamp_server: { $gte: today } } },
        { $group: { _id: null, totalLitres: { $sum: { $ifNull: ['$litres', 0] } }, farmerCount: { $addToSet: '$farmer_id' } } }
      ]),
      Transaction.aggregate([
        { $match: { type: 'milk', cooperativeId: cooperative._id, timestamp_server: { $gte: yesterday, $lt: today } } },
        { $group: { _id: null, totalLitres: { $sum: { $ifNull: ['$litres', 0] } } } }
      ]),
      Transaction.aggregate([
        { $match: { type: 'milk', cooperativeId: cooperative._id, timestamp_server: { $gte: lastWeek, $lt: today } } },
        { $group: { _id: null, totalLitres: { $sum: { $ifNull: ['$litres', 0] } } } }
      ]),
      Transaction.aggregate([
        { $match: { type: 'milk', cooperativeId: cooperative._id, timestamp_server: { $gte: today } } },
        { $group: { _id: { $hour: '$timestamp_server' }, count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 1 }
      ])
    ]);

    const todayLitres = todayMilk[0]?.totalLitres || 0;
    const yesterdayLitres = yesterdayMilk[0]?.totalLitres || 0;
    const lastWeekLitres = lastWeekMilk[0]?.totalLitres || 0;
    const activeFarmerCount = todayMilk[0]?.farmerCount?.length || 0;

    const growthVsYesterday = yesterdayLitres > 0 
      ? Math.round(((todayLitres - yesterdayLitres) / yesterdayLitres) * 100 * 10) / 10 
      : todayLitres > 0 ? 100 : 0;
    
    const growthVsLastWeek = lastWeekLitres > 0 
      ? Math.round(((todayLitres - lastWeekLitres) / lastWeekLitres) * 100 * 10) / 10 
      : todayLitres > 0 ? 100 : 0;

    return {
      avgMilkPerFarmer: activeFarmerCount > 0 ? Math.round(todayLitres / activeFarmerCount) : 0,
      growthVsYesterday: `${growthVsYesterday}%`,
      growthVsLastWeek: `${growthVsLastWeek}%`,
      peakCollectionHour: peakHour[0] ? `${peakHour[0]._id}:00-${(peakHour[0]._id + 1) % 24}:00` : null,
      totalLitresToday: Math.round(todayLitres),
      activeFarmersToday: activeFarmerCount
    };
  } catch (error) {
    logger.error('OperationalKPIs failed', { error: error.message, coopId });
    return getDefaultKPIs();
  }
};

const getDefaultKPIs = () => ({ 
  avgMilkPerFarmer: 0, 
  growthVsYesterday: '0%', 
  growthVsLastWeek: '0%', 
  peakCollectionHour: null,
  totalLitresToday: 0, 
  activeFarmersToday: 0 
});

module.exports = { getOperationalKPIs };