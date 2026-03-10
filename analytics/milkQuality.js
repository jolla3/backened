const Transaction = require('../models/transaction');

const getMilkQuality = async () => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const rejected = await Transaction.aggregate([
    { $match: { type: 'milk', timestamp_server: { $gte: today }, status: 'rejected' } },
    { $group: { _id: null, count: { $sum: 1 } } }
  ]);

  const total = await Transaction.aggregate([
    { $match: { type: 'milk', timestamp_server: { $gte: today } } },
    { $group: { _id: null, count: { $sum: 1 } } }
  ]);

  const rejectedCount = rejected[0]?.count || 0;
  const totalCount = total[0]?.count || 1;
  const rejectedPercentage = ((rejectedCount / totalCount) * 100).toFixed(2);

  return {
    rejectedToday: rejectedCount,
    rejectedPercentage: rejectedPercentage + '%',
    problemZones: [] // Add zone analysis if you track quality by zone
  };
};

module.exports = { getMilkQuality };