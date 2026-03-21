const Transaction = require('../../models/transaction');
const Porter = require('../../models/porter');
const Farmer = require('../../models/farmer');
const Cooperative = require('../../models/cooperative');
const graphReadyDataModule = require('../../analytics/graphReady');
const logger = require('../../utils/logger');

const getAnalytics = async (period = 'daily', cooperativeId) => {  // ✅ FIXED: cooperativeId
  try {
    // ✅ VALIDATE cooperative
    const cooperative = await Cooperative.findById(cooperativeId);
    if (!cooperative) throw new Error('Cooperative not found');

    const [milkTrends, porterPerformance, zoneProduction, topFarmer, lowestProducer, milkPrediction, graphReady] = await Promise.all([
      getMilkTrends(period, cooperativeId),
      getPorterPerformance(cooperativeId),
      getZoneProduction(cooperativeId),
      getTopFarmer(cooperativeId),
      getLowestProducer(cooperativeId),
      getMilkPrediction(cooperativeId),
      graphReadyDataModule.getGraphReadyData(period, cooperativeId)
    ]);

    return {
      milkTrends,
      porterPerformance,
      zoneProduction,
      topFarmer,
      lowestProducer,
      milkPrediction,
      graphReady
    };
  } catch (error) {
    logger.warn('Analytics failed', { error: error.message, coopId: cooperativeId });
    return getDefaultAnalytics();
  }
};

const getMilkTrends = async (period, cooperativeId) => {
  const cooperative = await Cooperative.findById(cooperativeId);
  const now = new Date();
  let startDate;
  
  if (period === 'daily') startDate = new Date(now.setHours(0, 0, 0));
  else if (period === 'weekly') startDate = new Date(now.setDate(now.getDate() - 7));
  else if (period === 'monthly') startDate = new Date(now.setMonth(now.getMonth() - 1));

  const trends = await Transaction.aggregate([
    { 
      $match: { 
        type: 'milk', 
        cooperativeId: cooperative._id, 
        timestamp_server: { $gte: startDate } 
      } 
    },
    { 
      $group: {
        _id: { $dateToString: { format: '%Y-%m-%d', date: '$timestamp_server' } },
        totalLitres: { $sum: '$litres' }
      }
    },
    { $sort: { _id: 1 } }
  ]);

  return trends.map(t => ({
    date: t._id,
    litres: t.totalLitres || 0
  }));
};

const getPorterPerformance = async (cooperativeId) => {
  const cooperative = await Cooperative.findById(cooperativeId);
  const porters = await Porter.find({ cooperativeId: cooperative._id });
  const performance = [];

  for (const porter of porters) {
    const stats = await Transaction.aggregate([
      { 
        $match: { 
          porter_id: porter._id, 
          cooperativeId: cooperative._id, 
          type: 'milk' 
        } 
      },
      { 
        $group: { 
          _id: null, 
          totalLitres: { $sum: '$litres' }, 
          transactionCount: { $sum: 1 } 
        } 
      }
    ]);

    performance.push({
      porter: porter.name,
      zones: porter.zones || [],
      totalLitres: stats[0]?.totalLitres || 0,
      transactionCount: stats[0]?.transactionCount || 0
    });
  }

  return performance.sort((a, b) => b.totalLitres - a.totalLitres);
};

const getZoneProduction = async (cooperativeId) => {
  const cooperative = await Cooperative.findById(cooperativeId);
  const zoneProduction = await Transaction.aggregate([
    { $match: { type: 'milk', cooperativeId: cooperative._id } },
    { 
      $lookup: {
        from: 'farmers',
        localField: 'farmer_id',
        foreignField: '_id',
        as: 'farmer'
      }
    },
    { $unwind: { path: '$farmer', preserveNullAndEmptyArrays: true } },
    { 
      $group: {
        _id: { $ifNull: ['$farmer.branch_id', 'main'] },
        totalMilk: { $sum: { $ifNull: ['$litres', 0] } },
        farmers: { $addToSet: { $ifNull: ['$farmer._id', null] } }
      }
    },
    { $sort: { totalMilk: -1 } }
  ]);

  return zoneProduction.map(z => ({
    zone: z._id || 'main',
    totalMilk: z.totalMilk || 0,
    farmers: (z.farmers || []).filter(f => f).length
  }));
};

