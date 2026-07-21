// const mongoose = require('mongoose');
// const Transaction = require('../models/transaction');
// const Farmer = require('../models/farmer');
// const Porter = require('../models/porter');
// const Cooperative = require('../models/cooperative');
// const RateVersion = require('../models/rateVersion');
// const Inventory = require('../models/inventory');
// const Ledger = require('../models/ledger');
// const Settlement = require('../models/settlement');
// const logger = require('../utils/logger');

// /**
//  * Generate a comprehensive monthly report for a cooperative.
//  * @param {number} year - 4-digit year
//  * @param {number} month - 1-12
//  * @param {string} cooperativeId - ObjectId
//  * @param {Object} options - optional extras (e.g., includeForecast)
//  * @returns {Object} detailed report with graph-ready datasets
//  */
// const getMonthlyReport = async (year, month, cooperativeId, options = {}) => {
//   const includeForecast = options.includeForecast !== false;
//   const logContext = { year, month, cooperativeId };

//   try {
//     const cooperative = await Cooperative.findById(cooperativeId).lean();
//     if (!cooperative) {
//       logger.warn('Cooperative not found', logContext);
//       throw new Error('Cooperative not found');
//     }

//     const y = parseInt(year);
//     const m = parseInt(month);
//     if (isNaN(y) || isNaN(m) || m < 1 || m > 12) {
//       logger.warn('Invalid year or month', { year, month, ...logContext });
//       throw new Error('Invalid year or month');
//     }

//     const startDate = new Date(y, m - 1, 1);
//     const endDate = new Date(y, m, 0, 23, 59, 59, 999);
//     const coopObjectId = new mongoose.Types.ObjectId(cooperativeId);

//     // ───── Helper ──────────────────────────────────────────────
//     const runAgg = async (pipeline, name = 'unnamed') => {
//       try {
//         return await Transaction.aggregate(pipeline);
//       } catch (error) {
//         logger.error(`Aggregation failed: ${name}`, {
//           error: error.message,
//           pipeline: JSON.stringify(pipeline).slice(0, 500),
//           ...logContext
//         });
//         throw error;
//       }
//     };

//     // ───── 1. OPERATIONAL DATA ──────────────────────────────────
//     const baseMatch = {
//       $match: {
//         cooperativeId: coopObjectId,
//         timestamp_server: { $gte: startDate, $lte: endDate }
//       }
//     };

