const Farmer = require('../models/farmer');
const Transaction = require('../models/transaction');
const logger = require('../utils/logger');

// ✅ FIXED: Replaced loop with Aggregation + Cooperative Scoping
const getFarmerValue = async (adminId) => {
  const cooperative = await require('../models/cooperative').findById(adminId);
  if (!cooperative) throw new Error('Cooperative not found');

  const values = await Transaction.aggregate([
    { $match: { cooperativeId: cooperative._id } },
    { $group: {
      _id: '$farmer_id',
      milkPayout: { $sum: { $cond: [{ $eq: ['$type', 'milk'] }, '$payout', 0] } },
      milkLitres: { $sum: { $cond: [{ $eq: ['$type', 'milk'] }, '$litres', 0] } },
      feedCost: { $sum: { $cond: [{ $eq: ['$type', 'feed'] }, '$cost', 0] } }
    }},
    { $lookup: {
      from: 'farmers',
      localField: '_id',
      foreignField: '_id',
      as: 'farmer'
    }},
    { $unwind: '$farmer' },
    { $project: {
      farmerName: '$farmer.name',
      lifetimeMilk: '$milkLitres',
      feedPurchased: '$feedCost',
      netValue: { $subtract: ['$milkPayout', '$feedCost'] },
      totalTransactions: { $sum: 1 }
    }},
    { $sort: { netValue: -1 } }
  ]);

  return values.map(item => {
    const totalTransactions = (item.lifetimeMilk || 0) + (item.feedPurchased || 0);
    
    let tier = 'inactive';
    if (totalTransactions > 0) {
      if (item.netValue > 50000) tier = 'high_value';
      else if (item.netValue > 10000) tier = 'loyal';
      else if (item.netValue > 0) tier = 'growing';
      else tier = 'new';
    }

    return {
      farmer: item.farmerName,
      lifetimeMilk: item.lifetimeMilk || 0,
      feedPurchased: item.feedPurchased || 0,
      netValue: item.netValue,
      valueTier: tier,
      totalTransactions: totalTransactions > 0 ? 1 : 0
    };
  });
};

module.exports = { getFarmerValue };