// services/reports/financialService.js
const mongoose = require('mongoose');
const Ledger = require('../../models/ledger');
const Farmer = require('../../models/farmer');
const Transaction = require('../../models/transaction');

// ─── Constants ──────────────────────────────────────────────────────────
const DEBIT_TYPES = ['FEED_DEBIT', 'SETTLEMENT_DEBIT', 'PENALTY', 'LOAN', 'INTEREST'];
const LEDGER_TYPES = [
  'MILK_CREDIT',
  'FEED_DEBIT',
  'FEED_CASH_SALE',
  'SETTLEMENT_DEBIT',
  'MANUAL_ADJUSTMENT',
  'BONUS',
  'PENALTY',
  'LOAN',
  'INTEREST',
  'REVERSAL'
];

// ─── Date helper ──────────────────────────────────────────────────────
const getMonthRange = (year, month) => {
  const start = new Date(year, month - 1, 1);
  const end = new Date(year, month, 0, 23, 59, 59, 999);
  return { startDate: start, endDate: end };
};

// ─── Main fetch ──────────────────────────────────────────────────────
const fetchFinancialData = async (year, month, cooperativeId, farmerIds = []) => {
  const { startDate, endDate } = getMonthRange(year, month);
  const coopId = new mongoose.Types.ObjectId(cooperativeId);

  // ── 1. Get the latest runningBalance for each farmer ──
  const latestBalances = await Ledger.aggregate([
    { $match: { cooperativeId: coopId } },
    { $sort: { timestamp: -1 } },
    { $group: { _id: '$farmerId', runningBalance: { $first: '$runningBalance' } } }
  ]);

  let totalLiability = 0;
  let totalDebt = 0;
  let farmersWithPositive = 0;
  let farmersInDebt = 0;
  let farmersWithZero = 0;
  const negativeFarmers = []; // store farmer IDs and balances for debt details

  for (const entry of latestBalances) {
    const bal = entry.runningBalance || 0;
    if (bal > 0) {
      totalLiability += bal;
      farmersWithPositive++;
    } else if (bal < 0) {
      const absBal = Math.abs(bal);
      totalDebt += absBal;
      farmersInDebt++;
      negativeFarmers.push({ farmerId: entry._id, debtAmount: absBal });
    } else {
      farmersWithZero++;
    }
  }

  // ── 2. Movement Breakdown (Ledger by type, for the month) ──
  const movement = await Ledger.aggregate([
    {
      $match: {
        cooperativeId: coopId,
        timestamp: { $gte: startDate, $lte: endDate }
      }
    },
    {
      $group: {
        _id: '$type',
        totalAmount: {
          $sum: {
            $cond: [
              { $in: ['$type', DEBIT_TYPES] },
              { $abs: '$amount' },
              '$amount'
            ]
          }
        },
        count: { $sum: 1 }
      }
    }
  ]);

  const movementMap = {};
  for (const item of movement) {
    movementMap[item._id] = {
      amount: item.totalAmount,
      count: item.count
    };
  }

  const breakdown = {};
  for (const type of LEDGER_TYPES) {
    breakdown[type] = movementMap[type] || { amount: 0, count: 0 };
  }

  // ── 3. Debt Details (from negative runningBalance) ──
  const debtDetails = await getFarmersInDebtDetails(coopId, negativeFarmers);

  // ── 4. Feed Revenue by Product (with quantity) ──
  const feedRevenueByProduct = await getFeedRevenueByProduct(coopId, startDate, endDate);

  // ── 5. Farmer Ledger Summaries (for provided farmerIds) ──
  let farmerSummaries = {};
  let farmerBalancesMap = {};
  if (farmerIds && farmerIds.length > 0) {
    const objectIds = farmerIds.map(id => new mongoose.Types.ObjectId(id));
    farmerSummaries = await getFarmerLedgerSummaries(objectIds, startDate, endDate, coopId);

    // Get the latest runningBalance for these farmers
    const balances = await Ledger.aggregate([
      { $match: { cooperativeId: coopId, farmerId: { $in: objectIds } } },
      { $sort: { timestamp: -1 } },
      { $group: { _id: '$farmerId', runningBalance: { $first: '$runningBalance' } } }
    ]);
    for (const fb of balances) {
      farmerBalancesMap[fb._id.toString()] = fb.runningBalance || 0;
    }
    // Fill zeros for farmers with no entries
    for (const id of objectIds) {
      const key = id.toString();
      if (!farmerBalancesMap[key]) farmerBalancesMap[key] = 0;
    }
  }

  return {
    currentLiability: totalLiability,
    farmerDebt: totalDebt,
    farmersInDebt,
    farmersWithPositive,
    farmersWithZero,
    movementBreakdown: breakdown,
    debtDetails,
    feedRevenueByProduct,
    farmerSummaries,
    farmerBalances: farmerBalancesMap
  };
};