//     const facetPipeline = [
//       baseMatch,
//       {
//         $facet: {
//           overview: [
//             { $match: { type: 'milk' } },
//             {
//               $group: {
//                 _id: null,
//                 totalLitres: { $sum: '$litres' },
//                 totalPayout: { $sum: '$payout' },
//                 transactionCount: { $sum: 1 },
//                 uniqueFarmers: { $addToSet: '$farmer_id' },
//                 uniquePorters: { $addToSet: '$porter_id' },
//                 zones: { $addToSet: '$zone' }
//               }
//             },
//             {
//               $project: {
//                 _id: 0,
//                 totalLitres: 1,
//                 totalPayout: 1,
//                 transactionCount: 1,
//                 uniqueFarmersCount: { $size: '$uniqueFarmers' },
//                 uniquePortersCount: { $size: '$uniquePorters' },
//                 zonesCount: { $size: '$zones' }
//               }
//             }
//           ],
//           feedRevenue: [
//             { $match: { type: 'feed' } },
//             {
//               $group: {
//                 _id: '$paymentMethod',
//                 totalRevenue: { $sum: '$cost' },
//                 totalQuantity: { $sum: '$quantity' },
//                 transactionCount: { $sum: 1 }
//               }
//             },
//             {
//               $group: {
//                 _id: null,
//                 cashRevenue: { $sum: { $cond: [{ $eq: ['$_id', 'cash'] }, '$totalRevenue', 0] } },
//                 balanceRevenue: { $sum: { $cond: [{ $eq: ['$_id', 'balance'] }, '$totalRevenue', 0] } },
//                 cashQuantity: { $sum: { $cond: [{ $eq: ['$_id', 'cash'] }, '$totalQuantity', 0] } },
//                 balanceQuantity: { $sum: { $cond: [{ $eq: ['$_id', 'balance'] }, '$totalQuantity', 0] } },
//                 cashTransactions: { $sum: { $cond: [{ $eq: ['$_id', 'cash'] }, '$transactionCount', 0] } },
//                 balanceTransactions: { $sum: { $cond: [{ $eq: ['$_id', 'balance'] }, '$transactionCount', 0] } },
//                 totalRevenue: { $sum: '$totalRevenue' },
//                 totalQuantity: { $sum: '$totalQuantity' },
//                 totalTransactions: { $sum: '$transactionCount' }
//               }
//             }
//           ],
//           weekly: [
//             { $match: { type: 'milk' } },
//             {
//               $group: {
//                 _id: { week: { $week: '$timestamp_server' } },
//                 totalPayout: { $sum: '$payout' },
//                 totalLitres: { $sum: '$litres' },
//                 transactionCount: { $sum: 1 }
//               }
//             },
//             {
//               $project: { week: '$_id.week', totalPayout: 1, totalLitres: 1, transactionCount: 1, _id: 0 }
//             },
//             { $sort: { week: 1 } }
//           ],
//           zoneBreakdown: [
//             { $match: { type: 'milk' } },
//             {
//               $group: {
//                 _id: '$zone',
//                 totalPayout: { $sum: '$payout' },
//                 totalLitres: { $sum: '$litres' },
//                 transactionCount: { $sum: 1 }
//               }
//             },
//             {
//               $project: { zone: '$_id', totalPayout: 1, totalLitres: 1, transactionCount: 1, _id: 0 }
//             },
//             { $sort: { totalPayout: -1 } }
//           ],
//           rateBreakdown: [
//             { $match: { type: 'milk' } },
//             {
//               $lookup: {
//                 from: 'rateversions',
//                 localField: 'rate_version_id',
//                 foreignField: '_id',
//                 as: 'rateInfo'
//               }
//             },
//             { $unwind: { path: '$rateInfo', preserveNullAndEmptyArrays: true } },
//             {
//               $group: {
//                 _id: { rate: '$rateInfo.rate', effective_date: '$rateInfo.effective_date' },
//                 transactionCount: { $sum: 1 },
//                 totalLitres: { $sum: '$litres' },
//                 totalPayout: { $sum: '$payout' }
//               }
//             },
//             {
//               $project: {
//                 rate: '$_id.rate',
//                 effectiveDate: '$_id.effective_date',
//                 transactionCount: 1,
//                 totalLitres: 1,
//                 totalPayout: 1,
//                 _id: 0
//               }
//             },
//             { $sort: { transactionCount: -1 } }
//           ],
//           daily: [
//             { $match: { type: 'milk' } },
//             {
//               $group: {
//                 _id: { $dateToString: { format: '%Y-%m-%d', date: '$timestamp_server' } },
//                 litres: { $sum: '$litres' },
//                 payout: { $sum: '$payout' },
//                 count: { $sum: 1 }
//               }
//             },
//             {
//               $project: {
//                 date: '$_id',
//                 litres: 1,
//                 payout: 1,
//                 transactionCount: '$count',
//                 _id: 0
//               }
//             },
//             { $sort: { date: 1 } }
//           ],
//           topPorters: [
//             { $match: { type: 'milk' } },
//             {
//               $group: {
//                 _id: '$porter_id',
//                 totalPayout: { $sum: '$payout' },
//                 totalLitres: { $sum: '$litres' },
//                 transactionCount: { $sum: 1 }
//               }
//             },
//             {
//               $lookup: {
//                 from: 'porters',
//                 localField: '_id',
//                 foreignField: '_id',
//                 as: 'porterInfo'
//               }
//             },
//             { $unwind: { path: '$porterInfo', preserveNullAndEmptyArrays: true } },
//             {
//               $project: {
//                 porterId: '$_id',
//                 porterName: { $ifNull: ['$porterInfo.name', 'Unknown'] },
//                 totalPayout: 1,
//                 totalLitres: 1,
//                 transactionCount: 1,
//                 _id: 0
//               }
//             },
//             { $sort: { totalPayout: -1 } },
//             { $limit: 10 }
//           ],
//           topFarmers: [
//             { $match: { type: 'milk' } },
//             {
//               $group: {
//                 _id: '$farmer_id',
//                 totalLitres: { $sum: '$litres' },
//                 totalPayout: { $sum: '$payout' },
//                 transactionCount: { $sum: 1 }
//               }
//             },
//             {
//               $lookup: {
//                 from: 'farmers',
//                 localField: '_id',
//                 foreignField: '_id',
//                 as: 'farmerInfo'
//               }
//             },
//             { $unwind: { path: '$farmerInfo', preserveNullAndEmptyArrays: true } },
//             {
//               $project: {
//                 farmerId: '$_id',
//                 farmerCode: '$farmerInfo.farmer_code',
//                 farmerName: '$farmerInfo.name',
//                 totalLitres: 1,
//                 totalPayout: 1,
//                 transactionCount: 1,
//                 _id: 0
//               }
//             },
//             { $sort: { totalLitres: -1 } },
//             { $limit: 10 }
//           ],
//           bottomFarmers: [
//             { $match: { type: 'milk' } },
//             {
//               $group: {
//                 _id: '$farmer_id',
//                 totalLitres: { $sum: '$litres' },
//                 totalPayout: { $sum: '$payout' },
//                 transactionCount: { $sum: 1 }
//               }
//             },
//             {
//               $lookup: {
//                 from: 'farmers',
//                 localField: '_id',
//                 foreignField: '_id',
//                 as: 'farmerInfo'
//               }
//             },
//             { $unwind: { path: '$farmerInfo', preserveNullAndEmptyArrays: true } },
//             {
//               $project: {
//                 farmerId: '$_id',
//                 farmerCode: '$farmerInfo.farmer_code',
//                 farmerName: '$farmerInfo.name',
//                 totalLitres: 1,
//                 totalPayout: 1,
//                 transactionCount: 1,
//                 _id: 0
//               }
//             },
//             { $sort: { totalLitres: 1 } },
//             { $limit: 10 }
//           ],
//           productBreakdown: [
//             { $match: { type: 'feed' } },
//             {
//               $lookup: {
//                 from: 'inventories',
//                 localField: 'product_id',
//                 foreignField: '_id',
//                 as: 'productInfo'
//               }
//             },
//             { $unwind: { path: '$productInfo', preserveNullAndEmptyArrays: true } },
//             {
//               $group: {
//                 _id: '$product_id',
//                 productName: { $first: '$productInfo.name' },
//                 totalQuantity: { $sum: '$quantity' },
//                 totalCost: { $sum: '$cost' },
//                 transactionCount: { $sum: 1 },
//                 cashRevenue: { $sum: { $cond: [{ $eq: ['$paymentMethod', 'cash'] }, '$cost', 0] } },
//                 balanceRevenue: { $sum: { $cond: [{ $eq: ['$paymentMethod', 'balance'] }, '$cost', 0] } }
//               }
//             },
//             {
//               $project: {
//                 productName: { $ifNull: ['$productName', 'Unknown Product'] },
//                 totalQuantity: 1,
//                 totalCost: 1,
//                 transactionCount: 1,
//                 cashRevenue: 1,
//                 balanceRevenue: 1,
//                 _id: 0
//               }
//             },
//             { $sort: { totalCost: -1 } }
//           ]
//         }
//       }
//     ];

//     const facetResults = await runAgg(facetPipeline, 'monthly_report_facet');
//     const result = facetResults[0] || {};

//     const overviewData = result.overview?.[0] || {};
//     const feedRevenueData = result.feedRevenue?.[0] || {};
//     const weekly = result.weekly || [];
//     const zoneBreakdown = result.zoneBreakdown || [];
//     const rateBreakdown = result.rateBreakdown || [];
//     const daily = result.daily || [];
//     const topPorters = result.topPorters || [];
//     const topFarmers = result.topFarmers || [];
//     const bottomFarmers = result.bottomFarmers || [];
//     const productBreakdown = result.productBreakdown || [];

//     const totalMilkLitres = overviewData.totalLitres || 0;
//     const totalMilkPayout = overviewData.totalPayout || 0;
//     const totalMilkTransactions = overviewData.transactionCount || 0;
//     const uniqueFarmersCount = overviewData.uniqueFarmersCount || 0;
//     const uniquePortersCount = overviewData.uniquePortersCount || 0;
//     const zonesCount = overviewData.zonesCount || 0;

//     const feedRevenueCash = feedRevenueData.cashRevenue || 0;
//     const feedRevenueBalance = feedRevenueData.balanceRevenue || 0;
//     const feedQuantityCash = feedRevenueData.cashQuantity || 0;
//     const feedQuantityBalance = feedRevenueData.balanceQuantity || 0;
//     const feedTxCash = feedRevenueData.cashTransactions || 0;
//     const feedTxBalance = feedRevenueData.balanceTransactions || 0;
//     const totalFeedRevenue = feedRevenueData.totalRevenue || 0;
//     const totalFeedQuantity = feedRevenueData.totalQuantity || 0;
//     const totalFeedTransactions = feedRevenueData.totalTransactions || 0;

//     const allFarmersCount = await Farmer.countDocuments({ cooperativeId: coopObjectId, isActive: true });
//     const farmersWithDeliveries = uniqueFarmersCount;
//     const farmersWithoutDeliveries = allFarmersCount - farmersWithDeliveries;

