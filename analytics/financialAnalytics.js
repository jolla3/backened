const Transaction = require('../models/transaction');
const Farmer = require('../models/farmer');
const Cooperative = require('../models/cooperative');
const logger = require('../utils/logger');

const getFinancialIntelligence = async (cooperativeId) => {
  const cooperative = await Cooperative.findById(cooperativeId);
  if (!cooperative) throw new Error('Cooperative not found');

  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  // Use aggregation for better performance
  const [milkStats, feedStats, todayStats, zoneStats] = await Promise.all([
    Transaction.aggregate([
      { $match: { type: 'milk', cooperativeId: cooperative._id, timestamp_server: { $gte: startOfMonth } } },
      { $group: { _id: null, totalPayout: { $sum: { $ifNull: ['$payout', 0] } }, totalLitres: { $sum: { $ifNull: ['$litres', 0] } } } }
    ]),
    Transaction.aggregate([
      { $match: { type: 'feed', cooperativeId: cooperative._id, timestamp_server: { $gte: startOfMonth } } },
      { $group: { _id: null, totalRevenue: { $sum: { $ifNull: ['$cost', 0] } }, totalQty: { $sum: { $ifNull: ['$quantity', 0] } } } }
    ]),
    Transaction.aggregate([
      { $match: { type: 'milk', cooperativeId: cooperative._id, timestamp_server: { $gte: startOfToday } } },
      { $group: { _id: null, totalPayout: { $sum: { $ifNull: ['$payout', 0] } }, totalLitres: { $sum: { $ifNull: ['$litres', 0] } } } }
    ]),
    // Zone profitability (using farmer's branch_id)
    Transaction.aggregate([
      { $match: { type: 'milk', cooperativeId: cooperative._id, timestamp_server: { $gte: startOfMonth } } },
      { $lookup: { from: 'farmers', localField: 'farmer_id', foreignField: '_id', as: 'farmer' } },
      { $unwind: { path: '$farmer', preserveNullAndEmptyArrays: true } },
      { $group: {
        _id: { $ifNull: ['$farmer.branch_id', 'unassigned'] },
        totalMilk: { $sum: { $ifNull: ['$litres', 0] } },
        totalPayout: { $sum: { $ifNull: ['$payout', 0] } }
      } }
    ])
  ]);

  const milkPayout = milkStats[0]?.totalPayout || 0;
  const feedRevenue = feedStats[0]?.totalRevenue || 0;
  const todayPayout = todayStats[0]?.totalPayout || 0;
  const todayLitres = todayStats[0]?.totalLitres || 0;

  const grossProfit = feedRevenue - milkPayout;
  const profitMargin = feedRevenue > 0 ? (grossProfit / feedRevenue) * 100 : 0;

  // Cash flow projection: assume 70% of milk payout is due within 30 days, 30% later
  const projectedPayout = milkPayout * 0.7;
  const projectedCashFlow = feedRevenue - projectedPayout;

  // Break-even analysis: fixed costs placeholder – could be derived from expenses
  const fixedCosts = 100000; // TODO: replace with actual from settings
  const avgPricePerLiter = milkPayout > 0 && milkStats[0]?.totalLitres
    ? milkPayout / milkStats[0].totalLitres
    : 45;
  const breakEvenLitres = fixedCosts / avgPricePerLiter;

  // Zone profitability – also compute net profit per zone
  const totalMonthlyMilk = milkStats[0]?.totalLitres || 1; // avoid division by zero
  const zoneDetails = zoneStats.map(z => ({
    zone: z._id === 'unassigned' ? 'Unassigned' : z._id,
    milkLitres: z.totalMilk,
    payout: z.totalPayout,
    // Profit contribution: portion of feed revenue based on milk share minus payout
    profit: feedRevenue * (z.totalMilk / totalMonthlyMilk) - z.totalPayout,
  }));

  return {
    milkRevenue: milkPayout,
    feedRevenue,
    netCashFlow: grossProfit,
    profitMargin: profitMargin.toFixed(2),
    todayMilkPayout: todayPayout,
    todayMilkLitres: todayLitres,
    cashFlowProjection: {
      expectedReceipts: feedRevenue,
      expectedPayouts: projectedPayout,
      netProjection: projectedCashFlow,
    },
    breakEvenAnalysis: {
      fixedCosts,
      avgPricePerLiter: avgPricePerLiter.toFixed(2),
      litresNeeded: Math.ceil(breakEvenLitres),
    },
    zoneProfitability: zoneDetails,
  };
};

module.exports = { getFinancialIntelligence };