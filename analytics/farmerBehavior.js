const Farmer = require('../models/farmer');
const Transaction = require('../models/transaction');
const logger = require('../utils/logger');

// ✅ FIXED: Replaced loop with Aggregation + Cooperative Scoping
const getFarmerRisks = async (adminId) => {
  const cooperative = await require('../models/cooperative').findById(adminId);
  if (!cooperative) throw new Error('Cooperative not found');

  const risks = await Transaction.aggregate([
    { $match: { cooperativeId: cooperative._id, type: 'milk' } },
    { $group: {
      _id: '$farmer_id',
      lastDelivery: { $max: '$timestamp_server' },
      totalLitres: { $sum: '$litres' }
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
      lastDelivery: '$lastDelivery',
      currentBalance: '$farmer.balance'
    }},
    { $sort: { lastDelivery: -1 } }
  ]);

  const riskList = risks.map(item => {
    const daysSince = item.lastDelivery 
      ? (Date.now() - new Date(item.lastDelivery)) / 86400000 
      : 30;
    
    const debtLevel = Math.abs(item.currentBalance) / 1000;
    const riskScore = (daysSince * 0.5) + (debtLevel * 0.3);
    
    let risk = 'LOW';
    if (riskScore >= 81) risk = 'CRITICAL';
    else if (riskScore >= 61) risk = 'HIGH';
    else if (riskScore >= 31) risk = 'MEDIUM';

    if (risk !== 'LOW') {
      return {
        farmer: item.farmerName,
        lastDelivery: `${daysSince.toFixed(0)} days ago`,
        risk,
        riskScore: riskScore.toFixed(1),
        currentBalance: item.currentBalance
      };
    }
    return null;
  }).filter(Boolean);

  return riskList.sort((a, b) => b.riskScore - a.riskScore);
};

module.exports = { getFarmerRisks };