//     const avgLitresPerTransaction = totalMilkTransactions ? totalMilkLitres / totalMilkTransactions : 0;
//     const avgPayoutPerTransaction = totalMilkTransactions ? totalMilkPayout / totalMilkTransactions : 0;
//     const avgLitresPerFarmer = uniqueFarmersCount ? totalMilkLitres / uniqueFarmersCount : 0;
//     const avgPayoutPerFarmer = uniqueFarmersCount ? totalMilkPayout / uniqueFarmersCount : 0;

//     // Farmers with no deliveries
//     const farmersWithDeliveriesIds = await Farmer.distinct('_id', {
//       cooperativeId: coopObjectId,
//       _id: { $in: (await Transaction.distinct('farmer_id', { cooperativeId: coopObjectId, type: 'milk', timestamp_server: { $gte: startDate, $lte: endDate } })) }
//     });
//     const farmersNoDeliveries = await Farmer.find({
//       cooperativeId: coopObjectId,
//       isActive: true,
//       _id: { $nin: farmersWithDeliveriesIds }
//     })
//       .select('farmer_code name phone branch_id')
//       .limit(20)
//       .lean();

//     // ───── 2. FINANCIAL DATA ──────────────────────────────────────
//     const ledgerSummary = await Ledger.aggregate([
//       {
//         $match: {
//           cooperativeId: coopObjectId,
//           timestamp: { $gte: startDate, $lte: endDate }
//         }
//       },
//       {
//         $group: {
//           _id: null,
//           totalCredits: { $sum: { $cond: [{ $gt: ['$amount', 0] }, '$amount', 0] } },
//           totalDebits: { $sum: { $cond: [{ $lt: ['$amount', 0] }, { $abs: '$amount' }, 0] } },
//           milkCredits: { $sum: { $cond: [{ $eq: ['$type', 'MILK_CREDIT'] }, '$amount', 0] } },
//           feedDebits: { $sum: { $cond: [{ $eq: ['$type', 'FEED_DEBIT'] }, { $abs: '$amount' }, 0] } },
//           settlementDebits: { $sum: { $cond: [{ $eq: ['$type', 'SETTLEMENT_DEBIT'] }, { $abs: '$amount' }, 0] } },
//           bonuses: { $sum: { $cond: [{ $eq: ['$type', 'BONUS'] }, '$amount', 0] } },
//           penalties: { $sum: { $cond: [{ $eq: ['$type', 'PENALTY'] }, { $abs: '$amount' }, 0] } },
//           loans: { $sum: { $cond: [{ $eq: ['$type', 'LOAN'] }, { $abs: '$amount' }, 0] } },
//           interest: { $sum: { $cond: [{ $eq: ['$type', 'INTEREST'] }, { $abs: '$amount' }, 0] } },
//           manualAdjustments: { $sum: { $cond: [{ $eq: ['$type', 'MANUAL_ADJUSTMENT'] }, { $abs: '$amount' }, 0] } },
//           transactionCount: { $sum: 1 }
//         }
//       }
//     ]);

//     const ledger = ledgerSummary[0] || {
//       totalCredits: 0,
//       totalDebits: 0,
//       milkCredits: 0,
//       feedDebits: 0,
//       settlementDebits: 0,
//       bonuses: 0,
//       penalties: 0,
//       loans: 0,
//       interest: 0,
//       manualAdjustments: 0,
//       transactionCount: 0
//     };

//     const grossMilkEarnings = ledger.milkCredits;
//     const feedDeductions = ledger.feedDebits;
//     const netLedgerPosition = ledger.totalCredits - ledger.totalDebits;

//     // ───── 3. SETTLEMENT DATA ──────────────────────────────────────
//     const settlements = await Settlement.find({
//       cooperativeId: coopObjectId,
//       periodStart: { $gte: startDate, $lte: endDate }
//     }).lean();

//     const settlementSummary = {
//       totalCount: settlements.length,
//       pendingCount: settlements.filter(s => s.status === 'pending').length,
//       paidCount: settlements.filter(s => s.status === 'paid').length,
//       cancelledCount: settlements.filter(s => s.status === 'cancelled').length,
//       totalGross: settlements.reduce((sum, s) => sum + s.grossMilkEarnings, 0),
//       totalFeedDeductions: settlements.reduce((sum, s) => sum + s.feedDeductions, 0),
//       totalOtherDeductions: settlements.reduce((sum, s) => sum + s.otherDeductions, 0),
//       totalBonuses: settlements.reduce((sum, s) => sum + s.bonuses, 0),
//       totalNetPayable: settlements.reduce((sum, s) => sum + s.netPayable, 0),
//       totalPaid: settlements.reduce((sum, s) => sum + s.amountPaid, 0),
//       totalPendingAmount: settlements
//         .filter(s => s.status === 'pending')
//         .reduce((sum, s) => sum + (s.netPayable - s.amountPaid), 0)
//     };

//     // ───── 4. OUTSTANDING LIABILITY ──────────────────────────────────
//     const farmerBalances = await Farmer.aggregate([
//       { $match: { cooperativeId: coopObjectId, isActive: true } },
//       {
//         $group: {
//           _id: null,
//           totalPositive: { $sum: { $cond: [{ $gt: ['$balance', 0] }, '$balance', 0] } },
//           totalNegative: { $sum: { $cond: [{ $lt: ['$balance', 0] }, '$balance', 0] } },
//           countPositive: { $sum: { $cond: [{ $gt: ['$balance', 0] }, 1, 0] } },
//           countNegative: { $sum: { $cond: [{ $lt: ['$balance', 0] }, 1, 0] } },
//           countZero: { $sum: { $cond: [{ $eq: ['$balance', 0] }, 1, 0] } }
//         }
//       }
//     ]);

//     const outstanding = farmerBalances[0] || {
//       totalPositive: 0,
//       totalNegative: 0,
//       countPositive: 0,
//       countNegative: 0,
//       countZero: 0
//     };

//     // ───── 5. AUDIT & EXCEPTIONS ──────────────────────────────────
//     const [txCount, ledgerCount, settlementCount, farmerCount] = await Promise.all([
//       Transaction.countDocuments({ cooperativeId: coopObjectId, timestamp_server: { $gte: startDate, $lte: endDate } }),
//       Ledger.countDocuments({ cooperativeId: coopObjectId, timestamp: { $gte: startDate, $lte: endDate } }),
//       Settlement.countDocuments({ cooperativeId: coopObjectId, periodStart: { $gte: startDate, $lte: endDate } }),
//       Farmer.countDocuments({ cooperativeId: coopObjectId, isActive: true })
//     ]);

//     const exceptions = [];

//     const debtorsWithoutSettlement = await Farmer.find({
//       cooperativeId: coopObjectId,
//       balance: { $lt: 0 },
//       _id: { $nin: settlements.map(s => s.farmerId) }
//     }).limit(5).select('name farmer_code balance').lean();

