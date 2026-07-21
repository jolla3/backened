// services/monitoring/sessions.js
const mongoose = require('mongoose');
const Transaction = require('../../models/transaction');
const { buildMatch } = require('./helpers');

const getSessionComparison = async (cooperativeId, range, zoneFilter = null) => {
  const match = buildMatch(cooperativeId, range, zoneFilter);

  const pipeline = [
    { $match: match },
    {
      $group: {
        _id: {
          session: { $cond: [{ $lt: [{ $hour: '$timestamp_server' }, 12] }, 'morning', 'afternoon'] },
          date: { $dateToString: { format: '%Y-%m-%d', date: '$timestamp_server' } },
        },
        litres: { $sum: '$litres' },
        farmers: { $addToSet: '$farmer_id' },
        transactions: { $sum: 1 },
        avgLitres: { $avg: '$litres' },
        startTime: { $min: '$timestamp_server' },
        endTime: { $max: '$timestamp_server' },
      },
    },
    { $sort: { '_id.date': 1, '_id.session': 1 } },
  ];

  const raw = await Transaction.aggregate(pipeline);

  const dailyMap = {};
  raw.forEach(item => {
    const date = item._id.date;
    if (!dailyMap[date]) dailyMap[date] = { date, morning: null, afternoon: null };
    const sessionData = {
      litres: item.litres,
      farmerCount: item.farmers.length,
      transactionCount: item.transactions,
      avgLitres: Math.round(item.avgLitres || 0),
      startTime: item.startTime,
      endTime: item.endTime,
    };
    if (item._id.session === 'morning') dailyMap[date].morning = sessionData;
    else dailyMap[date].afternoon = sessionData;
  });

  const result = Object.values(dailyMap).map(day => {
    const morningLitres = day.morning?.litres || 0;
    const afternoonLitres = day.afternoon?.litres || 0;
    const total = morningLitres + afternoonLitres;
    const diff = morningLitres - afternoonLitres;
    const changePercent = total > 0 ? (diff / total) * 100 : 0;
    return {
      ...day,
      total,
      difference: diff,
      changePercent: Math.round(changePercent * 10) / 10,
      dominantSession: morningLitres >= afternoonLitres ? 'morning' : 'afternoon',
    };
  });

  const totalMorning = raw.filter(r => r._id.session === 'morning').reduce((s, r) => s + r.litres, 0);
  const totalAfternoon = raw.filter(r => r._id.session === 'afternoon').reduce((s, r) => s + r.litres, 0);
  const morningCount = raw.filter(r => r._id.session === 'morning').length || 1;
  const afternoonCount = raw.filter(r => r._id.session === 'afternoon').length || 1;

  return {
    daily: result,
    summary: {
      totalMorning,
      totalAfternoon,
      averageMorning: Math.round(totalMorning / morningCount),
      averageAfternoon: Math.round(totalAfternoon / afternoonCount),
      difference: totalMorning - totalAfternoon,
      changePercent: (totalMorning + totalAfternoon) > 0 ? Math.round(((totalMorning - totalAfternoon) / (totalMorning + totalAfternoon)) * 100) : 0,
    },
  };
};

module.exports = { getSessionComparison };