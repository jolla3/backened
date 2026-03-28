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

  const [milkStats, feedStats, debtStats, todayStats, zoneStats] = await Promise.all([
    Transaction.aggregate([
      { $match: { type: 'milk', cooperativeId: cooperative._id, timestamp_server: { $gte: startOfMonth } } },
      { $group: { _id: null, totalPayout: { $sum: '$payout' }, totalLitres: { $sum: '$litres' } } }
    ]),
    Transaction.aggregate([
      { $match: { type: 'feed', cooperativeId: cooperative._id, timestamp_server: { $gte: startOfMonth } } },
      { $group: { _id: null, totalRevenue: { $sum: '$cost' }, totalQty: { $sum: '$quantity' } } }
    ]),
    Farmer.aggregate([
      { $match: { cooperativeId: cooperative._id, balance: { $lt: 0 } } },
      { $group: { _id: null, totalDebt: { $sum: '$balance' } } }
    ]),
    Transaction.aggregate([
      { $match: { type: 'milk', cooperativeId: cooperative._id, timestamp_server: { $gte: startOfToday } } },
      { $group: { _id: null, totalPayout: { $sum: '$payout' }, totalLitres: { $sum: '$litres' } } }
    ]),
    // Zone profitability (optional)
    Transaction.aggregate([
      { $match: { type: 'milk', cooperativeId: cooperative._id, timestamp_server: { $gte: startOfMonth } } },
      { $lookup: { from: 'farmers', localField: 'farmer_id', foreignField: '_id', as: 'farmer' } },
      { $unwind: '$farmer' },
      { $group: { _id: { $ifNull: ['$farmer.branch_id', 'main'] }, totalMilk: { $sum: '$litres' }, totalPayout: { $sum: '$payout' } } }
    ])
  ]);

  const milkPayout = milkStats[0]?.totalPayout || 0;
  const feedRevenue = feedStats[0]?.totalRevenue || 0;
  const totalDebt = Math.abs(debtStats[0]?.totalDebt || 0);
  const todayPayout = todayStats[0]?.totalPayout || 0;
  const todayLitres = todayStats[0]?.totalLitres || 0;

  const grossProfit = feedRevenue - milkPayout;
  const profitMargin = feedRevenue > 0 ? (grossProfit / feedRevenue) * 100 : 0;

  // Cash flow projection: assume 70% of milk payout is due within 30 days, 30% later
  const projectedPayout = milkPayout * 0.7;
  const projectedCashFlow = feedRevenue - projectedPayout;

  // Break-even analysis: how many litres needed to cover costs?
  const avgPricePerLiter = milkPayout > 0 ? milkPayout / milkStats[0]?.totalLitres : 45;
  const fixedCosts = 100000; // placeholder; could be derived from rent, salaries etc.
  const breakEvenLitres = fixedCosts / avgPricePerLiter;

  return {
    milkRevenue: milkPayout,
    feedRevenue,
    farmerDebtTotal: totalDebt,
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
    zoneProfitability: zoneStats.map(z => ({
      zone: z._id === 'main' ? 'Main' : `Zone ${z._id}`,
      milkLitres: z.totalMilk,
      payout: z.totalPayout,
      profit: feedRevenue * (z.totalMilk / milkStats[0]?.totalLitres || 0) - z.totalPayout,
    })),
  };
};

module.exports = { getFinancialIntelligence };