//     if (debtorsWithoutSettlement.length) {
//       exceptions.push({
//         type: 'debtors_without_settlement',
//         count: debtorsWithoutSettlement.length,
//         details: debtorsWithoutSettlement.map(f => `${f.name} (${f.farmer_code}): ${f.balance}`)
//       });
//     }

//     const orphanLedger = await Ledger.countDocuments({
//       cooperativeId: coopObjectId,
//       transactionId: { $exists: true, $eq: null }
//     });
//     if (orphanLedger > 0) {
//       exceptions.push({
//         type: 'ledger_orphans',
//         count: orphanLedger,
//         details: 'Ledger entries without transaction reference'
//       });
//     }

//     // ───── 6. DERIVED ANALYTICS ──────────────────────────────────────

//     // 6a. Calendar Heatmap (with metadata)
//     const calendarHeatmap = {
//       title: 'Milk Collection Calendar',
//       type: 'heatmap',
//       xAxis: 'Date',
//       yAxis: 'Milk (L)',
//       data: daily.map(d => ({ date: d.date, litres: d.litres, payout: d.payout, transactions: d.transactionCount }))
//     };

//     // 6b. Milk vs Feed (with metadata)
//     const feedDaily = await Transaction.aggregate([
//       {
//         $match: {
//           type: 'feed',
//           cooperativeId: coopObjectId,
//           timestamp_server: { $gte: startDate, $lte: endDate }
//         }
//       },
//       {
//         $group: {
//           _id: { $dateToString: { format: '%Y-%m-%d', date: '$timestamp_server' } },
//           revenue: { $sum: '$cost' },
//           quantity: { $sum: '$quantity' }
//         }
//       },
//       { $sort: { _id: 1 } }
//     ]);

//     const feedDailyMap = {};
//     for (const f of feedDaily) feedDailyMap[f._id] = f.revenue;

//     const milkVsFeedData = daily.map(day => ({
//       date: day.date,
//       milkPayout: day.payout,
//       feedRevenue: feedDailyMap[day.date] || 0
//     }));

//     const milkVsFeed = {
//       title: 'Milk Payout vs Feed Revenue (Daily)',
//       type: 'line',
//       xAxis: 'Date',
//       yAxis: 'KES',
//       data: milkVsFeedData
//     };

//     // 6c. Cumulative Cash Flow (metadata)
//     let cumulative = 0;
//     const cumulativeData = daily.map(day => {
//       const netDaily = (feedDailyMap[day.date] || 0) - day.payout;
//       cumulative += netDaily;
//       return { date: day.date, cumulativeCashFlow: Math.round(cumulative) };
//     });

//     const cumulativeCashFlow = {
//       title: 'Cumulative Cash Flow',
//       type: 'area',
//       xAxis: 'Date',
//       yAxis: 'KES',
//       data: cumulativeData
//     };

//     // 6d. Payment Methods (metadata)
//     const totalPayments = feedRevenueCash + feedRevenueBalance;
//     const paymentMethods = {
//       title: 'Payment Method Distribution',
//       type: 'pie',
//       data: [
//         { label: 'Cash', amount: feedRevenueCash, percentage: totalPayments > 0 ? parseFloat(((feedRevenueCash / totalPayments) * 100).toFixed(1)) : 0 },
//         { label: 'Farmer Balance', amount: feedRevenueBalance, percentage: totalPayments > 0 ? parseFloat(((feedRevenueBalance / totalPayments) * 100).toFixed(1)) : 0 }
//       ]
//     };

//     // 6e. Zone Ranking (metadata)
//     const totalZoneLitres = zoneBreakdown.reduce((sum, z) => sum + z.totalLitres, 0);
//     const zoneFarmerCounts = await Farmer.aggregate([
//       { $match: { cooperativeId: coopObjectId, isActive: true } },
//       { $group: { _id: '$branch_id', count: { $sum: 1 } } }
//     ]);
//     const zoneFarmerMap = {};
//     for (const zf of zoneFarmerCounts) zoneFarmerMap[zf._id || 'Unassigned'] = zf.count;

//     const zoneRankingData = zoneBreakdown.map((z, index) => ({
//       rank: index + 1,
//       zone: z.zone || 'Unassigned',
//       litres: z.totalLitres,
//       percentage: totalZoneLitres > 0 ? parseFloat(((z.totalLitres / totalZoneLitres) * 100).toFixed(1)) : 0,
//       farmers: zoneFarmerMap[z.zone] || 0
//     }));

//     const zoneRanking = {
//       title: 'Zone Production Ranking',
//       type: 'bar',
//       xAxis: 'Zone',
//       yAxis: 'Litres',
//       data: zoneRankingData
//     };

//     // 6f. Porter Leaderboard (metadata)
//     const porterLeaderboardData = topPorters.map((p, index) => ({
//       rank: index + 1,
//       name: p.porterName || 'Unknown',
//       litres: p.totalLitres,
//       payout: p.totalPayout,
//       transactions: p.transactionCount,
//       avgLitresPerTrip: p.transactionCount > 0 ? parseFloat((p.totalLitres / p.transactionCount).toFixed(2)) : 0
//     }));

//     const porterLeaderboard = {
//       title: 'Porter Leaderboard',
//       type: 'leaderboard',
//       data: porterLeaderboardData
//     };

//     // 6g. Farmer Segmentation (metadata)
//     const farmerSegmentsAgg = await Transaction.aggregate([
//       {
//         $match: {
//           type: 'milk',
//           cooperativeId: coopObjectId,
//           timestamp_server: { $gte: startDate, $lte: endDate }
//         }
//       },
//       {
//         $group: {
//           _id: '$farmer_id',
//           totalLitres: { $sum: '$litres' }
//         }
//       },
//       {
//         $bucket: {
//           groupBy: '$totalLitres',
//           boundaries: [0, 100, 500, 1000, 5000],
//           default: '5000+',
//           output: { count: { $sum: 1 } }
//         }
//       }
//     ]);

//     const segmentLabels = { 0: '0-100L', 100: '100-500L', 500: '500-1000L', 1000: '1000-5000L', '5000+': '5000+L' };
//     const farmerSegmentsData = farmerSegmentsAgg.map(s => ({
//       label: segmentLabels[s._id] || s._id,
//       count: s.count
//     }));

//     const farmerSegments = {
//       title: 'Farmer Segmentation (Volume)',
//       type: 'pie',
//       data: farmerSegmentsData
//     };

//     // 6h. Rate Usage (metadata)
//     const totalRateTx = rateBreakdown.reduce((sum, r) => sum + r.transactionCount, 0);
//     const rateUsageData = rateBreakdown.map(r => ({
//       rate: r.rate,
//       percentage: totalRateTx > 0 ? parseFloat(((r.transactionCount / totalRateTx) * 100).toFixed(1)) : 0
//     }));