const getTopFarmer = async (cooperativeId) => {
  const cooperative = await Cooperative.findById(cooperativeId);
  const topFarmer = await Transaction.aggregate([
    { $match: { type: 'milk', cooperativeId: cooperative._id } },
    { 
      $lookup: {
        from: 'farmers',
        localField: 'farmer_id',
        foreignField: '_id',
        as: 'farmer'
      }
    },
    { $unwind: { path: '$farmer', preserveNullAndEmptyArrays: true } },
    { 
      $group: {
        _id: '$farmer._id',
        farmerName: { $first: '$farmer.name' },
        totalLitres: { $sum: '$litres' },
        totalPayout: { $sum: '$payout' }
      }
    },
    { $sort: { totalLitres: -1 } },
    { $limit: 1 },
    { $match: { '_id': { $ne: null } } }
  ]);

  return topFarmer[0] ? {
    farmer: topFarmer[0].farmerName,
    totalLitres: topFarmer[0].totalLitres,
    totalPayout: topFarmer[0].totalPayout || 0
  } : null;
};

const getLowestProducer = async (cooperativeId) => {
  const cooperative = await Cooperative.findById(cooperativeId);
  const lowestProducer = await Transaction.aggregate([
    { $match: { type: 'milk', cooperativeId: cooperative._id } },
    { 
      $lookup: {
        from: 'farmers',
        localField: 'farmer_id',
        foreignField: '_id',
        as: 'farmer'
      }
    },
    { $unwind: { path: '$farmer', preserveNullAndEmptyArrays: true } },
    { 
      $group: {
        _id: '$farmer._id',
        farmerName: { $first: '$farmer.name' },
        totalLitres: { $sum: '$litres' }
      }
    },
    { $sort: { totalLitres: 1 } },
    { $limit: 1 },
    { $match: { '_id': { $ne: null } } }
  ]);

  return lowestProducer[0] ? {
    farmer: lowestProducer[0].farmerName,
    totalLitres: lowestProducer[0].totalLitres
  } : null;
};

const getMilkPrediction = async (cooperativeId) => {
  const cooperative = await Cooperative.findById(cooperativeId);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const last7Days = new Date(today);
  last7Days.setDate(last7Days.getDate() - 7);

  const last7Milk = await Transaction.aggregate([
    { 
      $match: { 
        type: 'milk', 
        cooperativeId: cooperative._id, 
        timestamp_server: { $gte: last7Days, $lt: today } 
      } 
    },
    { $group: { _id: null, totalLitres: { $sum: '$litres' } } }
  ]);

  const last7Avg = last7Milk[0]?.totalLitres / 7 || 0;
  const predictedTomorrow = last7Avg * 1.05; // 5% growth

  return {
    predictedTomorrow: Math.round(predictedTomorrow),
    confidence: last7Avg > 0 ? 'medium' : 'low',
    basedOn: '7-day average',
    last7Average: Math.round(last7Avg)
  };
};

const getDefaultAnalytics = () => ({
  milkTrends: [],
  porterPerformance: [],
  zoneProduction: [],
  topFarmer: null,
  lowestProducer: null,
  milkPrediction: null,
  graphReady: {
    milkTrendGraph: { labels: [], data: [], color: '#3498db' },
    feedTrendGraph: { labels: [], data: [], color: '#2ecc71' },
    porterTrendGraph: { labels: [], data: [], color: '#9b59b6' },
    farmerGrowthGraph: { labels: [], data: [], color: '#e74c3c' },
    zoneTrendGraph: { labels: [], data: [], color: '#f39c12' },
    peakHours: []
  }
});

module.exports = { getAnalytics };