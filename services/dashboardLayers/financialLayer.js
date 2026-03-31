const Transaction = require('../../models/transaction');
const Farmer = require('../../models/farmer');
const Cooperative = require('../../models/cooperative');
const logger = require('../../utils/logger');
const { getFinancialIntelligence } = require('../../analytics/financialAnalytics'); // import analytics

const getFinancial = async (cooperativeId) => {
  try {
    // Validate cooperative
    const cooperative = await Cooperative.findById(cooperativeId);
    if (!cooperative) throw new Error('Cooperative not found');

    // Get basic stats (monthly)
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    const [milkStats, feedStats, debtStats, todayStats] = await Promise.all([
      Transaction.aggregate([
        { $match: { type: 'milk', cooperativeId: cooperative._id, timestamp_server: { $gte: startOfMonth } } },
        { $group: { _id: null, totalPayout: { $sum: { $ifNull: ['$payout', 0] } }, totalLitres: { $sum: { $ifNull: ['$litres', 0] } } } }
      ]),
      Transaction.aggregate([
        { $match: { type: 'feed', cooperativeId: cooperative._id, timestamp_server: { $gte: startOfMonth } } },
        { $group: { _id: null, totalRevenue: { $sum: { $ifNull: ['$cost', 0] } }, totalQty: { $sum: { $ifNull: ['$quantity', 0] } } } }
      ]),
      // Debt stats – also get list of farmers with debts
      Farmer.aggregate([
        { $match: { cooperativeId: cooperative._id, balance: { $lt: 0 } } },
        { $group: { _id: null, totalDebt: { $sum: '$balance' } } }
      ]),
      Transaction.aggregate([
        { $match: { type: 'milk', cooperativeId: cooperative._id, timestamp_server: { $gte: startOfToday } } },
        { $group: { _id: null, totalPayout: { $sum: { $ifNull: ['$payout', 0] } }, totalLitres: { $sum: { $ifNull: ['$litres', 0] } } } }
      ])
    ]);

    // Get detailed list of farmers with debts (not just total)
    const farmersWithDebt = await Farmer.find(
      { cooperativeId: cooperative._id, balance: { $lt: 0 } },
      'name farmer_code balance phone'
    ).sort({ balance: 1 }).lean();

    const milkPayout = milkStats[0]?.totalPayout || 0;
    const feedRevenue = feedStats[0]?.totalRevenue || 0;
    const totalDebt = Math.abs(debtStats[0]?.totalDebt || 0);
    const todayMilkPayout = todayStats[0]?.totalPayout || 0;
    const todayMilkLitres = todayStats[0]?.totalLitres || 0;

    const grossProfit = feedRevenue - milkPayout;
    const profitMargin = feedRevenue > 0 ? (grossProfit / feedRevenue) * 100 : 0;
    const hasRealData = feedRevenue > 0 || milkPayout > 0;

    // Get advanced analytics from financialAnalytics
    const analytics = await getFinancialIntelligence(cooperativeId);

    // Return consolidated data
    return {
      // Basic summary (same as before)
      milkRevenue: Math.round(milkPayout),
      feedRevenue: Math.round(feedRevenue),
      farmerDebtTotal: Math.round(totalDebt),
      farmerDebtList: farmersWithDebt.map(f => ({
        id: f._id,
        name: f.name,
        code: f.farmer_code,
        balance: f.balance,
        phone: f.phone
      })),
      expectedMilkPayout: Math.round(milkPayout),
      netCashFlow: Math.round(grossProfit),
      profitMargin: hasRealData ? parseFloat(profitMargin.toFixed(1)) : null,
      todayMilkPayout: Math.round(todayMilkPayout),
      todayMilkLitres: Math.round(todayMilkLitres),
      hasRealData,
      // Advanced analytics
      cashFlowProjection: analytics.cashFlowProjection,
      breakEvenAnalysis: analytics.breakEvenAnalysis,
      zoneProfitability: analytics.zoneProfitability
    };
  } catch (error) {
    logger.warn('Financial failed', { error: error.message, cooperativeId });
    return getDefaultFinancial();
  }
};

const getDefaultFinancial = () => ({
  milkRevenue: 0,
  feedRevenue: 0,
  farmerDebtTotal: 0,
  farmerDebtList: [],
  expectedMilkPayout: 0,
  netCashFlow: 0,
  profitMargin: null,
  todayMilkPayout: 0,
  todayMilkLitres: 0,
  hasRealData: false,
  cashFlowProjection: { expectedReceipts: 0, expectedPayouts: 0, netProjection: 0 },
  breakEvenAnalysis: { fixedCosts: 0, avgPricePerLiter: 0, litresNeeded: 0 },
  zoneProfitability: []
});

module.exports = { getFinancial };