//     const rateUsage = {
//       title: 'Milk Rate Adoption',
//       type: 'bar',
//       xAxis: 'Rate (KES/L)',
//       yAxis: '% of Transactions',
//       data: rateUsageData
//     };

//     // 6i. Product Contribution (metadata)
//     const totalProductRevenue = productBreakdown.reduce((sum, p) => sum + p.totalCost, 0);
//     const productContributionData = productBreakdown.map(p => ({
//       product: p.productName,
//       revenue: p.totalCost,
//       quantity: p.totalQuantity,
//       percentage: totalProductRevenue > 0 ? parseFloat(((p.totalCost / totalProductRevenue) * 100).toFixed(1)) : 0
//     }));

//     const productContribution = {
//       title: 'Feed Product Contribution',
//       type: 'pie',
//       data: productContributionData
//     };

//     // 6j. Balance Histogram (metadata)
//     const balanceBuckets = await Farmer.aggregate([
//       { $match: { cooperativeId: coopObjectId, isActive: true } },
//       {
//         $bucket: {
//           groupBy: '$balance',
//           boundaries: [0, 500, 1000, 3000, 5000, 10000],
//           default: '10000+',
//           output: { count: { $sum: 1 } }
//         }
//       }
//     ]);

//     const balanceLabels = { 0: '0-500', 500: '500-1000', 1000: '1000-3000', 3000: '3000-5000', 5000: '5000-10000', '10000+': '10000+' };
//     const balanceHistogramData = balanceBuckets.map(b => ({
//       range: balanceLabels[b._id] || b._id,
//       count: b.count
//     }));

//     const balanceHistogram = {
//       title: 'Farmer Balance Distribution',
//       type: 'histogram',
//       xAxis: 'Balance Range (KES)',
//       yAxis: 'Number of Farmers',
//       data: balanceHistogramData
//     };

//     // 6k. Settlement Gauge (metadata)
//     const totalSettlements = settlementSummary.totalNetPayable || 0;
//     const settlementGauge = {
//       title: 'Settlement Progress',
//       type: 'gauge',
//       value: totalSettlements > 0 ? parseFloat(((settlementSummary.totalPaid / totalSettlements) * 100).toFixed(1)) : 0,
//       max: 100,
//       unit: '%'
//     };

//     // 6l. Weekly Performance (metadata)
//     const weeklyPerformanceData = weekly.map((w, idx) => {
//       const prevWeek = idx > 0 ? weekly[idx - 1] : null;
//       const growth = prevWeek && prevWeek.totalLitres > 0
//         ? parseFloat(((w.totalLitres - prevWeek.totalLitres) / prevWeek.totalLitres * 100).toFixed(1))
//         : null;
//       return {
//         week: w.week,
//         litres: w.totalLitres,
//         payout: w.totalPayout,
//         transactions: w.transactionCount,
//         avgPerDay: parseFloat((w.totalLitres / 7).toFixed(1)),
//         growth
//       };
//     });

//     const weeklyPerformance = {
//       title: 'Weekly Performance',
//       type: 'table',
//       data: weeklyPerformanceData
//     };

//     // 6m. Trend Indicators
//     let prevMonthStart, prevMonthEnd;
//     if (month === 1) {
//       prevMonthStart = new Date(y - 1, 11, 1);
//       prevMonthEnd = new Date(y - 1, 11, 31, 23, 59, 59, 999);
//     } else {
//       prevMonthStart = new Date(y, m - 2, 1);
//       prevMonthEnd = new Date(y, m - 1, 0, 23, 59, 59, 999);
//     }

//     const prevMonthAgg = await Transaction.aggregate([
//       {
//         $match: {
//           cooperativeId: coopObjectId,
//           type: 'milk',
//           timestamp_server: { $gte: prevMonthStart, $lte: prevMonthEnd }
//         }
//       },
//       { $group: { _id: null, totalLitres: { $sum: '$litres' }, totalPayout: { $sum: '$payout' }, transactionCount: { $sum: 1 } } }
//     ]);

//     const prevMonthData = prevMonthAgg[0] || { totalLitres: 0, totalPayout: 0, transactionCount: 0 };

//     const trend = (current, previous) => {
//       if (previous === 0 && current === 0) return { value: 0, change: 0, direction: 'flat' };
//       if (previous === 0) return { value: current, change: 100, direction: 'up' };
//       const change = ((current - previous) / previous) * 100;
//       return { value: current, change: parseFloat(change.toFixed(1)), direction: change > 0 ? 'up' : (change < 0 ? 'down' : 'flat'), previous };
//     };

//     const prevFeedRevenue = await Transaction.aggregate([
//       { $match: { cooperativeId: coopObjectId, type: 'feed', timestamp_server: { $gte: prevMonthStart, $lte: prevMonthEnd } } },
//       { $group: { _id: null, total: { $sum: '$cost' } } }
//     ]).then(r => r[0]?.total || 0);

//     const kpiTrends = {
//       totalMilkLitres: trend(totalMilkLitres, prevMonthData.totalLitres),
//       totalMilkPayout: trend(totalMilkPayout, prevMonthData.totalPayout),
//       totalFeedRevenue: trend(totalFeedRevenue, prevFeedRevenue),
//       activeFarmers: trend(farmersWithDeliveries, await Farmer.countDocuments({ cooperativeId: coopObjectId, createdAt: { $gte: prevMonthStart, $lt: startDate } })),
//       outstandingLiability: trend(outstanding.totalPositive, 0)
//     };

//     // 6n. Forecast
//     let forecast = null;
//     if (includeForecast) {
//       const sixMonthsAgo = new Date(startDate);
//       sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
//       const historical = await Transaction.aggregate([
//         {
//           $match: {
//             cooperativeId: coopObjectId,
//             type: 'milk',
//             timestamp_server: { $gte: sixMonthsAgo, $lt: startDate }
//           }
//         },
//         {
//           $group: {
//             _id: { year: { $year: '$timestamp_server' }, month: { $month: '$timestamp_server' } },
//             totalLitres: { $sum: '$litres' },
//             totalPayout: { $sum: '$payout' }
//           }
//         },
//         { $sort: { '_id.year': 1, '_id.month': 1 } }
//       ]);

//       if (historical.length >= 3) {
//         const last3 = historical.slice(-3);
//         const avgLitres = last3.reduce((s, h) => s + h.totalLitres, 0) / last3.length;
//         const avgPayout = last3.reduce((s, h) => s + h.totalPayout, 0) / last3.length;
//         const variance = last3.reduce((s, h) => s + Math.pow(h.totalLitres - avgLitres, 2), 0) / last3.length;
//         const confidence = Math.max(0, Math.min(100, 100 - variance / avgLitres * 10));
//         forecast = {
//           available: true,
//           nextMonthMilk: Math.round(avgLitres),
//           nextMonthPayout: Math.round(avgPayout),
//           confidence: parseFloat(Math.min(confidence, 100).toFixed(0)),
//           basedOnMonths: last3.length
//         };
//       } else {
//         forecast = {
//           available: false,
//           reason: `Need at least 3 months of history. Found ${historical.length} month(s).`,
//           basedOnMonths: historical.length
//         };
//       }
//     }

