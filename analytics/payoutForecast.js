const Transaction = require('../models/transaction');
const Farmer = require('../models/farmer');
const Cooperative = require('../models/cooperative');
const logger = require('../utils/logger');

const getPayoutForecast = async (cooperativeId) => {
  try {
    const cooperative = await Cooperative.findById(cooperativeId);
    if (!cooperative) throw new Error('Cooperative not found');

    const now = new Date();
    const threeMonthsAgo = new Date(now);
    threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);
    const sixMonthsAgo = new Date(now);
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

    // Get farmers with positive balance
    const eligibleFarmers = await Farmer.find({ cooperativeId: cooperative._id, balance: { $gt: 0 } }).lean();
    const totalPayout = eligibleFarmers.reduce((sum, f) => sum + f.balance, 0);
    const farmersToPay = eligibleFarmers.length;

    // Estimate next payout date (15th of next month)
    const nextPayout = new Date(now);
    nextPayout.setDate(15);
    if (nextPayout <= now) nextPayout.setMonth(nextPayout.getMonth() + 1);

    // Historical milk volumes to forecast
    const milkVolumes = await Transaction.aggregate([
      { $match: { type: 'milk', cooperativeId: cooperative._id, timestamp_server: { $gte: sixMonthsAgo } } },
      {
        $group: {
          _id: { year: { $year: '$timestamp_server' }, month: { $month: '$timestamp_server' } },
          totalLitres: { $sum: '$litres' }
        }
      },
      { $sort: { '_id.year': 1, '_id.month': 1 } }
    ]);

    // Simple linear forecast for next month
    let forecastLitres = 0;
    if (milkVolumes.length >= 2) {
      const recentMonths = milkVolumes.slice(-3);
      const avgLitres = recentMonths.reduce((sum, m) => sum + m.totalLitres, 0) / recentMonths.length;
      forecastLitres = avgLitres;
    } else if (milkVolumes.length === 1) {
      forecastLitres = milkVolumes[0].totalLitres;
    } else {
      forecastLitres = 0;
    }

    // Assume KES 45 per litre
    const assumedRate = 45;
    const forecastPayout = forecastLitres * assumedRate;

    // Add seasonal adjustment (optional)
    const month = now.getMonth() + 1;
    const seasonalFactor = [1.0, 1.0, 1.1, 1.2, 1.3, 1.2, 1.1, 1.0, 1.0, 1.1, 1.2, 1.3][month-1] || 1.0;
    const adjustedForecast = forecastPayout * seasonalFactor;

    return {
      nextPayoutDate: nextPayout.toISOString().split('T')[0],
      estimatedAmount: Math.round(totalPayout),
      forecastNextPayout: Math.round(adjustedForecast),
      farmersToPay,
      eligibleFarmers: eligibleFarmers.slice(0, 10).map(f => ({
        name: f.name,
        code: f.farmer_code,
        balance: Math.round(f.balance)
      })),
      payoutRateAssumed: `KES ${assumedRate} per litre`,
      historicalMonthlyLitres: milkVolumes.map(m => ({
        month: `${m._id.year}-${String(m._id.month).padStart(2,'0')}`,
        litres: Math.round(m.totalLitres)
      }))
    };
  } catch (error) {
    logger.error('PayoutForecast failed', { error: error.message, coopId });
    return getDefaultPayoutForecast();
  }
};

const getDefaultPayoutForecast = () => ({
  nextPayoutDate: null,
  estimatedAmount: 0,
  forecastNextPayout: 0,
  farmersToPay: 0,
  eligibleFarmers: [],
  payoutRateAssumed: 'KES 45 per litre',
  historicalMonthlyLitres: []
});

module.exports = { getPayoutForecast };