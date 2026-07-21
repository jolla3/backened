// services/reports/operationalService.js
const mongoose = require('mongoose');
const Transaction = require('../../models/transaction');
const Farmer = require('../../models/farmer');
const Cooperative = require('../../models/cooperative');
const Porter = require('../../models/porter');

/**
 * Fetch all operational data for a given month.
 * @param {number} year
 * @param {number} month (1-12)
 * @param {string} cooperativeId
 * @returns {Promise<Object>} raw operational data
 */
const fetchOperationalData = async (year, month, cooperativeId) => {
  const startDate = new Date(year, month - 1, 1);
  const endDate = new Date(year, month, 0, 23, 59, 59, 999);
  const coopId = new mongoose.Types.ObjectId(cooperativeId);

  const cooperative = await Cooperative.findById(coopId).lean();
  if (!cooperative) throw new Error('Cooperative not found');

  // ── Aggregation pipeline ──
  const pipeline = [
    {
      $match: {
        cooperativeId: coopId,
        timestamp_server: { $gte: startDate, $lte: endDate }
      }
    },
    {
      $facet: {
        // ── Milk Overview (includes operational milk value) ──
        milkOverview: [
          { $match: { type: 'milk' } },
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
            $addFields: {
              transactionMilkValue: {
                $multiply: ['$litres', { $ifNull: ['$rateInfo.rate', 0] }]
              }
            }
          },
          {
            $group: {
              _id: null,
              totalLitres: { $sum: '$litres' },
              transactionCount: { $sum: 1 },
              totalMilkValue: { $sum: '$transactionMilkValue' },
              uniqueFarmers: { $addToSet: '$farmer_id' },
              uniquePorters: { $addToSet: '$porter_id' },
              zones: { $addToSet: '$zone' }
            }
          },
          {
            $project: {
              _id: 0,
              totalLitres: 1,
              transactionCount: 1,
              totalMilkValue: 1,
              uniqueFarmersCount: { $size: '$uniqueFarmers' },
              uniquePortersCount: { $size: '$uniquePorters' },
              zonesCount: { $size: '$zones' },
              weightedAverageRate: {
                $cond: [
                  { $gt: ['$totalLitres', 0] },
                  { $divide: ['$totalMilkValue', '$totalLitres'] },
                  0
                ]
              }
            }
          }
        ],

        // ── Feed Activity (operational stats only) ──
        feedActivity: [
          { $match: { type: 'feed' } },
          {
            $group: {
              _id: '$paymentMethod',
              totalQuantity: { $sum: '$quantity' },
              transactionCount: { $sum: 1 }
            }
          },
          {
            $group: {
              _id: null,
              cashQuantity: { $sum: { $cond: [{ $eq: ['$_id', 'cash'] }, '$totalQuantity', 0] } },
              balanceQuantity: { $sum: { $cond: [{ $eq: ['$_id', 'balance'] }, '$totalQuantity', 0] } },
              cashTransactions: { $sum: { $cond: [{ $eq: ['$_id', 'cash'] }, '$transactionCount', 0] } },
              balanceTransactions: { $sum: { $cond: [{ $eq: ['$_id', 'balance'] }, '$transactionCount', 0] } },
              totalQuantity: { $sum: '$totalQuantity' },
              totalTransactions: { $sum: '$transactionCount' }
            }
          }
        ],

        // ── Weekly Trend (enriched) ──
        weekly: [
          { $match: { type: 'milk' } },
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
            $addFields: {
              transactionMilkValue: {
                $multiply: ['$litres', { $ifNull: ['$rateInfo.rate', 0] }]
              }
            }
          },
          {
            $group: {
              _id: {
                year: { $year: '$timestamp_server' },
                week: { $week: '$timestamp_server' }
              },
              totalLitres: { $sum: '$litres' },
              transactionCount: { $sum: 1 },
              uniqueFarmers: { $addToSet: '$farmer_id' },
              totalMilkValue: { $sum: '$transactionMilkValue' }
            }
          },
          {
            $project: {
              year: '$_id.year',
              week: '$_id.week',
              totalLitres: 1,
              transactionCount: 1,
              activeFarmers: { $size: '$uniqueFarmers' },
              totalMilkValue: 1,
              averageRate: {
                $cond: [
                  { $gt: ['$totalLitres', 0] },
                  { $divide: ['$totalMilkValue', '$totalLitres'] },
                  0
                ]
              }
            }
          },
          { $sort: { year: 1, week: 1 } }
        ],

        // ── Zone Breakdown (enriched) ──
        zoneBreakdown: [
          { $match: { type: 'milk' } },
          {
            $group: {
              _id: { $ifNull: ['$zone', 'Unassigned'] },
              totalLitres: { $sum: '$litres' },
              transactionCount: { $sum: 1 },
              uniqueFarmers: { $addToSet: '$farmer_id' },
              uniquePorters: { $addToSet: '$porter_id' }
            }
          },
          {
            $project: {
              zone: '$_id',
              totalLitres: 1,
              transactionCount: 1,
              farmers: { $size: '$uniqueFarmers' },
              porters: { $size: '$uniquePorters' },
              averageLitresPerFarmer: {
                $cond: [
                  { $gt: [{ $size: '$uniqueFarmers' }, 0] },
                  { $divide: ['$totalLitres', { $size: '$uniqueFarmers' }] },
                  0
                ]
              },
              averageLitresPerCollection: {
                $cond: [
                  { $gt: ['$transactionCount', 0] },
                  { $divide: ['$totalLitres', '$transactionCount'] },
                  0
                ]
              }
            }
          },
          { $sort: { totalLitres: -1 } }
        ],

        // ── Rate Breakdown (unchanged – already good) ──
        rateBreakdown: [
          { $match: { type: 'milk' } },
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
              _id: { rate: '$rateInfo.rate' },
              transactionCount: { $sum: 1 },
              totalLitres: { $sum: '$litres' },
              totalMilkValue: {
                $sum: {
                  $multiply: ['$litres', { $ifNull: ['$rateInfo.rate', 0] }]
                }
              }
            }
          },
          {
            $project: {
              rate: '$_id.rate',
              transactionCount: 1,
              totalLitres: 1,
              totalMilkValue: 1,
              _id: 0
            }
          },
          { $sort: { transactionCount: -1 } }
        ],

        // ── Daily (unchanged) ──
        daily: [
          { $match: { type: 'milk' } },
          {
            $group: {
              _id: { $dateToString: { format: '%Y-%m-%d', date: '$timestamp_server' } },
              litres: { $sum: '$litres' },
              count: { $sum: 1 }
            }
          },
          {
            $project: {
              date: '$_id',
              litres: 1,
              transactionCount: '$count',
              _id: 0
            }
          },
          { $sort: { date: 1 } }
        ],

        // ── Porter Performance (new enriched) ──
        porterPerformance: [
          { $match: { type: 'milk' } },
          {
            $group: {
              _id: '$porter_id',
              totalLitres: { $sum: '$litres' },
              transactionCount: { $sum: 1 },
              uniqueFarmers: { $addToSet: '$farmer_id' },
              zones: { $addToSet: '$zone' },
              days: { $addToSet: { $dateToString: { format: '%Y-%m-%d', date: '$timestamp_server' } } }
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
              porterName: { $ifNull: ['$porterInfo.name', 'Unknown'] },
              totalLitres: 1,
              transactionCount: 1,
              uniqueFarmersCount: { $size: '$uniqueFarmers' },
              zonesCovered: { $size: '$zones' },
              activeDays: { $size: '$days' },
              averageLitresPerCollection: {
                $cond: [{ $gt: ['$transactionCount', 0] }, { $divide: ['$totalLitres', '$transactionCount'] }, 0]
              },
              averageLitresPerDay: {
                $cond: [{ $gt: [{ $size: '$days' }, 0] }, { $divide: ['$totalLitres', { $size: '$days' }] }, 0]
              }
            }
          },
          { $sort: { totalLitres: -1 } }
        ],

        // ── Top Farmers (enriched with active days and avg per delivery) ──
        topFarmers: [
          { $match: { type: 'milk' } },
          {
            $group: {
              _id: '$farmer_id',
              totalLitres: { $sum: '$litres' },
              transactionCount: { $sum: 1 },
              days: { $addToSet: { $dateToString: { format: '%Y-%m-%d', date: '$timestamp_server' } } }
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
              farmerName: { $ifNull: ['$farmerInfo.name', 'Unknown'] },
              farmerCode: { $ifNull: ['$farmerInfo.farmer_code', ''] },
              totalLitres: 1,
              transactionCount: 1,
              activeDays: { $size: '$days' },
              averageLitresPerDelivery: {
                $cond: [{ $gt: ['$transactionCount', 0] }, { $divide: ['$totalLitres', '$transactionCount'] }, 0]
              }
            }
          },
          { $sort: { totalLitres: -1 } },
          { $limit: 10 }
        ],

        // ── Bottom Farmers ──
        bottomFarmers: [
          { $match: { type: 'milk' } },
          {
            $group: {
              _id: '$farmer_id',
              totalLitres: { $sum: '$litres' },
              transactionCount: { $sum: 1 },
              days: { $addToSet: { $dateToString: { format: '%Y-%m-%d', date: '$timestamp_server' } } }
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
              farmerName: { $ifNull: ['$farmerInfo.name', 'Unknown'] },
              farmerCode: { $ifNull: ['$farmerInfo.farmer_code', ''] },
              totalLitres: 1,
              transactionCount: 1,
              activeDays: { $size: '$days' },
              averageLitresPerDelivery: {
                $cond: [{ $gt: ['$transactionCount', 0] }, { $divide: ['$totalLitres', '$transactionCount'] }, 0]
              }
            }
          },
          { $sort: { totalLitres: 1 } },
          { $limit: 10 }
        ],

        // ── Product Breakdown (operational quantities) ──
        productBreakdown: [
          { $match: { type: 'feed' } },
          {
            $lookup: {
              from: 'inventories',
              localField: 'product_id',
              foreignField: '_id',
              as: 'productInfo'
            }
          },
          { $unwind: { path: '$productInfo', preserveNullAndEmptyArrays: true } },
          {
            $group: {
              _id: '$product_id',
              productName: { $first: '$productInfo.name' },
              totalQuantity: { $sum: '$quantity' },
              transactionCount: { $sum: 1 }
            }
          },
          {
            $project: {
              productName: { $ifNull: ['$productName', 'Unknown Product'] },
              totalQuantity: 1,
              transactionCount: 1,
              _id: 0
            }
          },
          { $sort: { totalQuantity: -1 } }
        ]
      }
    }
  ];

  const result = await Transaction.aggregate(pipeline);
  const data = result[0] || {};

  // Extract facets
  const milkOverview = data.milkOverview?.[0] || {};
  const feedActivity = data.feedActivity?.[0] || {};
  const weekly = data.weekly || [];
  const zoneBreakdown = data.zoneBreakdown || [];
  const rateBreakdown = data.rateBreakdown || [];
  const daily = data.daily || [];
  const porterPerformance = data.porterPerformance || [];
  const topFarmers = data.topFarmers || [];
  const bottomFarmers = data.bottomFarmers || [];
  const productBreakdown = data.productBreakdown || [];

  // Additional counts from models
  const allFarmersCount = await Farmer.countDocuments({ cooperativeId: coopId, isActive: true });
  const farmersWithDeliveriesIds = await Transaction.distinct('farmer_id', {
    cooperativeId: coopId,
    type: 'milk',
    timestamp_server: { $gte: startDate, $lte: endDate }
  });
  const farmersNoDeliveries = await Farmer.find({
    cooperativeId: coopId,
    isActive: true,
    _id: { $nin: farmersWithDeliveriesIds }
  }).select('farmer_code name phone').limit(20).lean();

  const totalPorters = await Porter.countDocuments({ cooperativeId: coopId, isActive: true });

  // Compute weekly growth
  const weeklyWithGrowth = weekly.map((w, idx, arr) => {
    const prev = idx > 0 ? arr[idx - 1] : null;
    const growth = prev && prev.totalLitres > 0
      ? ((w.totalLitres - prev.totalLitres) / prev.totalLitres) * 100
      : null;
    return { ...w, growthPercentage: growth !== null ? parseFloat(growth.toFixed(1)) : null };
  });

  return {
    cooperative,
    period: { start: startDate, end: endDate },
    milkOverview,
    feedActivity,
    weekly: weeklyWithGrowth,
    zoneBreakdown,
    rateBreakdown,
    daily,
    porterPerformance,
    topFarmers,
    bottomFarmers,
    productBreakdown,
    allFarmersCount,
    farmersWithDeliveries: farmersWithDeliveriesIds.length,
    farmersNoDeliveries,
    totalPorters
  };
};