//     // 6o. Executive Summary
//     const overallHealth = (() => {
//       let score = 0;
//       if (kpiTrends.totalMilkLitres.direction === 'up') score += 2;
//       if (kpiTrends.totalFeedRevenue.direction === 'up') score += 2;
//       if (settlementGauge.value > 80) score += 2;
//       if (farmersWithoutDeliveries === 0) score += 1;
//       if (outstanding.totalPositive > 0) score += 1;
//       return score >= 7 ? 'Excellent' : (score >= 5 ? 'Good' : (score >= 3 ? 'Fair' : 'Needs Attention'));
//     })();

//     const highlights = [];
//     if (kpiTrends.totalMilkLitres.direction === 'up') highlights.push(`Milk collection increased by ${kpiTrends.totalMilkLitres.change}%`);
//     if (kpiTrends.totalFeedRevenue.direction === 'up') highlights.push(`Feed revenue grew by ${kpiTrends.totalFeedRevenue.change}%`);
//     if (settlementGauge.value > 80) highlights.push(`Settlement completion is ${settlementGauge.value}%`);
//     if (farmersWithoutDeliveries === 0) highlights.push('All farmers are active this month');

//     const warnings = [];
//     if (kpiTrends.totalMilkLitres.direction === 'down') warnings.push(`Milk collection decreased by ${Math.abs(kpiTrends.totalMilkLitres.change)}%`);
//     if (kpiTrends.totalFeedRevenue.direction === 'down') warnings.push(`Feed revenue declined by ${Math.abs(kpiTrends.totalFeedRevenue.change)}%`);
//     if (settlementGauge.value < 50) warnings.push(`Settlement completion is low (${settlementGauge.value}%)`);
//     if (farmersWithoutDeliveries > 0) warnings.push(`${farmersWithoutDeliveries} farmers had no deliveries`);
//     if (exceptions.length > 0) warnings.push(`Found ${exceptions.length} data exceptions (check audit section)`);

//     const recommendations = [];
//     if (totalFeedQuantity < totalMilkLitres * 0.1) recommendations.push('Consider increasing feed sales to improve revenue');
//     if (settlementGauge.value < 80) recommendations.push('Accelerate pending settlements');
//     if (farmersWithoutDeliveries > 0) recommendations.push('Reach out to inactive farmers');
//     if (outstanding.totalDebt > 10000) recommendations.push('Follow up on farmer debt');
//     if (zoneBreakdown.some(z => z.totalLitres < totalMilkLitres * 0.05)) recommendations.push('Investigate low-performing zones');

//     const executiveSummary = { overallHealth, highlights, warnings, recommendations };

//     // 6p. Portfolio Stats (Financial KPIs)
//     const grossRevenue = totalFeedRevenue; // currently only feed sales
//     const netCashFlow = grossRevenue - totalMilkPayout;
//     const operatingMargin = grossRevenue > 0 ? parseFloat((netCashFlow / grossRevenue * 100).toFixed(2)) : 0;
//     const profitLoss = netCashFlow > 0 ? `Ksh ${netCashFlow.toLocaleString()} profit` : `Ksh ${Math.abs(netCashFlow).toLocaleString()} loss`;

//     // 6q. Feed Analytics
//     const inventoryItems = await Inventory.find({ cooperativeId: coopObjectId, category: 'feed' }).lean();
//     const feedAnalytics = {
//       topSelling: productBreakdown.slice(0, 3).map(p => p.productName),
//       fastestMoving: productBreakdown.sort((a, b) => (a.totalQuantity / (b.totalQuantity || 1)) - (b.totalQuantity / (a.totalQuantity || 1))).slice(0, 3).map(p => p.productName),
//       slowMoving: productBreakdown.sort((a, b) => (a.totalQuantity / (b.totalQuantity || 1)) - (b.totalQuantity / (a.totalQuantity || 1))).slice(-3).map(p => p.productName),
//       deadStock: inventoryItems.filter(item => item.stock > 0 && !productBreakdown.some(p => p.productName === item.name)).map(item => item.name),
//       stockTurnover: productBreakdown.map(p => ({
//         product: p.productName,
//         turnover: p.totalQuantity > 0 ? (p.totalQuantity / (inventoryItems.find(i => i.name === p.productName)?.stock || 1)) : 0
//       })),
//       avgSellingPrice: feedRevenue.averagePricePerUnit,
//       avgPurchasePrice: 0, // not captured yet
//       profitMargin: 0 // not captured yet
//     };

//     // 6r. Farmer Rankings (Extended)
//     const farmerStats = await Transaction.aggregate([
//       { $match: { type: 'milk', cooperativeId: coopObjectId, timestamp_server: { $gte: startDate, $lte: endDate } } },
//       {
//         $group: {
//           _id: '$farmer_id',
//           totalLitres: { $sum: '$litres' },
//           totalPayout: { $sum: '$payout' },
//           transactionCount: { $sum: 1 },
//           avgLitresPerDay: { $avg: '$litres' }
//         }
//       },
//       {
//         $lookup: {
//           from: 'farmers',
//           localField: '_id',
//           foreignField: '_id',
//           as: 'farmer'
//         }
//       },
//       { $unwind: { path: '$farmer', preserveNullAndEmptyArrays: true } },
//       {
//         $project: {
//           farmerName: '$farmer.name',
//           farmerCode: '$farmer.farmer_code',
//           totalLitres: 1,
//           totalPayout: 1,
//           transactionCount: 1,
//           avgLitresPerDay: 1,
//           balance: '$farmer.balance'
//         }
//       }
//     ]);

//     const farmerRankings = {
//       mostImproved: farmerStats.sort((a, b) => (b.totalLitres - a.totalLitres)).slice(0, 3).map(f => f.farmerName),
//       mostConsistent: farmerStats.sort((a, b) => (a.avgLitresPerDay - b.avgLitresPerDay)).slice(0, 3).map(f => f.farmerName),
//       highestAverageLitresPerDay: farmerStats.sort((a, b) => b.avgLitresPerDay - a.avgLitresPerDay).slice(0, 3).map(f => f.farmerName),
//       highestRevenue: farmerStats.sort((a, b) => b.totalPayout - a.totalPayout).slice(0, 3).map(f => f.farmerName),
//       highestDebt: farmerStats.filter(f => f.balance < 0).sort((a, b) => a.balance - b.balance).slice(0, 3).map(f => f.farmerName),
//       highestFeedBuyer: [], // needs feed transactions per farmer
//       highestBonus: [], // needs bonus ledger entries
//       highestPenalty: [] // needs penalty ledger entries
//     };

