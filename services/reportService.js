const mongoose = require('mongoose');
const Transaction = require('../models/transaction');
const Farmer = require('../models/farmer');
const Porter = require('../models/porter');
const Cooperative = require('../models/cooperative');
const RateVersion = require('../models/rateVersion');
const Inventory = require('../models/inventory');
const logger = require('../utils/logger');

/**
 * Generate a comprehensive monthly report for a cooperative.
 * @param {number} year - 4-digit year
 * @param {number} month - 1-12
 * @param {string} cooperativeId - ObjectId
 * @returns {Object} detailed report
 */
const getMonthlyReport = async (year, month, cooperativeId) => {
  // Validate cooperative
  const cooperative = await Cooperative.findById(cooperativeId).lean();
  if (!cooperative) throw new Error('Cooperative not found');

  // Parse and validate month/year
  const y = parseInt(year);
  const m = parseInt(month);
  if (isNaN(y) || isNaN(m) || m < 1 || m > 12) {
    throw new Error('Invalid year or month');
  }

  // Date range: start of month (00:00:00) to end of month (23:59:59.999)
  const startDate = new Date(y, m - 1, 1);
  const endDate = new Date(y, m, 0, 23, 59, 59, 999);

  // Convert cooperativeId to ObjectId once and reuse
  const coopObjectId = new mongoose.Types.ObjectId(cooperativeId);

  // Helper to run aggregation pipelines
  const runAgg = async (pipeline) => Transaction.aggregate(pipeline);

  // ========== 1. OVERVIEW ==========
  const overviewPipeline = [
    {
      $match: {
        cooperativeId: coopObjectId,
        type: 'milk',
        timestamp_server: { $gte: startDate, $lte: endDate }
      }
    },
    {
      $group: {
        _id: null,
        totalLitres: { $sum: '$litres' },
        totalPayout: { $sum: '$payout' },
        transactionCount: { $sum: 1 },
        uniqueFarmers: { $addToSet: '$farmer_id' },
        uniquePorters: { $addToSet: '$porter_id' },
        zones: { $addToSet: '$zone' }
      }
    }
  ];
  const overviewResult = (await runAgg(overviewPipeline))[0] || {};
  const totalLitres = overviewResult.totalLitres || 0;
  const totalPayout = overviewResult.totalPayout || 0;
  const transactionCount = overviewResult.transactionCount || 0;
  const uniqueFarmersCount = overviewResult.uniqueFarmers?.length || 0;
  const uniquePortersCount = overviewResult.uniquePorters?.length || 0;
  const zonesCount = overviewResult.zones?.length || 0;

  // Farmers total and active
  const allFarmersCount = await Farmer.countDocuments({ cooperativeId: coopObjectId, isActive: true });
  const farmersWithDeliveries = uniqueFarmersCount;
  const farmersWithoutDeliveries = allFarmersCount - farmersWithDeliveries;

  // Averages
  const avgLitresPerTransaction = transactionCount ? totalLitres / transactionCount : 0;
  const avgPayoutPerTransaction = transactionCount ? totalPayout / transactionCount : 0;
  const avgLitresPerFarmer = farmersWithDeliveries ? totalLitres / farmersWithDeliveries : 0;
  const avgPayoutPerFarmer = farmersWithDeliveries ? totalPayout / farmersWithDeliveries : 0;

  // ========== 2. FINANCIAL BREAKDOWNS ==========
  // 2a. Rate version usage
  const rateBreakdownPipeline = [
    {
      $match: {
        cooperativeId: coopObjectId,
        type: 'milk',
        timestamp_server: { $gte: startDate, $lte: endDate }
      }
    },
    {
      $lookup: {
        from: 'rateversions',
        localField: 'rate_version_id',
        foreignField: '_id',
        as: 'rateInfo'
      }
    },
    { $unwind: { path: '$rateInfo', preserveNullAndEmptyArrays: true } },
    {
      $group: {
        _id: { rate: '$rateInfo.rate', effective_date: '$rateInfo.effective_date' },
        transactionCount: { $sum: 1 },
        totalLitres: { $sum: '$litres' },
        totalPayout: { $sum: '$payout' }
      }
    },
    {
      $project: {
        rate: '$_id.rate',
        effectiveDate: '$_id.effective_date',
        transactionCount: 1,
        totalLitres: 1,
        totalPayout: 1,
        _id: 0
      }
    },
    { $sort: { transactionCount: -1 } }
  ];
  const rateBreakdown = await runAgg(rateBreakdownPipeline);

  // 2b. Payout by week (week numbers of the month)
  const weeklyPipeline = [
    {
      $match: {
        cooperativeId: coopObjectId,
        type: 'milk',
        timestamp_server: { $gte: startDate, $lte: endDate }
      }
    },
    {
      $group: {
        _id: { week: { $week: '$timestamp_server' } },
        totalPayout: { $sum: '$payout' },
        totalLitres: { $sum: '$litres' },
        transactionCount: { $sum: 1 }
      }
    },
    {
      $project: {
        week: '$_id.week',
        totalPayout: 1,
        totalLitres: 1,
        transactionCount: 1,
        _id: 0
      }
    },
    { $sort: { week: 1 } }
  ];
  const weekly = await runAgg(weeklyPipeline);

  // 2c. Payout by zone
  const zonePipeline = [
    {
      $match: {
        cooperativeId: coopObjectId,
        type: 'milk',
        timestamp_server: { $gte: startDate, $lte: endDate }
      }
    },
    {
      $group: {
        _id: '$zone',
        totalPayout: { $sum: '$payout' },
        totalLitres: { $sum: '$litres' },
        transactionCount: { $sum: 1 }
      }
    },
    {
      $project: {
        zone: '$_id',
        totalPayout: 1,
        totalLitres: 1,
        transactionCount: 1,
        _id: 0
      }
    },
    { $sort: { totalPayout: -1 } }
  ];
  const zoneBreakdown = await runAgg(zonePipeline);

  // 2d. Top 10 porters by payout
  const porterPipeline = [
    {
      $match: {
        cooperativeId: coopObjectId,
        type: 'milk',
        timestamp_server: { $gte: startDate, $lte: endDate }
      }
    },
    {
      $group: {
        _id: '$porter_id',
        totalPayout: { $sum: '$payout' },
        totalLitres: { $sum: '$litres' },
        transactionCount: { $sum: 1 }
      }
    },
    {
      $lookup: {
        from: 'porters',
        localField: '_id',
        foreignField: '_id',
        as: 'porterInfo'
      }
    },
    { $unwind: { path: '$porterInfo', preserveNullAndEmptyArrays: true } },
    {
      $project: {
        porterId: '$_id',
        porterName: { $ifNull: ['$porterInfo.name', 'Unknown'] },
        totalPayout: 1,
        totalLitres: 1,
        transactionCount: 1,
        _id: 0
      }
    },
    { $sort: { totalPayout: -1 } },
    { $limit: 10 }
  ];
  const topPorters = await runAgg(porterPipeline);

  // ========== 3. FARMER PERFORMANCE ==========
  // Top 10 farmers by volume
  const topFarmersPipeline = [
    {
      $match: {
        cooperativeId: coopObjectId,
        type: 'milk',
        timestamp_server: { $gte: startDate, $lte: endDate }
      }
    },
    {
      $group: {
        _id: '$farmer_id',
        totalLitres: { $sum: '$litres' },
        totalPayout: { $sum: '$payout' },
        transactionCount: { $sum: 1 }
      }
    },
    {
      $lookup: {
        from: 'farmers',
        localField: '_id',
        foreignField: '_id',
        as: 'farmerInfo'
      }
    },
    { $unwind: { path: '$farmerInfo', preserveNullAndEmptyArrays: true } },
    {
      $project: {
        farmerId: '$_id',
        farmerCode: '$farmerInfo.farmer_code',
        farmerName: '$farmerInfo.name',
        totalLitres: 1,
        totalPayout: 1,
        transactionCount: 1,
        _id: 0
      }
    },
    { $sort: { totalLitres: -1 } },
    { $limit: 10 }
  ];
  const topFarmersByVolume = await runAgg(topFarmersPipeline);

  // Bottom 10 farmers by volume (among those who had deliveries)
  const bottomFarmersPipeline = [
    {
      $match: {
        cooperativeId: coopObjectId,
        type: 'milk',
        timestamp_server: { $gte: startDate, $lte: endDate }
      }
    },
    {
      $group: {
        _id: '$farmer_id',
        totalLitres: { $sum: '$litres' },
        totalPayout: { $sum: '$payout' },
        transactionCount: { $sum: 1 }
      }
    },
    {
      $lookup: {
        from: 'farmers',
        localField: '_id',
        foreignField: '_id',
        as: 'farmerInfo'
      }
    },
    { $unwind: { path: '$farmerInfo', preserveNullAndEmptyArrays: true } },
    {
      $project: {
        farmerId: '$_id',
        farmerCode: '$farmerInfo.farmer_code',
        farmerName: '$farmerInfo.name',
        totalLitres: 1,
        totalPayout: 1,
        transactionCount: 1,
        _id: 0
      }
    },
    { $sort: { totalLitres: 1 } },
    { $limit: 10 }
  ];
  const bottomFarmersByVolume = await runAgg(bottomFarmersPipeline);

  // Farmers with no deliveries
  const farmersWithDeliveriesIds = (await Farmer.distinct('_id', { _id: { $in: overviewResult.uniqueFarmers || [] } })).map(id => id.toString());
  const farmersNoDeliveries = await Farmer.find({
    cooperativeId: coopObjectId,
    isActive: true,
    _id: { $nin: farmersWithDeliveriesIds }
  })
    .select('farmer_code name')
    .limit(20)
    .lean();

  // ========== 4. PORTER PERFORMANCE ==========
  // Porter zone coverage
  const zonePorterPipeline = [
    {
      $match: {
        cooperativeId: coopObjectId,
        type: 'milk',
        timestamp_server: { $gte: startDate, $lte: endDate }
      }
    },
    {
      $group: {
        _id: { zone: '$zone', porter: '$porter_id' },
        totalLitres: { $sum: '$litres' },
        totalPayout: { $sum: '$payout' },
        transactionCount: { $sum: 1 }
      }
    },
    {
      $group: {
        _id: '$_id.zone',
        porters: { $addToSet: '$_id.porter' },
        totalLitres: { $sum: '$totalLitres' },
        totalPayout: { $sum: '$totalPayout' },
        transactionCount: { $sum: '$transactionCount' }
      }
    },
    {
      $project: {
        zone: '$_id',
        porterCount: { $size: '$porters' },
        totalLitres: 1,
        totalPayout: 1,
        transactionCount: 1,
        _id: 0
      }
    },
    { $sort: { totalLitres: -1 } }
  ];
  const zoneCoverage = await runAgg(zonePorterPipeline);

  // Detailed porter stats
  const porterStats = await Porter.aggregate([
    { $match: { cooperativeId: coopObjectId, isActive: true } },
    {
      $lookup: {
        from: 'transactions',
        let: { porterId: '$_id' },
        pipeline: [
          {
            $match: {
              $expr: { $eq: ['$porter_id', '$$porterId'] },
              timestamp_server: { $gte: startDate, $lte: endDate },
              type: 'milk'
            }
          },
          {
            $group: {
              _id: null,
              totalLitres: { $sum: '$litres' },
              totalPayout: { $sum: '$payout' },
              count: { $sum: 1 }
            }
          }
        ],
        as: 'stats'
      }
    },
    {
      $project: {
        name: 1,
        zones: 1,
        totalLitres: { $ifNull: [{ $arrayElemAt: ['$stats.totalLitres', 0] }, 0] },
        totalPayout: { $ifNull: [{ $arrayElemAt: ['$stats.totalPayout', 0] }, 0] },
        transactionCount: { $ifNull: [{ $arrayElemAt: ['$stats.count', 0] }, 0] }
      }
    }
  ]);

  const activePorters = porterStats.filter(p => p.transactionCount > 0).length;
  const avgLitresPerPorter = activePorters
    ? porterStats.reduce((sum, p) => sum + p.totalLitres, 0) / activePorters
    : 0;
  const avgPayoutPerPorter = activePorters
    ? porterStats.reduce((sum, p) => sum + p.totalPayout, 0) / activePorters
    : 0;

  // ========== 5. INVENTORY & FEED SALES ==========
  const feedTransactions = await Transaction.find({
    cooperativeId: coopObjectId,
    type: 'feed',
    timestamp_server: { $gte: startDate, $lte: endDate }
  }).lean();

  let inventorySummary = null;
  if (feedTransactions.length > 0) {
    const totalFeedQuantity = feedTransactions.reduce((sum, t) => sum + (t.quantity || 0), 0);
    const totalFeedCost = feedTransactions.reduce((sum, t) => sum + (t.cost || 0), 0);
    inventorySummary = {
      feedTransactionsCount: feedTransactions.length,
      totalFeedQuantity,
      totalFeedCost,
      averageCostPerUnit: totalFeedQuantity ? totalFeedCost / totalFeedQuantity : 0
    };
  }

  // ========== 6. TRENDS & COMPARISONS ==========
  // Daily breakdown
  const dailyPipeline = [
    {
      $match: {
        cooperativeId: coopObjectId,
        type: 'milk',
        timestamp_server: { $gte: startDate, $lte: endDate }
      }
    },
    {
      $group: {
        _id: { $dateToString: { format: '%Y-%m-%d', date: '$timestamp_server' } },
        litres: { $sum: '$litres' },
        payout: { $sum: '$payout' },
        count: { $sum: 1 }
      }
    },
    {
      $project: {
        date: '$_id',
        litres: 1,
        payout: 1,
        transactionCount: 1,
        _id: 0
      }
    },
    { $sort: { date: 1 } }
  ];
  const daily = await runAgg(dailyPipeline);

  // Previous month comparison
  let prevMonthStart, prevMonthEnd;
  if (month === 1) {
    prevMonthStart = new Date(y - 1, 11, 1);
    prevMonthEnd = new Date(y - 1, 11, 31, 23, 59, 59, 999);
  } else {
    prevMonthStart = new Date(y, m - 2, 1);
    prevMonthEnd = new Date(y, m - 1, 0, 23, 59, 59, 999);
  }
  const prevMonthAgg = await Transaction.aggregate([
    {
      $match: {
        cooperativeId: coopObjectId,
        type: 'milk',
        timestamp_server: { $gte: prevMonthStart, $lte: prevMonthEnd }
      }
    },
    {
      $group: {
        _id: null,
        totalLitres: { $sum: '$litres' },
        totalPayout: { $sum: '$payout' },
        transactionCount: { $sum: 1 }
      }
    }
  ]);
  const prevMonth = prevMonthAgg[0] || { totalLitres: 0, totalPayout: 0, transactionCount: 0 };

  const milkChangePercent = prevMonth.totalLitres
    ? ((totalLitres - prevMonth.totalLitres) / prevMonth.totalLitres) * 100
    : 0;
  const payoutChangePercent = prevMonth.totalPayout
    ? ((totalPayout - prevMonth.totalPayout) / prevMonth.totalPayout) * 100
    : 0;
  const txChangePercent = prevMonth.transactionCount
    ? ((transactionCount - prevMonth.transactionCount) / prevMonth.transactionCount) * 100
    : 0;

  // ========== 7. ASSEMBLE FINAL REPORT ==========
  const report = {
    cooperative: {
      id: cooperative._id,
      name: cooperative.name
    },
    period: {
      year: y,
      month: m,
      startDate: startDate.toISOString(),
      endDate: endDate.toISOString()
    },
    overview: {
      totalFarmers: allFarmersCount,
      activeFarmersWithDeliveries: farmersWithDeliveries,
      farmersWithoutDeliveries,
      totalTransactions: transactionCount,
      totalMilkLitres: totalLitres,
      totalPayout,
      averageLitresPerTransaction: avgLitresPerTransaction,
      averagePayoutPerTransaction: avgPayoutPerTransaction,
      averageLitresPerFarmer: avgLitresPerFarmer,
      averagePayoutPerFarmer: avgPayoutPerFarmer,
      totalPortersInvolved: uniquePortersCount,
      totalZonesCovered: zonesCount
    },
    financial: {
      totalPayout,
      totalMilkValue: totalPayout,
      averageRatePerLiter: totalLitres ? totalPayout / totalLitres : 0,
      rateBreakdown,
      weeklyBreakdown: weekly,
      zoneBreakdown,
      topPortersByPayout: topPorters
    },
    farmerPerformance: {
      topFarmersByVolume,
      bottomFarmersByVolume,
      farmersWithNoDeliveries: farmersNoDeliveries.map(f => ({ code: f.farmer_code, name: f.name })),
      farmerActivity: {
        activeFarmersCount: allFarmersCount,
        farmersWithDeliveries,
        farmersWithoutDeliveries,
        averageDeliveriesPerFarmer: farmersWithDeliveries ? transactionCount / farmersWithDeliveries : 0,
        averageLitresPerActiveFarmer: avgLitresPerFarmer,
        averagePayoutPerActiveFarmer: avgPayoutPerFarmer
      }
    },
    porterPerformance: {
      totalPorters: await Porter.countDocuments({ cooperativeId: coopObjectId, isActive: true }),
      activePorters,
      averageLitresPerPorter: avgLitresPerPorter,
      averagePayoutPerPorter: avgPayoutPerPorter,
      zoneCoverage,
      detailedPorterStats: porterStats
    },
    inventory: inventorySummary,
    trends: {
      daily,
      previousMonthComparison: {
        milkLitres: prevMonth.totalLitres,
        payout: prevMonth.totalPayout,
        transactionCount: prevMonth.transactionCount,
        milkChangePercent,
        payoutChangePercent,
        transactionChangePercent: txChangePercent   // ✅ FIXED: use txChangePercent
      }
    }
  };

  logger.info(`Monthly report generated for cooperative ${cooperative.name}, ${year}-${month}`, {
    farmers: farmersWithDeliveries,
    litres: totalLitres,
    payout: totalPayout
  });

  return report;
};

module.exports = { getMonthlyReport };