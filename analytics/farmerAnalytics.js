// analytics/lowPerformingFarmers.js
const mongoose = require('mongoose');
const Farmer = require('../models/farmer');
const Transaction = require('../models/transaction');
const Cooperative = require('../models/cooperative');
const logger = require('../utils/logger');

const getLowPerformingFarmers = async (cooperativeId, period = 'weekly') => {
  try {
    const cooperative = await Cooperative.findById(cooperativeId);
    if (!cooperative) throw new Error('Cooperative not found');

    const now = new Date();
    const currentStart = new Date(now);
    if (period === 'daily') {
      currentStart.setHours(0, 0, 0, 0);
    } else if (period === 'weekly') {
      currentStart.setDate(currentStart.getDate() - 7);
    } else {
      throw new Error('Invalid period. Use "daily" or "weekly".');
    }

    // Current period litres per farmer
    const currentPeriod = await Transaction.aggregate([
      { $match: { type: 'milk', cooperativeId, timestamp_server: { $gte: currentStart } } },
      { $group: { _id: '$farmer_id', currentLitres: { $sum: '$litres' }, currentTx: { $sum: 1 } } }
    ]);

    // Rolling average over last 30 days (excluding current period)
    const thirtyDaysAgo = new Date(currentStart);
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const rollingAvg = await Transaction.aggregate([
      { $match: { type: 'milk', cooperativeId, timestamp_server: { $gte: thirtyDaysAgo, $lt: currentStart } } },
      { $group: { _id: '$farmer_id', avgLitres: { $avg: '$litres' }, daysActive: { $addToSet: { $dateToString: { format: '%Y-%m-%d', date: '$timestamp_server' } } } } }
    ]);

    const avgMap = new Map();
    for (const r of rollingAvg) {
      avgMap.set(r._id.toString(), { avg: r.avgLitres || 0, days: r.daysActive?.length || 0 });
    }

    const lowPerformers = [];
    for (const current of currentPeriod) {
      const id = current._id.toString();
      const avg = avgMap.get(id);
      if (!avg || avg.days < 5) continue;
      const expected = avg.avg * (period === 'daily' ? 1 : 7);
      const dropPercent = expected > 0 ? ((expected - current.currentLitres) / expected) * 100 : 0;
      if (dropPercent > 20) {
        const farmer = await Farmer.findById(id);
        if (farmer) {
          lowPerformers.push({
            farmerId: id,
            farmerName: farmer.name,
            farmerPhone: farmer.phone,
            currentPeriodLitres: current.currentLitres,
            expectedLitres: Math.round(expected),
            dropPercent: parseFloat(dropPercent.toFixed(2)),
            rollingAvg: Math.round(avg.avg)
          });
        }
      }
    }

    return lowPerformers.sort((a, b) => b.dropPercent - a.dropPercent);
  } catch (error) {
    logger.error('LowPerformingFarmers failed', { error: error.message, cooperativeId });
    return [];
  }
};

module.exports = { getLowPerformingFarmers };