//     // 6s. Porter Analytics
//     const porterAnalytics = {
//       avgFarmersServed: uniquePortersCount > 0 ? uniqueFarmersCount / uniquePortersCount : 0,
//       avgCollectionTime: null, // needs time data
//       lateCollections: 0, // needs status field
//       cancelledCollections: 0, // needs status field
//       routeCoverage: uniquePortersCount > 0 ? zonesCount / uniquePortersCount : 0,
//       distance: null, // future
//       collectionAccuracy: null // future
//     };

//     // 6t. Zone Analytics
//     const zoneAnalytics = await Promise.all(zoneBreakdown.map(async (z) => {
//       const zoneName = z.zone || 'Unassigned';
//       const farmersInZone = await Farmer.countDocuments({ cooperativeId: coopObjectId, branch_id: zoneName });
//       const activeInZone = await Transaction.distinct('farmer_id', {
//         cooperativeId: coopObjectId,
//         type: 'milk',
//         timestamp_server: { $gte: startDate, $lte: endDate },
//         zone: zoneName
//       });
//       const inactiveInZone = farmersInZone - activeInZone.length;
//       const zoneFeedSales = await Transaction.aggregate([
//         { $match: { type: 'feed', cooperativeId: coopObjectId, zone: zoneName, timestamp_server: { $gte: startDate, $lte: endDate } } },
//         { $group: { _id: null, totalRevenue: { $sum: '$cost' }, totalQuantity: { $sum: '$quantity' } } }
//       ]);
//       const outstandingZone = await Farmer.aggregate([
//         { $match: { cooperativeId: coopObjectId, branch_id: zoneName } },
//         { $group: { _id: null, totalBalance: { $sum: '$balance' } } }
//       ]);

//       return {
//         zone: zoneName,
//         avgFarmers: farmersInZone,
//         avgLitresPerFarmer: farmersInZone > 0 ? z.totalLitres / farmersInZone : 0,
//         revenue: z.totalPayout,
//         growth: 0, // placeholder
//         inactiveFarmers: inactiveInZone,
//         feedSales: zoneFeedSales[0]?.totalRevenue || 0,
//         outstandingBalance: outstandingZone[0]?.totalBalance || 0
//       };
//     }));

//     // ───── 7. ASSEMBLE FINAL REPORT ──────────────────────────────────
//     const operational = {
//       overview: {
//         totalFarmers: allFarmersCount,
//         activeFarmersWithDeliveries: farmersWithDeliveries,
//         farmersWithoutDeliveries,
//         totalMilkTransactions,
//         totalMilkLitres,
//         totalMilkPayout,
//         averageLitresPerTransaction: avgLitresPerTransaction,
//         averagePayoutPerTransaction: avgPayoutPerTransaction,
//         averageLitresPerFarmer: avgLitresPerFarmer,
//         averagePayoutPerFarmer: avgPayoutPerFarmer,
//         totalPortersInvolved: uniquePortersCount,
//         zonesCount
//       },
//       feedRevenue: {
//         total: totalFeedRevenue,
//         cash: feedRevenueCash,
//         balance: feedRevenueBalance,
//         totalQuantity: totalFeedQuantity,
//         cashQuantity: feedQuantityCash,
//         balanceQuantity: feedQuantityBalance,
//         transactionCount: totalFeedTransactions,
//         cashTransactions: feedTxCash,
//         balanceTransactions: feedTxBalance,
//         averagePricePerUnit: totalFeedQuantity ? totalFeedRevenue / totalFeedQuantity : 0
//       },
//       farmerPerformance: {
//         topFarmers: topFarmers,
//         bottomFarmers: bottomFarmers,
//         farmersWithNoDeliveries: farmersNoDeliveries.map(f => ({ code: f.farmer_code, name: f.name, phone: f.phone })),
//         farmerActivity: {
//           activeFarmersCount: allFarmersCount,
//           farmersWithDeliveries,
//           farmersWithoutDeliveries,
//           averageDeliveriesPerFarmer: farmersWithDeliveries ? totalMilkTransactions / farmersWithDeliveries : 0,
//           averageLitresPerActiveFarmer: avgLitresPerFarmer,
//           averagePayoutPerActiveFarmer: avgPayoutPerFarmer
//         }
//       },
//       porterPerformance: {
//         totalPorters: await Porter.countDocuments({ cooperativeId: coopObjectId, isActive: true }),
//         activePorters: uniquePortersCount,
//         averageLitresPerPorter: uniquePortersCount > 0 ? totalMilkLitres / uniquePortersCount : 0,
//         averagePayoutPerPorter: uniquePortersCount > 0 ? totalMilkPayout / uniquePortersCount : 0,
//         zoneCoverage: zoneBreakdown.map(z => ({ zone: z.zone, porterCount: 1, totalLitres: z.totalLitres, totalPayout: z.totalPayout })) // simplified
//       },
//       inventory: {
//         feedTransactionsCount: totalFeedTransactions,
//         totalFeedQuantity,
//         totalFeedCost: totalFeedRevenue,
//         averageCostPerUnit: totalFeedQuantity ? totalFeedRevenue / totalFeedQuantity : 0,
//         productBreakdown
//       },
//       trends: {
//         daily,
//         weekly,
//         rateBreakdown,
//         previousMonthComparison: {
//           milk: {
//             litres: prevMonthData.totalLitres,
//             payout: prevMonthData.totalPayout,
//             transactionCount: prevMonthData.transactionCount
//           },
//           feed: {
//             revenue: prevFeedRevenue,
//             quantity: 0
//           },
//           changes: {
//             milkLitres: kpiTrends.totalMilkLitres.change + '%',
//             milkPayout: kpiTrends.totalMilkPayout.change + '%',
//             milkTransactions: trend(totalMilkTransactions, prevMonthData.transactionCount).change + '%',
//             feedRevenue: kpiTrends.totalFeedRevenue.change + '%'
//           }
//         }
//       }
//     };

//     const financial = {
//       ledgerSummary: ledger,
//       currentOutstanding: outstanding,
//       ratios: {
//         averageMilkPrice: totalMilkLitres > 0 ? totalMilkPayout / totalMilkLitres : 0,
//         feedDeductionRate: grossMilkEarnings > 0 ? (feedDeductions / grossMilkEarnings) * 100 : 0,
//         settlementRate: settlementSummary.totalNetPayable > 0 ? (settlementSummary.totalPaid / settlementSummary.totalNetPayable) * 100 : 0,
//         creditToDebitRatio: ledger.totalDebits > 0 ? ledger.totalCredits / ledger.totalDebits : 0,
//         grossRevenue,
//         netCashFlow,
//         operatingMargin,
//         profitLoss,
//         // Additional ratios
//         averageFeedPurchasePerFarmer: uniqueFarmersCount > 0 ? totalFeedRevenue / uniqueFarmersCount : 0,
//         feedAttachmentRate: uniqueFarmersCount > 0 ? (totalFeedQuantity / uniqueFarmersCount) : 0,
//         debtRatio: outstanding.totalPositive > 0 ? outstanding.totalDebt / outstanding.totalPositive : 0,
//         cashCollectionRate: totalFeedRevenue > 0 ? (feedRevenueCash / totalFeedRevenue) * 100 : 0,
//         revenuePerFarmer: uniqueFarmersCount > 0 ? totalMilkPayout / uniqueFarmersCount : 0,
//         revenuePerPorter: uniquePortersCount > 0 ? totalMilkPayout / uniquePortersCount : 0
//       }
//     };

