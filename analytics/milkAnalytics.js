const Transaction = require('../models/transaction');
const Farmer = require('../models/farmer');

const getTopMilkProducers = async (limit = 10, period = 'weekly', adminId) => {
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
  } else {
    startDate = new Date(now.setFullYear(now.getFullYear() - 1));
  }

  const topProducers = await Transaction.aggregate([
    { $match: { type: 'milk', cooperativeId: cooperative._id, timestamp_server: { $gte: startDate } } },
    { $group: {
      _id: '$farmer_id',
      totalLitres: { $sum: '$litres' },
      totalPayout: { $sum: '$payout' },
      transactionCount: { $sum: 1 },
      avgLitresPerTransaction: { $avg: '$litres' }
    }},
    { $lookup: {
      from: 'farmers',
      localField: '_id',
      foreignField: '_id',
      as: 'farmer'
    }},
    { $unwind: '$farmer' },
    { $project: {
      farmerId: '$_id',
      farmerName: '$farmer.name',
      farmerPhone: '$farmer.phone',
      totalLitres: 1,
      totalPayout: 1,
      transactionCount: 1,
      avgLitresPerTransaction: { $round: ['$avgLitresPerTransaction', 2] }
    }},
    { $sort: { totalLitres: -1 } },
    { $limit: limit }
  ]);

  return topProducers;
};

const getLowPerformingFarmers = async (period = 'weekly', adminId) => {
  const cooperative = await require('../models/cooperative').findById(adminId);
  if (!cooperative) throw new Error('Cooperative not found');

  const now = new Date();
  let currentStartDate, previousStartDate;
  
  if (period === 'daily') {
    currentStartDate = new Date(now.setHours(0, 0, 0));
    previousStartDate = new Date(now.setDate(now.getDate() - 1));
  } else if (period === 'weekly') {
    currentStartDate = new Date(now.setDate(now.getDate() - 7));
    previousStartDate = new Date(now.setDate(now.getDate() - 14));
  } else if (period === 'monthly') {
    currentStartDate = new Date(now.setMonth(now.getMonth() - 1));
    previousStartDate = new Date(now.setMonth(now.getMonth() - 2));
  }

  const currentPeriod = await Transaction.aggregate([
    { $match: { type: 'milk', cooperativeId: cooperative._id, timestamp_server: { $gte: currentStartDate } } },
    { $group: { _id: '$farmer_id', totalLitres: { $sum: '$litres' } } }
  ]);

  const previousPeriod = await Transaction.aggregate([
    { $match: { type: 'milk', cooperativeId: cooperative._id, timestamp_server: { $gte: previousStartDate, $lt: currentStartDate } } },
    { $group: { _id: '$farmer_id', totalLitres: { $sum: '$litres' } } }
  ]);

  const currentMap = new Map(currentPeriod.map(p => [p._id.toString(), p.totalLitres]));
  const previousMap = new Map(previousPeriod.map(p => [p._id.toString(), p.totalLitres]));

  const lowPerformers = [];
  
  for (const [farmerId, currentLitres] of currentMap) {
    const previousLitres = previousMap.get(farmerId) || 0;
    const change = currentLitres - previousLitres;
    const changePercent = previousLitres > 0 ? (change / previousLitres) * 100 : 0;
    
    if (change < 0 && Math.abs(changePercent) > 20) {
      const farmer = await Farmer.findById(farmerId);
      if (farmer) {
        lowPerformers.push({
          farmerId,
          farmerName: farmer.name,
          farmerPhone: farmer.phone,
          currentPeriodLitres: currentLitres,
          previousPeriodLitres: previousLitres,
          change: change,
          changePercent: parseFloat(changePercent.toFixed(2))
        });
      }
    }
  }

  return lowPerformers.sort((a, b) => a.changePercent - b.changePercent);
};

const getMilkCollectionTrends = async (period = 'daily', adminId) => {
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
  } else {
    startDate = new Date(now.setFullYear(now.getFullYear() - 1));
  }

  const trends = await Transaction.aggregate([
    { $match: { type: 'milk', cooperativeId: cooperative._id, timestamp_server: { $gte: startDate } } },
    { $group: {
      _id: { $dateToString: { format: '%Y-%m-%d', date: '$timestamp_server' } },
      totalLitres: { $sum: '$litres' },
      totalPayout: { $sum: '$payout' },
      transactionCount: { $sum: 1 }
    }},
    { $sort: { _id: 1 } }
  ]);

  return trends;
};

const getZoneMilkCollection = async (adminId) => {
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
      totalLitres: { $sum: '$litres' },
      totalPayout: { $sum: '$payout' },
      transactionCount: { $sum: 1 }
    }},
    { $sort: { totalLitres: -1 } }
  ]);

  return transactions;
};

module.exports = {
  getTopMilkProducers,
  getLowPerformingFarmers,
  getMilkCollectionTrends,
  getZoneMilkCollection
};