/**
 * Build the operational summary object from raw data.
 */
const buildOperational = (data) => {
  const {
    milkOverview,
    feedActivity,
    weekly,
    zoneBreakdown,
    rateBreakdown,
    daily,
    porterPerformance,
    topFarmers,
    bottomFarmers,
    productBreakdown,
    allFarmersCount,
    farmersWithDeliveries,
    farmersNoDeliveries,
    totalPorters
  } = data;

  const totalMilkLitres = milkOverview.totalLitres || 0;
  const totalMilkValue = milkOverview.totalMilkValue || 0;
  const totalMilkTransactions = milkOverview.transactionCount || 0;
  const weightedAverageRate = milkOverview.weightedAverageRate || 0;
  const uniqueFarmersCount = milkOverview.uniqueFarmersCount || 0;
  const uniquePortersCount = milkOverview.uniquePortersCount || 0;
  const zonesCount = milkOverview.zonesCount || 0;

  const avgLitresPerTransaction = totalMilkTransactions ? totalMilkLitres / totalMilkTransactions : 0;
  const avgLitresPerFarmer = uniqueFarmersCount ? totalMilkLitres / uniqueFarmersCount : 0;

  // Porter aggregate stats
  const activePorters = porterPerformance.length;
  const totalPorterLitres = porterPerformance.reduce((sum, p) => sum + p.totalLitres, 0);
  const avgLitresPerPorter = activePorters ? totalPorterLitres / activePorters : 0;

  return {
    overview: {
      totalFarmers: allFarmersCount,
      activeFarmersWithDeliveries: farmersWithDeliveries,
      farmersWithoutDeliveries: allFarmersCount - farmersWithDeliveries,
      totalMilkTransactions,
      totalMilkLitres,
      totalMilkValue,               // operational milk value (for reference)
      weightedAverageRate,
      averageLitresPerTransaction: avgLitresPerTransaction,
      averageLitresPerFarmer: avgLitresPerFarmer,
      totalPortersInvolved: uniquePortersCount,
      zonesCount
    },
    feedActivity: {
      totalQuantity: feedActivity.totalQuantity || 0,
      cashQuantity: feedActivity.cashQuantity || 0,
      balanceQuantity: feedActivity.balanceQuantity || 0,
      transactionCount: feedActivity.totalTransactions || 0,
      cashTransactions: feedActivity.cashTransactions || 0,
      balanceTransactions: feedActivity.balanceTransactions || 0
    },
    farmerPerformance: {
      topFarmers: topFarmers.map(f => ({
        farmerName: f.farmerName || 'Unknown',
        farmerCode: f.farmerCode || '',
        totalLitres: f.totalLitres || 0,
        transactionCount: f.transactionCount || 0,
        activeDays: f.activeDays || 0,
        averageLitresPerDelivery: parseFloat((f.averageLitresPerDelivery || 0).toFixed(2))
      })),
      bottomFarmers: bottomFarmers.map(f => ({
        farmerName: f.farmerName || 'Unknown',
        farmerCode: f.farmerCode || '',
        totalLitres: f.totalLitres || 0,
        transactionCount: f.transactionCount || 0,
        activeDays: f.activeDays || 0,
        averageLitresPerDelivery: parseFloat((f.averageLitresPerDelivery || 0).toFixed(2))
      })),
      farmersWithNoDeliveries: farmersNoDeliveries.map(f => ({
        name: f.name,
        code: f.farmer_code
      })),
      farmerActivity: {
        activeFarmersCount: allFarmersCount,
        farmersWithDeliveries,
        farmersWithoutDeliveries: allFarmersCount - farmersWithDeliveries,
        averageDeliveriesPerFarmer: farmersWithDeliveries ? totalMilkTransactions / farmersWithDeliveries : 0,
        averageLitresPerActiveFarmer: avgLitresPerFarmer
      }
    },
    porterPerformance: {
      totalPorters,
      activePorters,
      averageLitresPerPorter: parseFloat(avgLitresPerPorter.toFixed(2)),
      averageLitresPerCollection: totalMilkTransactions ? parseFloat((totalMilkLitres / totalMilkTransactions).toFixed(2)) : 0,
      porters: porterPerformance.map(p => ({
        porterName: p.porterName,
        totalLitres: p.totalLitres,
        transactionCount: p.transactionCount,
        farmersServed: p.uniqueFarmersCount,
        zonesCovered: p.zonesCovered,
        activeDays: p.activeDays,
        averageLitresPerCollection: parseFloat(p.averageLitresPerCollection.toFixed(2)),
        averageLitresPerDay: parseFloat(p.averageLitresPerDay.toFixed(2))
      }))
    },
    inventory: {
      feedTransactionsCount: feedActivity.totalTransactions || 0,
      totalFeedQuantity: feedActivity.totalQuantity || 0,
      productBreakdown: productBreakdown.map(p => ({
        productName: p.productName || 'Unknown',
        totalQuantity: p.totalQuantity || 0,
        transactionCount: p.transactionCount || 0
      }))
    },
    trends: {
      daily: daily.map(d => ({
        date: d.date,
        litres: d.litres || 0,
        transactionCount: d.transactionCount || 0
      })),
      weekly: weekly.map(w => ({
        year: w.year,
        week: w.week,
        totalLitres: w.totalLitres || 0,
        transactionCount: w.transactionCount || 0,
        activeFarmers: w.activeFarmers || 0,
        averageRate: parseFloat((w.averageRate || 0).toFixed(2)),
        growthPercentage: w.growthPercentage !== null ? parseFloat(w.growthPercentage.toFixed(1)) : null
      })),
      rateBreakdown: rateBreakdown.map(r => ({
        rate: r.rate || 0,
        transactionCount: r.transactionCount || 0,
        totalLitres: r.totalLitres || 0,
        totalMilkValue: r.totalMilkValue || 0
      }))
    }
  };
};

module.exports = { fetchOperationalData, buildOperational };