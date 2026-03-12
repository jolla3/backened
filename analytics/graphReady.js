const Transaction = require('../models/transaction');
const Porter = require('../models/porter');
const Farmer = require('../models/farmer');

const getGraphReadyData = async (period = 'daily', adminId) => {
  const cooperative = await require('../models/cooperative').findById(adminId);
  if (!cooperative) throw new Error('Cooperative not found');

  const now = new Date();
  let startDate;
  
  if (period === 'daily') startDate = new Date(now.setHours(0, 0, 0));
  else if (period === 'weekly') startDate = new Date(now.setDate(now.getDate() - 7));
  else if (period === 'monthly') startDate = new Date(now.setMonth(now.getMonth() - 1));

  // Milk Trend
  const milkTrend = await Transaction.aggregate([
    { $match: { type: 'milk', cooperativeId: cooperative._id, timestamp_server: { $gte: startDate } } },
    { $group: {
      _id: { $dateToString: { format: '%Y-%m-%d', date: '$timestamp_server' } },
      totalLitres: { $sum: '$litres' }
    }},
    { $sort: { _id: 1 } }
  ]);

  // Feed Trend
  const feedTrend = await Transaction.aggregate([
    { $match: { type: 'feed', cooperativeId: cooperative._id, timestamp_server: { $gte: startDate } } },
    { $group: {
      _id: { $dateToString: { format: '%Y-%m-%d', date: '$timestamp_server' } },
      totalQty: { $sum: '$quantity' }
    }},
    { $sort: { _id: 1 } }
  ]);

  // Porter Performance Trend
  const porterTrend = await Transaction.aggregate([
    { $match: { type: 'milk', cooperativeId: cooperative._id, timestamp_server: { $gte: startDate } } },
    { $group: {
      _id: { $dateToString: { format: '%Y-%m-%d', date: '$timestamp_server' } },
      totalLitres: { $sum: '$litres' },
      porterCount: { $addToSet: '$device_id' }
    }},
    { $sort: { _id: 1 } }
  ]);

  // Farmer Growth Trend
  const farmersThisMonth = await Farmer.countDocuments({ cooperativeId: cooperative._id, createdAt: { $gte: startDate } });
  const farmersLastMonth = await Farmer.countDocuments({ cooperativeId: cooperative._id, createdAt: { $gte: new Date(startDate.getTime() - 30*24*60*60*1000), $lt: startDate } });

  // Zone Production Trend
  const zoneTrend = await Transaction.aggregate([
    { $match: { type: 'milk', cooperativeId: cooperative._id, timestamp_server: { $gte: startDate } } },
    { $lookup: {
      from: 'farmers',
      localField: 'farmer_id',
      foreignField: '_id',
      as: 'farmer'
    }},
    { $unwind: '$farmer' },
    { $group: {
      _id: { $dateToString: { format: '%Y-%m-%d', date: '$timestamp_server' } },
      totalMilk: { $sum: '$litres' },
      branch: { $first: '$farmer.branch_id' }
    }},
    { $sort: { _id: 1 } }
  ]);

  // Peak Collection Hours
  const peakHours = await Transaction.aggregate([
    { $match: { type: 'milk', cooperativeId: cooperative._id, timestamp_server: { $gte: startDate } } },
    { $group: {
      _id: { $hour: '$timestamp_server' },
      count: { $sum: 1 }
    }},
    { $sort: { count: -1 } },
    { $limit: 5 }
  ]);

  return {
    milkTrendGraph: {
      labels: milkTrend.map(t => t._id),
      data: milkTrend.map(t => t.totalLitres),
      color: '#3498db'
    },
    feedTrendGraph: {
      labels: feedTrend.map(t => t._id),
      data: feedTrend.map(t => t.totalQty),
      color: '#2ecc71'
    },
    porterTrendGraph: {
      labels: porterTrend.map(t => t._id),
      data: porterTrend.map(t => t.totalLitres),
      color: '#9b59b6'
    },
    farmerGrowthGraph: {
      labels: ['Last Month', 'This Month'],
      data: [farmersLastMonth, farmersThisMonth],
      color: '#e74c3c'
    },
    zoneTrendGraph: {
      labels: zoneTrend.map(t => t._id),
      data: zoneTrend.map(t => t.totalMilk),
      color: '#f39c12'
    },
    peakHours: peakHours.map(h => ({
      hour: h._id,
      count: h.count
    }))
  };
};

module.exports = { getGraphReadyData };