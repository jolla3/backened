const Transaction = require('../models/transaction');
const Farmer = require('../models/farmer');

const getZoneIntelligence = async (adminId) => {
  const cooperative = await require('../models/cooperative').findById(adminId);
  if (!cooperative) throw new Error('Cooperative not found');

  const transactions = await Transaction.aggregate([
    { $match: { type: 'milk', cooperativeId: cooperative._id } },
    { $lookup: {
      from: 'farmers',
      localField: 'farmer_id',
      foreignField: '_id',
      as: 'farmer'
    }},
    { $unwind: '$farmer' },
    { $group: {
      _id: '$farmer.branch_id',
      totalMilk: { $sum: '$litres' },
      activeFarmers: { $addToSet: '$farmer_id' },
      transactions: { $sum: 1 }
    }},
    { $sort: { totalMilk: -1 } }
  ]);

  const zones = transactions.map(zone => ({
    zone: zone._id || 'Main',
    milkToday: zone.totalMilk,
    farmersActive: zone.activeFarmers.length,
    avgMilkPerFarmer: zone.activeFarmers.length > 0 ? (zone.totalMilk / zone.activeFarmers.length).toFixed(2) : 0,
    transactions: zone.transactions
  }));

  return zones;
};

module.exports = { getZoneIntelligence };