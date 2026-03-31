const Transaction = require('../../models/transaction');
const Farmer = require('../../models/farmer');
const Cooperative = require('../../models/cooperative');
const logger = require('../../utils/logger');
const { getFinancialIntelligence } = require('../../analytics/financialAnalytics');

const getFinancial = async (cooperativeId) => {
  try {
    const cooperative = await Cooperative.findById(cooperativeId);
    if (!cooperative) throw new Error('Cooperative not found');

    // 1. Get the detailed analytics (milk, feed, projections, break-even)
    const analytics = await getFinancialIntelligence(cooperativeId);

    // 2. Get the list of farmers with negative balance (debtors)
    const debtors = await Farmer.find(
      { cooperativeId: cooperative._id, balance: { $lt: 0 } },
      'name farmer_code balance phone'
    ).sort({ balance: 1 }).lean();  // most negative first

    const totalDebt = debtors.reduce((sum, f) => sum + Math.abs(f.balance), 0);

    // 3. Combine everything
    return {
      milkRevenue: analytics.milkRevenue,
      milkLitres: analytics.milkLitres,
      feedRevenue: analytics.feedRevenue,
      feedQuantity: analytics.feedQuantity,
      netCashFlow: analytics.netCashFlow,
      profitMargin: analytics.profitMargin,
      avgPricePerLiter: analytics.avgPricePerLiter,
      todayMilkPayout: analytics.todayMilkPayout,
      todayMilkLitres: analytics.todayMilkLitres,
      cashFlowProjection: analytics.cashFlowProjection,
      breakEvenAnalysis: analytics.breakEvenAnalysis,
      farmerDebtTotal: Math.round(totalDebt),
      farmerDebtList: debtors.map(f => ({
        id: f._id,
        name: f.name,
        code: f.farmer_code,
        balance: f.balance,
        phone: f.phone,
      })),
      hasRealData: analytics.milkRevenue > 0 || analytics.feedRevenue > 0,
    };
  } catch (error) {
    logger.error('Financial layer failed', { cooperativeId, error: error.message });
    return getDefaultFinancial();
  }
};

const getDefaultFinancial = () => ({
  milkRevenue: 0,
  milkLitres: 0,
  feedRevenue: 0,
  feedQuantity: 0,
  netCashFlow: 0,
  profitMargin: null,
  avgPricePerLiter: 0,
  todayMilkPayout: 0,
  todayMilkLitres: 0,
  cashFlowProjection: { expectedReceipts: 0, expectedPayouts: 0, netProjection: 0 },
  breakEvenAnalysis: { milkPayout: 0, avgPricePerLiter: 0, litresNeeded: 0 },
  farmerDebtTotal: 0,
  farmerDebtList: [],
  hasRealData: false,
});

module.exports = { getFinancial };