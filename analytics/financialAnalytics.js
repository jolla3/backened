// analytics/financialAnalytics.js
const mongoose = require('mongoose');
const Transaction = require('../models/transaction');
const Ledger = require('../models/ledger');
const Cooperative = require('../models/cooperative');
const logger = require('../utils/logger');

/**
 * Main financial intelligence – operations from Transactions, balances from Ledger.
 */
const getFinancialIntelligence = async (cooperativeId) => {
  const cooperative = await Cooperative.findById(cooperativeId);
  if (!cooperative) throw new Error('Cooperative not found');

  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  // Milk litres (month)
  const milkLitresAgg = await Transaction.aggregate([
    { $match: { type: 'milk', cooperativeId: cooperative._id, timestamp_server: { $gte: startOfMonth } } },
    { $group: { _id: null, totalLitres: { $sum: '$litres' } } }
  ]);
  const milkLitres = milkLitresAgg[0]?.totalLitres || 0;

  // Feed quantity (month)
  const feedQuantityAgg = await Transaction.aggregate([
    { $match: { type: 'feed', cooperativeId: cooperative._id, timestamp_server: { $gte: startOfMonth } } },
    { $group: { _id: null, totalQuantity: { $sum: '$quantity' } } }
  ]);
  const feedQuantity = feedQuantityAgg[0]?.totalQuantity || 0;

  // Feed revenue (month)
  const feedRevenueAgg = await Transaction.aggregate([
    { $match: { type: 'feed', cooperativeId: cooperative._id, timestamp_server: { $gte: startOfMonth } } },
    { $group: { _id: null, totalRevenue: { $sum: '$cost' } } }
  ]);
  const feedRevenue = feedRevenueAgg[0]?.totalRevenue || 0;

  // Feed revenue split by paymentMethod
  const feedByPayment = await Transaction.aggregate([
    { $match: { type: 'feed', cooperativeId: cooperative._id, timestamp_server: { $gte: startOfMonth } } },
    { $group: { _id: '$paymentMethod', total: { $sum: '$cost' } } }
  ]);
  const feedRevenueCash = feedByPayment.find(f => f._id === 'cash')?.total || 0;
  const feedRevenueBalance = feedByPayment.find(f => f._id === 'balance')?.total || 0;

  // Milk value generated (sum of MILK_CREDIT this month) – historical
  const milkValueAgg = await Ledger.aggregate([
    { $match: { cooperativeId: cooperative._id, type: 'MILK_CREDIT', timestamp: { $gte: startOfMonth } } },
    { $group: { _id: null, total: { $sum: '$amount' } } }
  ]);
  const milkValueGenerated = milkValueAgg[0]?.total || 0;

  // Today's milk payout (operational)
  const todayStats = await Transaction.aggregate([
    { $match: { type: 'milk', cooperativeId: cooperative._id, timestamp_server: { $gte: startOfToday } } },
    { $group: { _id: null, totalPayout: { $sum: '$payout' }, totalLitres: { $sum: '$litres' } } }
  ]);
  const todayMilkPayout = todayStats[0]?.totalPayout || 0;
  const todayMilkLitres = todayStats[0]?.totalLitres || 0;

  // Current balances from latest Ledger runningBalance per farmer
  const latestLedger = await Ledger.aggregate([
    { $match: { cooperativeId: cooperative._id } },
    { $sort: { timestamp: -1 } },
    { $group: { _id: '$farmerId', runningBalance: { $first: '$runningBalance' } } }
  ]);

  let amountToPayFarmers = 0;
  let amountFarmersOweCoop = 0;
  let farmersToPay = 0;
  let farmersOwingCoop = 0;
  let farmersWithZero = 0;

  for (const entry of latestLedger) {
    const bal = entry.runningBalance || 0;
    if (bal > 0) {
      amountToPayFarmers += bal;
      farmersToPay++;
    } else if (bal < 0) {
      amountFarmersOweCoop += Math.abs(bal);
      farmersOwingCoop++;
    } else {
      farmersWithZero++;
    }
  }

  const avgPricePerLiter = milkLitres > 0 ? milkValueGenerated / milkLitres : 0;

  return {
    milkLitres,
    milkValueGenerated,
    feedRevenue,
    feedQuantity,
    feedRevenueCash,
    feedRevenueBalance,
    todayMilkPayout,
    todayMilkLitres,
    amountToPayFarmers,
    amountFarmersOweCoop,
    farmersToPay,
    farmersOwingCoop,
    farmersWithZero,
    avgPricePerLiter: parseFloat(avgPricePerLiter.toFixed(2)),
    hasRealData: milkLitres > 0 || feedRevenue > 0,
  };
};