// ─── Get farmers in debt with reason (using pre-computed negative list) ──
const getFarmersInDebtDetails = async (coopId, negativeFarmers) => {
  if (negativeFarmers.length === 0) return [];

  const farmerIds = negativeFarmers.map(f => f.farmerId);
  const debtMap = {};
  negativeFarmers.forEach(f => { debtMap[f.farmerId.toString()] = f.debtAmount; });

  // Fetch farmer names and latest debit entry
  const pipeline = [
    { $match: { _id: { $in: farmerIds }, isActive: true } },
    {
      $lookup: {
        from: 'ledgers',
        let: { farmerId: '$_id' },
        pipeline: [
          {
            $match: {
              $expr: {
                $and: [
                  { $eq: ['$farmerId', '$$farmerId'] },
                  { $eq: ['$cooperativeId', coopId] },
                  { $lt: ['$amount', 0] }
                ]
              }
            }
          },
          { $sort: { timestamp: -1 } },
          { $limit: 1 },
          { $project: { type: 1, description: 1, _id: 0 } }
        ],
        as: 'latestDebit'
      }
    },
    {
      $project: {
        farmerName: '$name',
        farmerCode: '$farmer_code',
        debtAmount: 1, // we'll fill from map
        reason: {
          $ifNull: [
            { $arrayElemAt: ['$latestDebit.description', 0] },
            { $arrayElemAt: ['$latestDebit.type', 0] }
          ]
        }
      }
    }
  ];

  const results = await Farmer.aggregate(pipeline);

  // Map debtAmount from the pre-computed map
  return results.map(f => ({
    farmerName: f.farmerName,
    farmerCode: f.farmerCode,
    debtAmount: debtMap[f._id.toString()] || 0,
    reason: f.reason || 'Unknown'
  }));
};

// ─── Feed revenue by product (includes total quantity) ────────────────
const getFeedRevenueByProduct = async (coopId, startDate, endDate) => {
  const pipeline = [
    {
      $match: {
        cooperativeId: coopId,
        timestamp: { $gte: startDate, $lte: endDate },
        type: { $in: ['FEED_DEBIT', 'FEED_CASH_SALE'] }
      }
    },
    {
      $lookup: {
        from: 'transactions',
        localField: 'transactionId',
        foreignField: '_id',
        as: 'txn'
      }
    },
    { $unwind: { path: '$txn', preserveNullAndEmptyArrays: true } },
    { $match: { 'txn.product_id': { $exists: true } } },
    {
      $group: {
        _id: '$txn.product_id',
        cashRevenue: {
          $sum: {
            $cond: [{ $eq: ['$type', 'FEED_CASH_SALE'] }, { $abs: '$amount' }, 0]
          }
        },
        balanceRevenue: {
          $sum: {
            $cond: [{ $eq: ['$type', 'FEED_DEBIT'] }, { $abs: '$amount' }, 0]
          }
        },
        totalRevenue: { $sum: { $abs: '$amount' } },
        transactionCount: { $sum: 1 },
        totalQuantity: { $sum: '$txn.quantity' }
      }
    },
    {
      $lookup: {
        from: 'inventories',
        localField: '_id',
        foreignField: '_id',
        as: 'product'
      }
    },
    { $unwind: { path: '$product', preserveNullAndEmptyArrays: true } },
    {
      $project: {
        productName: { $ifNull: ['$product.name', 'Unknown'] },
        cashRevenue: 1,
        balanceRevenue: 1,
        totalRevenue: 1,
        transactionCount: 1,
        totalQuantity: 1,
        averagePrice: {
          $cond: [
            { $gt: ['$totalQuantity', 0] },
            { $divide: ['$totalRevenue', '$totalQuantity'] },
            0
          ]
        }
      }
    },
    { $sort: { totalRevenue: -1 } }
  ];

  return await Ledger.aggregate(pipeline);
};

