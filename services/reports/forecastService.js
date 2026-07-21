const mongoose = require('mongoose');
const Transaction = require('../../models/transaction');

const buildForecast = async (year, month, cooperativeId) => {
  const startDate = new Date(year, month - 1, 1);
  const sixMonthsAgo = new Date(startDate);
  sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

  const historical = await Transaction.aggregate([
    {
      $match: {
        cooperativeId: new mongoose.Types.ObjectId(cooperativeId),
        type: 'milk',
        timestamp_server: { $gte: sixMonthsAgo, $lt: startDate }
      }
    },
    {
      $group: {
        _id: { year: { $year: '$timestamp_server' }, month: { $month: '$timestamp_server' } },
        totalLitres: { $sum: '$litres' },
        totalPayout: { $sum: '$payout' }
      }
    },
    { $sort: { '_id.year': 1, '_id.month': 1 } }
  ]);

  if (historical.length < 3) {
    return {
      available: false,
      reason: `Need at least 3 months of history. Found ${historical.length} month(s).`,
      basedOnMonths: historical.length
    };
  }

  const last3 = historical.slice(-3);
  const avgLitres = last3.reduce((s, h) => s + h.totalLitres, 0) / last3.length;
  const avgPayout = last3.reduce((s, h) => s + h.totalPayout, 0) / last3.length;
  const variance = last3.reduce((s, h) => s + Math.pow(h.totalLitres - avgLitres, 2), 0) / last3.length;
  const confidence = Math.max(0, Math.min(100, 100 - (variance / avgLitres) * 10));

  return {
    available: true,
    nextMonthMilk: Math.round(avgLitres),
    nextMonthPayout: Math.round(avgPayout),
    confidence: parseFloat(Math.min(confidence, 100).toFixed(0)),
    basedOnMonths: last3.length
  };
};

module.exports = { buildForecast };