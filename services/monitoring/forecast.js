// services/monitoring/forecast.js
const mongoose = require('mongoose');
const Transaction = require('../../models/transaction');
const RateVersion = require('../../models/rateVersion');

const getForecast = async (cooperativeId) => {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const last30Days = new Date(today);
  last30Days.setDate(last30Days.getDate() - 30);
  const last7Days = new Date(today);
  last7Days.setDate(last7Days.getDate() - 7);

  // Get daily totals for last 30 days
  const dailyTotals = await Transaction.aggregate([
    {
      $match: {
        cooperativeId: new mongoose.Types.ObjectId(cooperativeId),
        type: 'milk',
        timestamp_server: { $gte: last30Days, $lt: today },
      },
    },
    {
      $group: {
        _id: { $dateToString: { format: '%Y-%m-%d', date: '$timestamp_server' } },
        litres: { $sum: '$litres' },
      },
    },
    { $sort: { _id: 1 } },
  ]);

  const values = dailyTotals.map(d => d.litres);
  if (values.length < 7) {
    return {
      tomorrowMilk: null,
      nextWeekMilk: null,
      confidence: 'low',
      reason: 'Insufficient data (need at least 7 days)',
      historical: values,
    };
  }

  const avgLast7 = values.slice(-7).reduce((s, v) => s + v, 0) / 7;
  const avgLast30 = values.reduce((s, v) => s + v, 0) / values.length;

  const tomorrowPrediction = avgLast7 * 0.7 + avgLast30 * 0.3;
  const nextWeekPrediction = tomorrowPrediction * 7;

  const variance = values.reduce((s, v) => s + Math.pow(v - avgLast30, 2), 0) / values.length;
  const stddev = Math.sqrt(variance);
  const cv = avgLast30 > 0 ? (stddev / avgLast30) * 100 : 100;

  let confidence = 'medium';
  if (cv < 20) confidence = 'high';
  else if (cv > 50) confidence = 'low';

  // Get latest milk rate
  const rateDoc = await RateVersion.findOne({
    cooperativeId,
    type: 'milk',
    effective_date: { $lte: now },
  }).sort({ effective_date: -1 }).lean();
  const rate = rateDoc?.rate || 0;

  const expectedPayout = Math.round(tomorrowPrediction * rate);
  const expectedFeedDemand = Math.round(tomorrowPrediction / 100);

  // Weekend effect
  const todayDay = now.getDay();
  const isWeekend = todayDay === 0 || todayDay === 6;

  return {
    tomorrowMilk: Math.round(tomorrowPrediction),
    nextWeekMilk: Math.round(nextWeekPrediction),
    expectedPayout,
    expectedFeedDemand,
    confidence,
    isWeekend,
    basedOnDays: values.length,
    trend: tomorrowPrediction > avgLast30 ? 'up' : 'down',
    historical: dailyTotals.slice(-7),
  };
};

module.exports = { getForecast };