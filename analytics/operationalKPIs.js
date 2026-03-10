const Transaction = require('../models/transaction');
const Farmer = require('../models/farmer');

const getOperationalKPIs = async () => {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const lastWeek = new Date(today);
  lastWeek.setDate(lastWeek.getDate() - 7);

  const todayMilk = await Transaction.aggregate([
    { $match: { type: 'milk', timestamp_server: { $gte: today } } },
    { $group: { _id: null, totalLitres: { $sum: '$litres' }, farmerCount: { $addToSet: '$farmer_id' } } }
  ]);

  const yesterdayMilk = await Transaction.aggregate([
    { $match: { type: 'milk', timestamp_server: { $gte: yesterday, $lt: today } } },
    { $group: { _id: null, totalLitres: { $sum: '$litres' } } }
  ]);

  const lastWeekMilk = await Transaction.aggregate([
    { $match: { type: 'milk', timestamp_server: { $gte: lastWeek, $lt: today } } },
    { $group: { _id: null, totalLitres: { $sum: '$litres' } } }
  ]);

  const activeFarmers = await Farmer.countDocuments();

  const peakHour = await Transaction.aggregate([
    { $match: { type: 'milk', timestamp_server: { $gte: today } } },
    { $group: { _id: { $hour: '$timestamp_server' }, count: { $sum: 1 } } },
    { $sort: { count: -1 } },
    { $limit: 1 }
  ]);

  const todayLitres = todayMilk[0]?.totalLitres || 0;
  const yesterdayLitres = yesterdayMilk[0]?.totalLitres || 0;
  const lastWeekLitres = lastWeekMilk[0]?.totalLitres || 0;
  const activeFarmerCount = todayMilk[0]?.farmerCount?.length || 0;

  const growthVsYesterday = yesterdayLitres > 0 ? ((todayLitres - yesterdayLitres) / yesterdayLitres) * 100 : 0;
  const growthVsLastWeek = lastWeekLitres > 0 ? ((todayLitres - lastWeekLitres) / lastWeekLitres) * 100 : 0;

  return {
    avgMilkPerFarmer: activeFarmerCount > 0 ? (todayLitres / activeFarmerCount) : 0,
    growthVsYesterday: growthVsYesterday, // ✅ FIXED: Return number, not string
    growthVsLastWeek: growthVsLastWeek, // ✅ FIXED: Return number, not string
    peakCollectionHour: peakHour[0] ? `${peakHour[0]._id}:00 - ${peakHour[0]._id + 1}:00` : null,
    totalLitresToday: todayLitres,
    activeFarmersToday: activeFarmerCount
  };
};

module.exports = { getOperationalKPIs };