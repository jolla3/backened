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
          transactionCount: { $sum: 1 },
          lastTransaction: { $max: '$timestamp_server' }
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
          farmerCode: { $ifNull: ['$farmer.farmer_code', 'N/A'] },
          lifetimeMilk: '$milkLitres',
          lifetimePayout: '$milkPayout',
          feedPurchased: '$feedCost',
          netValue: { $subtract: ['$milkPayout', '$feedCost'] },
          totalTransactions: '$transactionCount',
          currentBalance: '$farmer.balance',
          lastActivity: '$lastTransaction'
        }
      },
      { $sort: { netValue: -1 } }
    ]);

    const now = new Date();
    const result = farmerValues.map(item => {
      const totalTransactions = item.totalTransactions || 0;
      const lastActivityDays = item.lastActivity ? (now - new Date(item.lastActivity)) / 86400000 : 90;
      
      let tier = 'inactive';
      let valueTier = '';
      if (totalTransactions > 0) {
        if (item.netValue > 50000) {
          tier = 'high_value';
          valueTier = 'High Value (Top 10%)';
        } else if (item.netValue > 10000) {
          tier = 'loyal';
          valueTier = 'Loyal (Top 30%)';
        } else if (item.netValue > 1000) {
          tier = 'growing';
          valueTier = 'Growing';
        } else {
          tier = 'new';
          valueTier = 'New / Low';
        }
      }

      // Activity status
      let status = 'active';
      if (lastActivityDays > 90) status = 'inactive';
      else if (lastActivityDays > 30) status = 'dormant';

      return {
        farmer: item.farmerName,
        code: item.farmerCode,
        lifetimeMilk: Math.round(item.lifetimeMilk || 0),
        lifetimePayout: Math.round(item.lifetimePayout || 0),
        feedPurchased: Math.round(item.feedPurchased || 0),
        netValue: Math.round(item.netValue || 0),
        currentBalance: Math.round(item.currentBalance || 0),
        valueTier,
        status,
        totalTransactions,
        lastActivity: item.lastActivity ? item.lastActivity.toISOString().split('T')[0] : 'Never'
      };
    });

    return result;
  } catch (error) {
    logger.error('FarmerValue failed', { error: error.message, coopId });
    return [];
  }
};

module.exports = { getFarmerValue };