/**
 * Get the latest runningBalance for every farmer.
 */
const getLatestBalances = async (cooperativeId) => {
  const coopId = new mongoose.Types.ObjectId(cooperativeId);
  const result = await Ledger.aggregate([
    { $match: { cooperativeId: coopId } },
    { $sort: { timestamp: -1 } },
    { $group: { _id: '$farmerId', balance: { $first: '$runningBalance' } } }
  ]);
  const map = new Map();
  for (const r of result) map.set(r._id.toString(), r.balance || 0);
  return map;
};

/**
 * Get lifetime ledger totals per farmer.
 */
const getFarmerLifetimeLedger = async (cooperativeId, farmerIds = null) => {
  const coopId = new mongoose.Types.ObjectId(cooperativeId);
  const match = { cooperativeId: coopId };
  if (farmerIds && farmerIds.length) {
    match.farmerId = { $in: farmerIds.map(id => new mongoose.Types.ObjectId(id)) };
  }
  const results = await Ledger.aggregate([
    { $match: match },
    {
      $group: {
        _id: '$farmerId',
        milkCredits: { $sum: { $cond: [{ $eq: ['$type', 'MILK_CREDIT'] }, '$amount', 0] } },
        feedDebits: { $sum: { $cond: [{ $eq: ['$type', 'FEED_DEBIT'] }, { $abs: '$amount' }, 0] } },
        settlementDebits: { $sum: { $cond: [{ $eq: ['$type', 'SETTLEMENT_DEBIT'] }, { $abs: '$amount' }, 0] } },
        bonuses: { $sum: { $cond: [{ $eq: ['$type', 'BONUS'] }, '$amount', 0] } },
        penalties: { $sum: { $cond: [{ $eq: ['$type', 'PENALTY'] }, { $abs: '$amount' }, 0] } },
        loans: { $sum: { $cond: [{ $eq: ['$type', 'LOAN'] }, { $abs: '$amount' }, 0] } },
        interest: { $sum: { $cond: [{ $eq: ['$type', 'INTEREST'] }, { $abs: '$amount' }, 0] } },
        manualAdjustments: { $sum: { $cond: [{ $eq: ['$type', 'MANUAL_ADJUSTMENT'] }, '$amount', 0] } }
      }
    }
  ]);
  const map = new Map();
  for (const r of results) {
    map.set(r._id.toString(), {
      milkCredits: r.milkCredits || 0,
      feedDebits: r.feedDebits || 0,
      settlementDebits: r.settlementDebits || 0,
      bonuses: r.bonuses || 0,
      penalties: r.penalties || 0,
      loans: r.loans || 0,
      interest: r.interest || 0,
      manualAdjustments: r.manualAdjustments || 0,
      netValue: (r.milkCredits || 0) - (r.feedDebits || 0) - (r.settlementDebits || 0) - (r.penalties || 0) - (r.loans || 0) - (r.interest || 0) + (r.bonuses || 0) + (r.manualAdjustments || 0)
    });
  }
  return map;
};

module.exports = { getFinancialIntelligence, getLatestBalances, getFarmerLifetimeLedger };