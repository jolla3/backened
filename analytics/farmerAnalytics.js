const Farmer = require('../models/farmer');
const Transaction = require('../models/transaction');
const logger = require('../utils/logger');

// ✅ FIXED: Added adminId, filtered by cooperative, optimized aggregation
const getFarmersWithDebt = async (limit = 10, adminId) => {
  const cooperative = await require('../models/cooperative').findById(adminId);
  if (!cooperative) throw new Error('Cooperative not found');

  const farmers = await Farmer.find({ 
    cooperativeId: cooperative._id, 
    balance: { $lt: 0 } 
  })
  .sort({ balance: 1 })
  .limit(limit)
  .select('name phone balance branch_id');

  return farmers;
};

const getTopFarmersByBalance = async (limit = 10, adminId) => {
  const cooperative = await require('../models/cooperative').findById(adminId);
  if (!cooperative) throw new Error('Cooperative not found');

  const farmers = await Farmer.find({ 
    cooperativeId: cooperative._id, 
    balance: { $gte: 0 } 
  })
  .sort({ balance: -1 })
  .limit(limit)
  .select('name phone balance branch_id');

  return farmers;
};

// ✅ FIXED: Replaced loop with Aggregation (Performance)
const getFeedMilkImbalance = async (limit = 10, adminId) => {
  const cooperative = await require('../models/cooperative').findById(adminId);
  if (!cooperative) throw new Error('Cooperative not found');

  const imbalanceList = await Transaction.aggregate([
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
    { $match: { 'farmer.cooperativeId': cooperative._id } },
    { $project: {
      farmerId: '$_id',
      farmerName: '$farmer.name',
      farmerPhone: '$farmer.phone',
      milkLitres: '$milkLitres',
      milkPayout: '$milkPayout',
      feedCost: '$feedCost',
      netBalance: { $subtract: ['$milkPayout', '$feedCost'] },
      currentBalance: '$farmer.balance'
    }},
    { $match: { feedCost: { $gt: '$milkPayout' }, milkLitres: { $lt: 50 } } },
    { $sort: { netBalance: 1 } },
    { $limit: limit }
  ]);

  return imbalanceList;
};

const getFarmerTransactionHistory = async (farmerId, limit = 20, adminId) => {
  const cooperative = await require('../models/cooperative').findById(adminId);
  if (!cooperative) throw new Error('Cooperative not found');

  // Verify farmer belongs to cooperative
  const farmer = await Farmer.findOne({ _id: farmerId, cooperativeId: cooperative._id });
  if (!farmer) throw new Error('Farmer not found or unauthorized');

  const transactions = await Transaction.find({ 
    farmer_id: farmerId,
    cooperativeId: cooperative._id
  })
  .sort({ timestamp_server: -1 })
  .limit(limit)
  .populate('farmer_id', 'name phone');

  return transactions;
};

module.exports = {
  getFarmersWithDebt,
  getTopFarmersByBalance,
  getFeedMilkImbalance,
  getFarmerTransactionHistory
};