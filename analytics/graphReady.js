const Transaction = require('../models/transaction');
const Porter = require('../models/porter');
const Farmer = require('../models/farmer');
const Cooperative = require('../models/cooperative');
const logger = require('../utils/logger');

const getGraphReadyData = async (period = 'daily', cooperativeId) => {  // ✅ FIXED: cooperativeId
  try {
    const cooperative = await Cooperative.findById(cooperativeId);
    if (!cooperative) throw new Error('Cooperative not found');

    const now = new Date();
    let startDate;
    
    if (period === 'daily') {
      startDate = new Date(now);
      startDate.setHours(0, 0, 0, 0);
    } else if (period === 'weekly') {
      startDate = new Date(now);
      startDate.setDate(startDate.getDate() - 7);
    } else if (period === 'monthly') {
      startDate = new Date(now);
      startDate.setMonth(startDate.getMonth() - 1);
    }

    logger.info('GraphReady data', { period, cooperativeId: cooperative._id, startDate: startDate.toISOString() });

    // ✅ Milk Trend
    const milkTrend = await Transaction.aggregate([
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
          totalLitres: { $sum: { $ifNull: ['$litres', 0] } }
        }
      },
      { $sort: { _id: 1 } }
    ]);

    // ✅ Feed Trend
    const feedTrend = await Transaction.aggregate([
      { 
        $match: { 
          type: 'feed', 
          cooperativeId: cooperative._id, 
          timestamp_server: { $gte: startDate } 
        } 
      },
      { 
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$timestamp_server' } },
          totalQty: { $sum: { $ifNull: ['$quantity', 0] } }
        }
      },
      { $sort: { _id: 1 } }
    ]);

    // ✅ Porter Performance Trend (transactions per day)
    const porterTrend = await Transaction.aggregate([
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
          totalLitres: { $sum: { $ifNull: ['$litres', 0] } },
          transactionCount: { $sum: 1 }
        }
      },
      { $sort: { _id: 1 } }
    ]);

    // ✅ Farmer Growth (new farmers)
    const monthAgo = new Date(startDate);
    monthAgo.setDate(monthAgo.getDate() - 30);
    
    const farmersThisPeriod = await Farmer.countDocuments({ 
      cooperativeId: cooperative._id, 
      createdAt: { $gte: startDate } 
    });
    const farmersPrevPeriod = await Farmer.countDocuments({ 
      cooperativeId: cooperative._id, 
      createdAt: { $gte: monthAgo, $lt: startDate } 
    });

    // ✅ Zone Production Trend
    const zoneTrend = await Transaction.aggregate([
      { 
        $match: { 
          type: 'milk', 
          cooperativeId: cooperative._id, 
          timestamp_server: { $gte: startDate } 
        } 
      },
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
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$timestamp_server' } },
          totalMilk: { $sum: { $ifNull: ['$litres', 0] } }
        }
      },
      { $sort: { _id: 1 } }
    ]);

    // ✅ Peak Collection Hours
    const peakHours = await Transaction.aggregate([
      { 
        $match: { 
          type: 'milk', 
          cooperativeId: cooperative._id, 
          timestamp_server: { $gte: startDate } 
        } 
      },
      { 
        $group: {
          _id: { $hour: '$timestamp_server' },
          count: { $sum: 1 },
          avgLitres: { $avg: '$litres' }
        }
      },
      { $sort: { count: -1 } },
      { $limit: 6 }
    ]);

    const result = {
      milkTrendGraph: {
        labels: milkTrend.map(t => t._id).slice(-30),  // Last 30 days max
        data: milkTrend.map(t => t.totalLitres).slice(-30),
        color: '#3498db'
      },
      feedTrendGraph: {
        labels: feedTrend.map(t => t._id).slice(-30),
        data: feedTrend.map(t => t.totalQty).slice(-30),
        color: '#2ecc71'
      },
      porterTrendGraph: {
        labels: porterTrend.map(t => t._id).slice(-30),
        data: porterTrend.map(t => t.totalLitres).slice(-30),
        color: '#9b59b6'
      },
      farmerGrowthGraph: {
        labels: ['Previous Period', `${period.charAt(0).toUpperCase() + period.slice(1)}`],
        data: [farmersPrevPeriod, farmersThisPeriod],
        color: '#e74c3c'
      },
      zoneTrendGraph: {
        labels: zoneTrend.map(t => t._id).slice(-30),
        data: zoneTrend.map(t => t.totalMilk).slice(-30),
        color: '#f39c12'
      },
      peakHours: peakHours.map(h => ({
        hour: `${h._id}:00 - ${(h._id + 1) % 24}:00`,
        count: h.count,
        avgLitres: Math.round(h.avgLitres || 0)
      }))
    };

    logger.info('GraphReady success', { 
      milkCount: milkTrend.length, 
      feedCount: feedTrend.length, 
      period 
    });

    return result;
  } catch (error) {
    logger.error('GraphReady failed', { error: error.message, coopId, period });
    return getDefaultGraphReady();
  }
};

const getDefaultGraphReady = () => ({
  milkTrendGraph: { labels: [], data: [], color: '#3498db' },
  feedTrendGraph: { labels: [], data: [], color: '#2ecc71' },
  porterTrendGraph: { labels: [], data: [], color: '#9b59b6' },
  farmerGrowthGraph: { labels: ['Previous', 'Current'], data: [0, 0], color: '#e74c3c' },
  zoneTrendGraph: { labels: [], data: [], color: '#f39c12' },
  peakHours: []
});

module.exports = { getGraphReadyData };