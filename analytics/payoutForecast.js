const Transaction = require('../models/transaction');
const Farmer = require('../models/farmer');
const Cooperative = require('../models/cooperative');
const logger = require('../utils/logger');

const getPayoutForecast = async (cooperativeId) => {
  try {
    const cooperative = await Cooperative.findById(cooperativeId);
    if (!cooperative) throw new Error('Cooperative not found');

    // Farmers eligible for payout (positive balance)
    const eligibleFarmers = await Farmer.find({ 
      cooperativeId: cooperative._id, 
      balance: { $gt: 0 } 
    }).select('name balance farmerCode');

    const totalPayout = eligibleFarmers.reduce((sum, farmer) => sum + farmer.balance, 0);
    const farmersToPay = eligibleFarmers.length;

    // Next payout date (15th of next month)
    const nextPayout = new Date();
    nextPayout.setDate(15);
    if (nextPayout < new Date()) {
      nextPayout.setMonth(nextPayout.getMonth() + 1);
    }

    // Recent payout trend (last 3 months milk volume)
    const threeMonthsAgo = new Date();
    threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);
    
    const recentMilk = await Transaction.aggregate([
      { $match: { 
        type: 'milk', 
        cooperativeId: cooperative._id, 
        timestamp_server: { $gte: threeMonthsAgo } 
      }},
      { $group: { _id: null, totalLitres: { $sum: { $ifNull: ['$litres', 0] } } } }
    ]);

    const avgMonthlyLitres = recentMilk[0]?.totalLitres / 3 || 0;
    const estimatedNextPayout = avgMonthlyLitres * 0.45;  // Assuming KES 45/litre payout rate

    return {
      nextPayoutDate: nextPayout.toISOString().split('T')[0],
      estimatedAmount: Math.round(totalPayout),
      estimatedNextPayout: Math.round(estimatedNextPayout),
      farmersToPay,
      eligibleFarmers: eligibleFarmers.slice(0, 10).map(f => ({
        name: f.name,
        code: f.farmerCode,
        balance: Math.round(f.balance)
      })),
      payoutRateAssumed: 'KES 45 per litre'
    };
  } catch (error) {
    logger.error('PayoutForecast failed', { error: error.message, coopId });
    return getDefaultPayoutForecast();
  }
};

const getDefaultPayoutForecast = () => ({
  nextPayoutDate: null,
  estimatedAmount: 0,
  estimatedNextPayout: 0,
  farmersToPay: 0,
  eligibleFarmers: [],
  payoutRateAssumed: 'KES 45 per litre'
});

module.exports = { getPayoutForecast };