//     const settlement = {
//       summary: settlementSummary,
//       details: settlements
//     };

//     const audit = {
//       counts: { transactions: txCount, ledgerEntries: ledgerCount, settlements: settlementCount, activeFarmers: farmerCount },
//       exceptions,
//       hasExceptions: exceptions.length > 0
//     };

//     const graphs = {
//       calendarHeatmap,
//       milkVsFeed,
//       cumulativeCashFlow,
//       paymentMethods,
//       zoneRanking,
//       porterLeaderboard,
//       farmerSegments,
//       rateUsage,
//       productContribution,
//       balanceHistogram,
//       settlementGauge,
//       weeklyPerformance
//     };

//     // Dashboard Cards
//     const dashboardCards = [
//       { id: 'milk_collected', title: 'Milk Collected', value: totalMilkLitres, unit: 'Litres', change: kpiTrends.totalMilkLitres.change, direction: kpiTrends.totalMilkLitres.direction, color: '#00B4D8', icon: 'water_drop' },
//       { id: 'milk_payout', title: 'Milk Payout', value: totalMilkPayout, currency: 'KES', change: kpiTrends.totalMilkPayout.change, direction: kpiTrends.totalMilkPayout.direction, color: '#00B4D8' },
//       { id: 'feed_revenue', title: 'Feed Revenue', value: totalFeedRevenue, currency: 'KES', change: kpiTrends.totalFeedRevenue.change, direction: kpiTrends.totalFeedRevenue.direction, color: '#16A34A' },
//       { id: 'outstanding_liability', title: 'Outstanding Liability', value: outstanding.totalPositive, currency: 'KES', change: 0, direction: 'flat', color: '#7C3AED' },
//       { id: 'active_farmers', title: 'Active Farmers', value: farmersWithDeliveries, unit: 'farmers', change: kpiTrends.activeFarmers.change, direction: kpiTrends.activeFarmers.direction, color: '#16A34A' },
//       { id: 'settlement_completion', title: 'Settlement Completion', value: settlementGauge.value, unit: '%', change: 0, direction: 'flat', color: '#00B4D8' }
//     ];

//     // ───── 8. FINAL REPORT ──────────────────────────────────────────
//     const report = {
//       cooperative: { id: cooperative._id, name: cooperative.name },
//       period: { year: y, month: m, startDate: startDate.toISOString(), endDate: endDate.toISOString() },
//       executiveKpis: {
//         totalMilkLitres,
//         totalMilkPayout,
//         totalFeedRevenue,
//         netLedgerPosition,
//         outstandingLiability: outstanding.totalPositive,
//         totalDebt: Math.abs(outstanding.totalNegative),
//         settlementCompletionRate: settlementGauge.value,
//         activeFarmers: allFarmersCount,
//         farmersWithDeliveries,
//         collectionEfficiency: allFarmersCount > 0 ? parseFloat(((farmersWithDeliveries / allFarmersCount) * 100).toFixed(1)) : 0,
//         averagePayoutPerFarmer: farmersWithDeliveries ? totalMilkPayout / farmersWithDeliveries : 0,
//         averageLitresPerFarmer: farmersWithDeliveries ? totalMilkLitres / farmersWithDeliveries : 0,
//         trends: kpiTrends
//       },
//       executiveSummary,
//       operational,
//       financial,
//       settlement,
//       audit,
//       graphs,
//       dashboardCards,
//       forecast,
//       // Additional sections
//       feedAnalytics,
//       farmerRankings,
//       porterAnalytics,
//       zoneAnalytics
//     };

//     logger.info(`Monthly report generated for cooperative ${cooperative.name}, ${year}-${month}`, {
//       farmers: farmersWithDeliveries,
//       litres: totalMilkLitres,
//       milkPayout: totalMilkPayout,
//       feedRevenue: totalFeedRevenue
//     });

//     return report;
//   } catch (error) {
//     logger.error('Monthly report generation failed', {
//       error: error.message,
//       stack: error.stack,
//       ...logContext
//     });
//     throw error;
//   }
// };

// module.exports = { getMonthlyReport };



const operationalService = require('./reports/operationalService');
const financialService = require('./reports/financialService');
const settlementService = require('./reports/settlementService');
const auditService = require('./reports/auditService');
const graphBuilder = require('./reports/graphBuilder');
const dashboardService = require('./reports/dashboardService');
const forecastService = require('./reports/forecastService');
const executiveKpiBuilder = require('./reports/executiveKpiBuilder');
const logger = require('../utils/logger');

const getMonthlyReport = async (year, month, cooperativeId) => {
  const start = Date.now();
  const logContext = { year, month, cooperativeId };

  try {
    // 1. Fetch raw data
    const [opData, finData, setData, auditData] = await Promise.all([
      operationalService.fetchOperationalData(year, month, cooperativeId),
      financialService.fetchFinancialData(year, month, cooperativeId),
      settlementService.fetchSettlementData(year, month, cooperativeId),
      auditService.fetchAuditData(year, month, cooperativeId)
    ]);

    // 2. Build sections
    const operational = operationalService.buildOperational(opData);
    const financial = financialService.buildFinancial(finData);
    const settlement = settlementService.buildSettlement(setData);
    const audit = auditService.buildAudit(auditData);

    // 3. Build Executive KPIs
    const executiveKpis = executiveKpiBuilder.buildExecutiveKpis(operational, financial, settlement);

    // 4. Graphs, dashboard, forecast
    const graphs = graphBuilder.buildGraphs(operational, financial, settlement);
    const dashboardCards = dashboardService.buildCards(executiveKpis);
    const forecast = await forecastService.buildForecast(year, month, cooperativeId);

    // 5. Assemble report
    const report = {
      cooperative: opData.cooperative,
      period: opData.period,
      executiveKpis,
      operational,
      financial,
      settlement,
      audit,
      graphs,
      dashboardCards,
      forecast
    };

    const duration = Date.now() - start;
    logger.info(`Monthly report generated in ${duration}ms`, logContext);
    return report;

  } catch (error) {
    logger.error('Monthly report generation failed', { error: error.message, stack: error.stack, ...logContext });
    throw error;
  }
};

module.exports = { getMonthlyReport };