// ─── Farmer ledger summaries (returns object keyed by farmerId) ──────
const getFarmerLedgerSummaries = async (farmerObjectIds, startDate, endDate, coopId) => {
  if (!farmerObjectIds || farmerObjectIds.length === 0) return {};

  const results = await Ledger.aggregate([
    {
      $match: {
        cooperativeId: coopId,
        farmerId: { $in: farmerObjectIds },
        timestamp: { $gte: startDate, $lte: endDate }
      }
    },
    {
      $group: {
        _id: '$farmerId',
        totalMilkCredits: { $sum: { $cond: [{ $eq: ['$type', 'MILK_CREDIT'] }, '$amount', 0] } },
        totalFeedDebits: { $sum: { $cond: [{ $eq: ['$type', 'FEED_DEBIT'] }, '$amount', 0] } },
        totalSettlementDebits: { $sum: { $cond: [{ $eq: ['$type', 'SETTLEMENT_DEBIT'] }, '$amount', 0] } },
        totalBonuses: { $sum: { $cond: [{ $eq: ['$type', 'BONUS'] }, '$amount', 0] } },
        totalPenalties: { $sum: { $cond: [{ $eq: ['$type', 'PENALTY'] }, '$amount', 0] } },
        totalLoans: { $sum: { $cond: [{ $eq: ['$type', 'LOAN'] }, '$amount', 0] } },
        totalInterest: { $sum: { $cond: [{ $eq: ['$type', 'INTEREST'] }, '$amount', 0] } },
        totalManualAdjustments: { $sum: { $cond: [{ $eq: ['$type', 'MANUAL_ADJUSTMENT'] }, '$amount', 0] } }
      }
    },
    {
      $project: {
        milkCredits: '$totalMilkCredits',
        feedDebits: { $abs: '$totalFeedDebits' },
        settlementDebits: { $abs: '$totalSettlementDebits' },
        bonuses: '$totalBonuses',
        penalties: { $abs: '$totalPenalties' },
        loans: { $abs: '$totalLoans' },
        interest: { $abs: '$totalInterest' },
        manualAdjustments: '$totalManualAdjustments',
        netMovement: {
          $sum: [
            '$totalMilkCredits',
            '$totalFeedDebits',
            '$totalSettlementDebits',
            '$totalBonuses',
            '$totalPenalties',
            '$totalLoans',
            '$totalInterest',
            '$totalManualAdjustments'
          ]
        }
      }
    }
  ]);

  const map = {};
  for (const r of results) {
    map[r._id.toString()] = {
      milkCredits: r.milkCredits || 0,
      feedDebits: r.feedDebits || 0,
      settlementDebits: r.settlementDebits || 0,
      bonuses: r.bonuses || 0,
      penalties: r.penalties || 0,
      loans: r.loans || 0,
      interest: r.interest || 0,
      manualAdjustments: r.manualAdjustments || 0,
      netMovement: r.netMovement || 0
    };
  }

  // Fill zeros for farmers with no entries
  for (const id of farmerObjectIds) {
    const key = id.toString();
    if (!map[key]) {
      map[key] = {
        milkCredits: 0,
        feedDebits: 0,
        settlementDebits: 0,
        bonuses: 0,
        penalties: 0,
        loans: 0,
        interest: 0,
        manualAdjustments: 0,
        netMovement: 0
      };
    }
  }

  return map;
};

// ─── Build function ────────────────────────────────────────────────────
const buildFinancial = (data) => {
  return {
    currentLiability: data.currentLiability || 0,
    farmerDebt: data.farmerDebt || 0,
    farmersInDebt: data.farmersInDebt || 0,
    farmersWithPositive: data.farmersWithPositive || 0,
    farmersWithZero: data.farmersWithZero || 0,
    movementBreakdown: data.movementBreakdown || {},
    debtDetails: data.debtDetails || [],
    feedRevenueByProduct: data.feedRevenueByProduct || [],
    farmerSummaries: data.farmerSummaries || {},
    farmerBalances: data.farmerBalances || {}
  };
};

module.exports = {
  fetchFinancialData,
  buildFinancial,
  getFarmerLedgerSummaries,
  getFeedRevenueByProduct
};