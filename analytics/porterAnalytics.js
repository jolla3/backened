const Transaction = require('../models/transaction');
const Porter = require('../models/porter');
const Device = require('../models/device');
const logger = require('../utils/logger');

const getTopPorters = async (limit = 10, period = 'weekly', adminId) => {
  const cooperative = await require('../models/cooperative').findById(adminId);
  if (!cooperative) throw new Error('Cooperative not found');

  const now = new Date();
  let startDate;
  
  if (period === 'daily') {
    startDate = new Date(now.setHours(0, 0, 0));
  } else if (period === 'weekly') {
    startDate = new Date(now.setDate(now.getDate() - 7));
  } else if (period === 'monthly') {
    startDate = new Date(now.setMonth(now.getMonth() - 1));
  }

  const topPorters = await Transaction.aggregate([
    { $match: { type: 'milk', cooperativeId: cooperative._id, timestamp_server: { $gte: startDate } } },
    { $group: {
      _id: '$device_id',
      totalLitres: { $sum: '$litres' },
      totalPayout: { $sum: '$payout' },
      transactionCount: { $sum: 1 },
      avgLitresPerTransaction: { $avg: '$litres' }
    }},
    { $lookup: {
      from: 'porters',
      localField: '_id',
      foreignField: '_id',
      as: 'porter'
    }},
    { $unwind: '$porter' },
    { $project: {
      porterId: '$_id',
      porterName: '$porter.name',
      zones: '$porter.zones',
      totalLitres: 1,
      totalPayout: 1,
      transactionCount: 1,
      avgLitresPerTransaction: { $round: ['$avgLitresPerTransaction', 2] }
    }},
    { $sort: { totalLitres: -1 } },
    { $limit: limit }
  ]);

  return topPorters;
};

const getPorterPerformanceSummary = async (adminId) => {
  const cooperative = await require('../models/cooperative').findById(adminId);
  if (!cooperative) throw new Error('Cooperative not found');

  const porters = await Porter.find({ cooperativeId: cooperative._id });
  
  const summary = [];
  
  for (const porter of porters) {
    const stats = await Transaction.aggregate([
      { $match: { device_id: porter._id, cooperativeId: cooperative._id } },
      { $group: {
        _id: null,
        totalLitres: { $sum: '$litres' },
        totalPayout: { $sum: '$payout' },
        transactionCount: { $sum: 1 },
        avgLitresPerTransaction: { $avg: '$litres' }
      }}
    ]);

    summary.push({
      porterId: porter._id,
      porterName: porter.name,
      zones: porter.zones,
      totalLitres: stats[0]?.totalLitres || 0,
      totalPayout: stats[0]?.totalPayout || 0,
      transactionCount: stats[0]?.transactionCount || 0,
      avgLitresPerTransaction: parseFloat((stats[0]?.avgLitresPerTransaction || 0).toFixed(2))
    });
  }

  return summary.sort((a, b) => b.totalLitres - a.totalLitres);
};

const getPorterFraudRiskScore = async (adminId) => {
  const cooperative = await require('../models/cooperative').findById(adminId);
  if (!cooperative) throw new Error('Cooperative not found');

  const porters = await Porter.find({ cooperativeId: cooperative._id });
  const riskScores = [];
  
  for (const porter of porters) {
    let riskScore = 0;
    const indicators = [];

    const midnightCount = await Transaction.countDocuments({
      device_id: porter._id,
      cooperativeId: cooperative._id,
      type: 'milk',
      timestamp_server: {
        $gte: new Date(new Date().setHours(22, 0, 0, 0)),
        $lt: new Date(new Date().setHours(4, 0, 0, 0))
      }
    });

    if (midnightCount > 0) {
      riskScore += midnightCount * 10;
      indicators.push('midnight_transactions');
    }

    const largeDeliveryCount = await Transaction.countDocuments({
      device_id: porter._id,
      cooperativeId: cooperative._id,
      type: 'milk',
      litres: { $gt: 100 }
    });

    if (largeDeliveryCount > 0) {
      riskScore += largeDeliveryCount * 5;
      indicators.push('large_deliveries');
    }

    let riskLevel = 'low';
    if (riskScore >= 50) riskLevel = 'critical';
    else if (riskScore >= 30) riskLevel = 'high';
    else if (riskScore >= 10) riskLevel = 'medium';

    riskScores.push({
      porterId: porter._id,
      porterName: porter.name,
      zones: porter.zones,
      riskScore,
      riskLevel,
      indicators
    });
  }

  return riskScores.sort((a, b) => b.riskScore - a.riskScore);
};

module.exports = {
  getTopPorters,
  getPorterPerformanceSummary,
  getPorterFraudRiskScore
};