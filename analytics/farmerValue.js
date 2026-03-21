const Farmer = require('../models/farmer');
const Transaction = require('../models/transaction');
const Cooperative = require('../models/cooperative');
const logger = require('../utils/logger');

const getFarmerValue = async (cooperativeId) => {
  try {
    const cooperative = await Cooperative.findById(cooperativeId);
    if (!cooperative) throw new Error('Cooperative not found');

    const farmerValues = await Transaction.aggregate([
      { $match: { cooperativeId: cooperative._id } },
      { 
        $group: {
          _id: '$farmer_id',
          milkPayout: { $sum: { $cond: [{ $eq: ['$type', 'milk'] }, { $ifNull: ['$payout', 0] }, 0] } },
          milkLitres: { $sum: { $cond: [{ $eq: ['$type', 'milk'] }, { $ifNull: ['$litres', 0] }, 0] } },
          feedCost: { $sum: { $cond: [{ $eq: ['$type', 'feed'] }, { $ifNull: ['$cost', 0] }, 0] } },
          transactionCount: { $sum: 1 }
        }
      },
      { 
        $lookup: {
          from: 'farmers',
          localField: '_id',
          foreignField: '_id',
          as: 'farmer'
        }
      },
      { $unwind: { path: '$farmer', preserveNullAndEmptyArrays: true } },
      { 
        $project: {
          farmerName: { $ifNull: ['$farmer.name', 'Unknown'] },
          farmerCode: { $ifNull: ['$farmer.farmerCode', 'N/A'] },
          lifetimeMilk: '$milkLitres',
          feedPurchased: '$feedCost',
          netValue: { $subtract: ['$milkPayout', '$feedCost'] },
          totalTransactions: '$transactionCount',
          currentBalance: '$farmer.balance'
        }
      },
      { $sort: { netValue: -1 } },
      { $limit: 50 }
    ]);

    const result = farmerValues.map(item => {
      const totalTransactions = item.totalTransactions || 0;
      
      let tier = 'inactive';
      if (totalTransactions > 0) {
        if (item.netValue > 50000) tier = 'high_value';
        else if (item.netValue > 10000) tier = 'loyal';
        else if (item.netValue > 1000) tier = 'growing';
        else tier = 'new';
      }

      return {
        farmer: item.farmerName,
        code: item.farmerCode,
        lifetimeMilk: Math.round(item.lifetimeMilk || 0),
        feedPurchased: Math.round(item.feedPurchased || 0),
        netValue: Math.round(item.netValue || 0),
        currentBalance: Math.round(item.currentBalance || 0),
        valueTier: tier,
        totalTransactions: totalTransactions
      };
    });

    return result;
  } catch (error) {
    logger.error('FarmerValue failed', { error: error.message, coopId });
    return [];
  }
};

module.exports = { getFarmerValue };